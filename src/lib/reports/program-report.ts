import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { programs, programDeliverables, budgetExpenses, storedFiles } from "@/db/schema";
import { evidenceForEntity } from "@/lib/evidence";
import { getProgramOverview } from "@/lib/plan/program-service";
import { num } from "@/lib/budget/calc";
import { renderEvidenceContent } from "@/lib/evidence-render";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile, readStoredFile } from "@/lib/storage";
import { getSetting } from "@/lib/settings";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function brandingDataUri(settingKey: string): Promise<string | null> {
  const fileId = await getSetting<string | null>(settingKey, null);
  if (!fileId) return null;
  const result = await readStoredFile(fileId);
  if (!result) return null;
  return `data:${result.file.mime};base64,${result.data.toString("base64")}`;
}

export async function generateProgramReport(opts: {
  programId: string;
  withSignature: boolean;
  withStamp: boolean;
  issuedBy: string;
}) {
  const overview = await getProgramOverview(opts.programId);
  if (!overview) throw new Error("البرنامج غير موجود");
  const program = overview.program;
  const { activities, progress, readiness } = overview;
  const deliverables = await db.select().from(programDeliverables).where(eq(programDeliverables.programId, opts.programId));
  const evidence = await evidenceForEntity("program", opts.programId);
  const expenses = await db.select().from(budgetExpenses).where(eq(budgetExpenses.programId, opts.programId));
  const spent = expenses.reduce((s, e) => s + num(e.amount), 0);

  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  const infoRows: [string, string | null][] = [
    ["المجال", program.domain],
    ["الهدف العام", program.generalGoal],
    ["الهدف الخاص", program.specificGoal],
    ["الفئة المستهدفة", program.targetGroup],
    ["آلية التنفيذ", program.mechanism],
    ["فترة التنفيذ", program.periodText],
    ["مسؤول التنفيذ", program.ownerPosition],
    ["المشاركون", program.participants],
    ["مؤشر النجاح", program.kpiText],
    ["المستهدف", program.targetText],
    ["المخرج المطلوب", program.deliverableText],
    ["الأثر المتوقع", program.expectedImpact],
    ["تاريخ البدء", program.hijriStart ? `${program.hijriStart}هـ` : null],
    ["تاريخ الانتهاء", program.hijriEnd ? `${program.hijriEnd}هـ` : null],
  ];

  let body = `
  <h2>بطاقة البرنامج</h2>
  <table>
    ${infoRows
      .filter(([, v]) => v)
      .map(([k, v]) => `<tr><th style="width:22%">${esc(k)}</th><td>${esc(v!)}</td></tr>`)
      .join("")}
    <tr><th>الحالة</th><td>${esc(program.status)} — نسبة الإنجاز ${progress.display}٪ (محسوبة من الأنشطة الموزونة)</td></tr>
    <tr><th>جاهزية الإقفال</th><td>${readiness.percent}٪ — ${esc(readiness.statusAr)}</td></tr>
    ${
      program.completedAt
        ? `<tr><th>الاكتمال</th><td>${program.completionOverride ? `مكتمل بتجاوز موثّق — الجاهزية وقت الإقفال ${program.overrideReadiness}٪. المبرر: ${esc(program.overrideReason ?? "")}` : "مكتمل بجاهزية كاملة"}</td></tr>`
        : ""
    }
    <tr><th>المصروف الفعلي</th><td>${spent.toLocaleString("ar")} (${expenses.length} مصروفاً مرتبطاً)</td></tr>
  </table>

  <h2>الأنشطة (${activities.length})</h2>
  <table>
    <tr><th>النشاط</th><th>المسؤول</th><th>الوزن الفعلي</th><th>الإنجاز</th><th>الحالة</th><th>الموعد</th></tr>
    ${activities
      .map(
        (a) =>
          `<tr><td>${esc(a.name)}</td><td>${esc(a.ownerName ?? "—")}</td><td>${a.effectiveWeight.toFixed(1)}٪</td><td>${a.progress}٪</td><td>${esc(a.status)}${a.requiredForCompletion ? " (إلزامي)" : ""}</td><td>${esc(a.plannedEnd ?? "—")}</td></tr>`,
      )
      .join("")}
  </table>

  ${
    readiness.missing.length > 0
      ? `<h2>المتطلبات الناقصة (${readiness.missing.length})</h2>
         <ul>${readiness.missing.map((m) => `<li>${esc(m.labelAr)}</li>`).join("")}</ul>`
      : ""
  }

  <h2>المخرجات وحزم الشواهد</h2>
  <table>
    <tr><th>المخرج</th><th>الشواهد المقبولة</th><th>موعد التسليم</th><th>حالة الحزمة</th></tr>
    ${deliverables
      .map(
        (d) =>
          `<tr><td>${esc(d.mainOutput ?? "—")}</td><td>${esc(d.acceptedEvidence ?? "—")}</td><td>${esc(d.dueText ?? "—")}</td><td>${esc(d.packageStatus)}</td></tr>`,
      )
      .join("")}
  </table>
  `;

  if (evidence.length > 0) {
    body += `<h2>الشواهد (${evidence.length})</h2>`;
    for (const e of evidence) {
      const rendered = await renderEvidenceContent({
        title: e.item.title,
        kind: e.item.kind,
        role: e.item.role,
        fileId: e.item.fileId,
        url: e.item.url,
        textContent: e.item.textContent,
        description: e.item.description,
      });
      body += `<div style="page-break-inside:avoid; margin-bottom:10px;">
        <strong>${esc(rendered.title)}</strong> ${rendered.role ? `<span class="badge">${esc(rendered.role)}</span>` : ""}
        ${rendered.html}
      </div>`;
    }
  }

  const signatureDataUri = opts.withSignature ? await brandingDataUri("branding.signature_file") : null;
  const stampDataUri = opts.withStamp ? await brandingDataUri("branding.stamp_file") : null;

  const title = `تقرير برنامج: ${program.name}`;
  // إصدار الوثيقة أولاً للحصول على الرقم ورمز التحقق ثم توليد PDF باللقطة النهائية
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, signatureDataUri, stampDataUri });
  const doc = await issueDocument({
    docType: "program_report",
    title,
    entityType: "program",
    entityId: program.id,
    htmlSnapshot: preliminaryHtml,
    withSignature: opts.withSignature,
    withStamp: opts.withStamp,
    issuedBy: opts.issuedBy,
  });

  const finalHtml = officialPageHtml({
    title,
    bodyHtml: body,
    issuedAtText,
    docNumber: doc.docNumber,
    verificationCode: doc.verificationCode,
    signatureDataUri,
    stampDataUri,
  });
  const pdf = await htmlToPdf(finalHtml);
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    uploadedBy: opts.issuedBy,
  });
  const { documents } = await import("@/db/schema");
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));

  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

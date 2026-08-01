import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { programs, programDeliverables, programFollowups, budgetExpenses } from "@/db/schema";
import { evidenceForEntity } from "@/lib/evidence";
import { getProgram } from "@/lib/plan/program-service";
import { evidenceCountPhrase } from "@/lib/plan/evidence-summary";
import { num } from "@/lib/budget/calc";
import { formatMoney, orDash, numOrNull } from "@/lib/format";
import { renderEvidenceContent } from "@/lib/evidence-render";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile, readStoredFile } from "@/lib/storage";
import { getSetting } from "@/lib/settings";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { programLifecycle } from "@/lib/plan/lifecycle";
import { escapeHtml as esc } from "@/lib/html-escape";

async function brandingDataUri(settingKey: string): Promise<string | null> {
  const fileId = await getSetting<string | null>(settingKey, null);
  if (!fileId) return null;
  const result = await readStoredFile(fileId);
  if (!result) return null;
  return `data:${result.file.mime};base64,${result.data.toString("base64")}`;
}

/**
 * تقرير البرنامج (D-024/D-025): يركّز على معلومات البرنامج والمسؤول والتواريخ والحالة
 * والتقدم المباشر والشواهد المرفوعة وعددها الفعلي والميزانية والمصروف الفعلي والنتائج والأثر
 * والملاحظات وسجل المتابعة. لا أنشطة ولا أوزان ولا جاهزية إقفال ولا متطلبات/نواقص شواهد.
 */
export async function generateProgramReport(opts: {
  programId: string;
  withSignature: boolean;
  withStamp: boolean;
  issuedBy: string;
}) {
  const program = await getProgram(opts.programId);
  if (!program) throw new Error("البرنامج غير موجود");
  const deliverables = await db.select().from(programDeliverables).where(eq(programDeliverables.programId, opts.programId));
  const evidence = await evidenceForEntity("program", opts.programId);
  const expenses = await db.select().from(budgetExpenses).where(eq(budgetExpenses.programId, opts.programId));
  const followups = await db
    .select()
    .from(programFollowups)
    .where(eq(programFollowups.programId, opts.programId))
    // الترتيب بمفتاح الأسبوع لا بوقت الإنشاء — تعديل سجل أسبوع قديم لا يقدمه على الأحدث (v2.4)
    .orderBy(desc(programFollowups.weekKey))
    .limit(12);
  const spent = expenses.reduce((s, e) => s + num(e.amount), 0);
  // «الميزانية المعتمدة» من programs.budget (اختيارية، null-safe)؛ «المتبقي» محايد («—») بلا مخصص.
  const allocated = numOrNull(program.budget);
  const remaining = allocated === null ? null : allocated - spent;
  const allocatedText = allocated === null ? "—" : `${formatMoney(program.budget)} ريال`;
  const spentText = `${formatMoney(spent)} ريال (${expenses.length} مصروفاً مرتبطاً)`;
  const remainingText = remaining === null ? "—" : `${formatMoney(remaining)} ريال`;

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
    ["النتائج والأثر المتوقع", program.expectedImpact],
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
    <tr><th>الرقم التسلسلي</th><td>${program.seq}</td></tr>
    <tr><th>اعتماد المدير</th><td>${esc(program.status)}${program.approvedAt ? ` — بتاريخ ${esc(toGregorianNumeric(program.approvedAt))}م` : ""}</td></tr>
    <tr><th>دورة الحياة</th><td>${esc(programLifecycle(program))}${program.completedAt ? ` — وُثّق الاكتمال ${esc(toGregorianNumeric(program.completedAt))}م` : ""}${program.closedAt ? ` — أُقفل ${esc(toGregorianNumeric(program.closedAt))}م` : ""}</td></tr>
    <tr><th>نسبة الإنجاز</th><td>${program.progress}٪</td></tr>
    <tr><th>حالة التنفيذ</th><td>${esc(program.executionStatus)}</td></tr>
    ${program.completionNote ? `<tr><th>ملاحظة الاكتمال</th><td>${esc(program.completionNote)}</td></tr>` : ""}
    ${program.closureNote ? `<tr><th>ملاحظة الإقفال</th><td>${esc(program.closureNote)}</td></tr>` : ""}
    <tr><th>الميزانية المعتمدة</th><td>${allocatedText}</td></tr>
    <tr><th>المصروف</th><td>${spentText}</td></tr>
    <tr><th>المتبقي</th><td>${remainingText}</td></tr>
    ${program.principalNotes ? `<tr><th>ملاحظات</th><td>${esc(program.principalNotes)}</td></tr>` : ""}
  </table>
  `;

  // B1: المصروفات المرتبطة مع «رقم الفاتورة» — يجعل أرقام الفواتير ظاهرة في التقرير الرسمي.
  if (expenses.length > 0) {
    body += `
    <h2>المصروفات المرتبطة</h2>
    <table>
      <tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>رقم الفاتورة</th></tr>
      ${expenses
        .map(
          (e) =>
            `<tr><td>${esc(orDash(e.expenseDate))}</td><td>${esc(orDash(e.items))}</td><td>${esc(formatMoney(e.amount))}</td><td>${esc(orDash(e.paymentReference))}</td></tr>`,
        )
        .join("")}
    </table>
    `;
  }

  if (deliverables.length > 0) {
    body += `
    <h2>المخرجات</h2>
    <table>
      <tr><th>المخرج</th><th>الشواهد المقبولة</th><th>موعد التسليم</th></tr>
      ${deliverables
        .map(
          (d) =>
            `<tr><td>${esc(d.mainOutput ?? "—")}</td><td>${esc(d.acceptedEvidence ?? "—")}</td><td>${esc(d.dueText ?? "—")}</td></tr>`,
        )
        .join("")}
    </table>
    `;
  }

  if (followups.length > 0) {
    body += `
    <h2>سجل المتابعة الأسبوعية</h2>
    <table>
      <tr><th>الأسبوع</th><th>حالة التنفيذ</th><th>الإنجاز</th><th>الملاحظة</th></tr>
      ${followups
        .map(
          (f) =>
            `<tr><td>${esc(f.weekKey)}</td><td>${esc(f.executionStatus)}</td><td>${f.progressSnapshot}٪</td><td>${esc(f.note)}</td></tr>`,
        )
        .join("")}
    </table>
    `;
  }

  body += `<h2>الشواهد (${evidence.length})</h2><p>${evidenceCountPhrase(evidence.length)} — العدد معلوماتي فقط.</p>`;
  if (evidence.length > 0) {
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
  // الترويسة الرسمية المركزية (v2.3 §8): الهوية والشعارات من الإعدادات
  const identityHeader = await getOfficialHeader();
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, signatureDataUri, stampDataUri, identity: identityHeader });
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
    identity: identityHeader,
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

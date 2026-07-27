import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people, documents } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile, readStoredFile } from "@/lib/storage";
import { getSetting } from "@/lib/settings";
import { evidenceForEntity } from "@/lib/evidence";
import { renderEvidenceContent } from "@/lib/evidence-render";
import { weightedScore } from "@/lib/performance/scoring";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";

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

/** تقرير جلسة أداء — يستخدم تقديرات هذه الجلسة نفسها */
export async function generateSessionReport(opts: {
  sessionId: string;
  withSignature: boolean;
  withStamp: boolean;
  issuedBy: string;
}) {
  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, opts.sessionId));
  if (!session) throw new Error("الجلسة غير موجودة");
  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, session.cycleId));
  const [person] = await db.select().from(people).where(eq(people.id, cycle.personId));
  const snapshot = cycle.modelSnapshot as {
    model: { nameAr: string; official: boolean };
    indicators: { id: string; nameAr: string; weight: string; requiresEvidence: boolean }[];
  };
  const ratings = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, opts.sessionId));
  const ratingByIndicator = new Map(ratings.map((r) => [r.indicatorId, r]));
  const evidence = await evidenceForEntity("perf_session", opts.sessionId);

  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;
  const sessionDateText = session.sessionDate ?? "—";

  let totalWeight = 0;
  let totalScore = 0;
  const rows = snapshot.indicators
    .map((ind, i) => {
      const r = ratingByIndicator.get(ind.id);
      const weight = Number(ind.weight);
      totalWeight += weight;
      const score = r?.rating != null ? weightedScore(r.rating, weight) : null;
      if (score !== null) totalScore += score;
      return `<tr>
        <td>${i + 1}</td>
        <td>${esc(orFallback(ind.nameAr))}</td>
        <td>${weight}٪</td>
        <td>${r?.rating ?? "غير مقيم"}</td>
        <td>${score !== null ? score.toFixed(2) + "٪" : "—"}</td>
        <td>${esc(r?.note ?? "")}</td>
      </tr>`;
    })
    .join("");

  let body = `
  <h2>بيانات الجلسة</h2>
  <table>
    <tr><th style="width:22%">الاسم</th><td>${esc(person.fullName)}</td></tr>
    <tr><th>الفئة</th><td>${esc(cycle.cycleType)} — ${esc(person.jobTitle ?? "")}</td></tr>
    <tr><th>النموذج</th><td>${esc(orFallback(snapshot.model.nameAr))}${snapshot.model.official ? " (نموذج رسمي)" : ""}</td></tr>
    <tr><th>نوع الجلسة</th><td>${esc(session.sessionType)}</td></tr>
    <tr><th>تاريخ الجلسة</th><td>${esc(sessionDateText)}</td></tr>
    <tr><th>الدورة</th><td>${esc(orDash(cycle.yearKey))}</td></tr>
  </table>

  <h2>المؤشرات والتقديرات — القاعدة: الدرجة الموزونة = (التقدير ÷ 5) × الوزن</h2>
  <table>
    <tr><th>م</th><th>المؤشر</th><th>الوزن</th><th>التقدير (من 5)</th><th>الدرجة الموزونة</th><th>ملاحظة</th></tr>
    ${rows}
    <tr><th colspan="2">المجموع</th><th>${totalWeight}٪</th><th>—</th><th>${totalScore.toFixed(2)}٪</th><th></th></tr>
  </table>
  `;

  const textSections: [string, string | null][] = [
    ["الملاحظات", session.notes],
    ["نقاط القوة", session.strengths],
    ["فرص التحسين", session.improvementAreas],
    ["التوصيات", session.actionsText],
    ["موعد المتابعة القادمة", session.nextFollowupDate],
  ];
  for (const [title, content] of textSections) {
    if (content) body += `<h2>${title}</h2><p>${esc(content).replaceAll("\n", "<br>")}</p>`;
  }

  if ((session.warningFlags ?? []).length > 0) {
    body += `<p class="truncation-note">تنبيهات: ${(session.warningFlags ?? []).map(esc).join(" · ")}</p>`;
  }

  if (evidence.length > 0) {
    body += `<h2>الشواهد (${evidence.length})</h2>`;
    const indicatorName = new Map(snapshot.indicators.map((i) => [i.id, i.nameAr]));
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
      const linkedIndicator = e.link.subKey ? indicatorName.get(e.link.subKey) : null;
      body += `<div style="page-break-inside:avoid; margin-bottom:10px;">
        <strong>${esc(rendered.title)}</strong>
        ${linkedIndicator ? `<span class="badge">مؤشر: ${esc(linkedIndicator)}</span>` : ""}
        ${rendered.html}
      </div>`;
    }
  }

  // حقول التوقيع: توقيع المدير وختمه خياران مستقلان؛ توقيع المعلم/الموظف يدوي دائماً
  const signatureDataUri = opts.withSignature ? await brandingDataUri("branding.signature_file") : null;
  const stampDataUri = opts.withStamp ? await brandingDataUri("branding.stamp_file") : null;
  body += `
  <div class="signatures">
    <div class="sig-block">
      ${signatureDataUri ? `<img class="sig-img" src="${signatureDataUri}" alt="">` : ""}
      <div class="sig-line">مدير المجمع — التوقيع والتاريخ</div>
    </div>
    <div class="sig-block">
      ${stampDataUri ? `<img class="stamp-img" src="${stampDataUri}" alt="">` : ""}
      <div class="sig-line">${esc(cycle.cycleType)} (${esc(person.fullName)}) — التوقيع والتاريخ</div>
    </div>
  </div>`;

  const title = `تقرير ${session.sessionType === "زيارة" ? "زيارة صفية" : `جلسة ${session.sessionType}`} — ${person.fullName}`;
  const doc = await issueDocument({
    docType: "performance_report",
    title,
    entityType: "perf_session",
    entityId: session.id,
    htmlSnapshot: "",
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
  });
  const pdf = await htmlToPdf(finalHtml);
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    sensitive: true,
    uploadedBy: opts.issuedBy,
  });
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));
  await db.update(perfSessions).set({ reportDocId: doc.id }).where(eq(perfSessions.id, session.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

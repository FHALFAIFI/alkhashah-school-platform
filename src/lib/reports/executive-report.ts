import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  programs, planYears, committees, meetings, actionTasks, perfCycles, perfSessions,
  people, rooms, maintenanceIssues, inspections, documents, evidenceItems,
} from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric, todayIso } from "@/lib/dates";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback } from "@/lib/format";
import { escapeHtml as esc } from "@/lib/html-escape";

/**
 * التقرير التنفيذي الشامل عبر جميع الوحدات.
 * تفاصيل الأداء الفردي تدرج فقط بطلب المدير صراحة (includeIndividual) ولا يراها غيره.
 */
export async function generateExecutiveReport(opts: {
  period: "شهري" | "فصلي" | "سنوي";
  includeIndividual: boolean;
  withSignature: boolean;
  withStamp: boolean;
  issuedBy: string;
}) {
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  // التقرير التنفيذي يستبعد السجلات الاصطناعية (مفعّل في التطوير/الإنتاج)
  const excluded = await getExcludedIdSets();
  const [allPrograms, years, allCommittees, allMeetings, tasks, cycles, sessions, persons, allRooms, issues, allInspections, evidenceCount] =
    await Promise.all([
      // البرامج المؤرشفة (v2.1 §A1) مستبعدة من التقرير التنفيذي
      db.select().from(programs).where(and(notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt))).orderBy(asc(programs.seq)),
      db.select().from(planYears),
      db.select().from(committees).where(notSynthetic(committees.id, excluded.committees)),
      db.select().from(meetings).where(notSynthetic(meetings.id, excluded.meetings)),
      db.select().from(actionTasks).where(notSynthetic(actionTasks.id, excluded.tasks)),
      db.select().from(perfCycles).where(notSynthetic(perfCycles.id, excluded.perfCycles)),
      db.select().from(perfSessions).where(notSynthetic(perfSessions.id, excluded.perfSessions)),
      db.select().from(people).where(notSynthetic(people.id, excluded.people)),
      db.select().from(rooms).where(eq(rooms.active, true)),
      db.select().from(maintenanceIssues).where(notSynthetic(maintenanceIssues.id, excluded.maintenance)),
      db.select().from(inspections),
      db.select().from(evidenceItems).where(notSynthetic(evidenceItems.id, excluded.evidence)),
    ]);

  const personName = new Map(persons.map((p) => [p.id, p.fullName]));
  const activeYear = years.find((y) => y.status === "نشطة");
  const today = todayIso();

  // الخطة التشغيلية
  const domains = [...new Set(allPrograms.map((p) => p.domain))];
  const avgProgress = allPrograms.length
    ? Math.round(allPrograms.reduce((s, p) => s + p.progress, 0) / allPrograms.length)
    : 0;
  let body = `
  <h2>أولاً: الخطة التشغيلية${activeYear ? ` — ${esc(activeYear.nameAr)}` : ""}</h2>
  <table>
    <tr><th>المجال</th><th>عدد البرامج</th><th>متوسط الإنجاز</th><th>معتمدة</th></tr>
    ${domains
      .map((d) => {
        const dp = allPrograms.filter((p) => p.domain === d);
        const avg = Math.round(dp.reduce((s, p) => s + p.progress, 0) / dp.length);
        return `<tr><td>${esc(orFallback(d, "بدون تصنيف"))}</td><td>${dp.length}</td><td>${avg}٪</td><td>${dp.filter((p) => p.status !== "مسودة").length}</td></tr>`;
      })
      .join("")}
    <tr><th>الإجمالي</th><th>${allPrograms.length}</th><th>${avgProgress}٪</th><th>${allPrograms.filter((p) => p.status !== "مسودة").length}</th></tr>
  </table>
  <p class="meta">أقل ثلاثة برامج إنجازاً: ${[...allPrograms].sort((a, b) => a.progress - b.progress).slice(0, 3).map((p) => `${esc(orFallback(p.name))} (${p.progress}٪)`).join("، ") || "—"}</p>

  <h2>ثانياً: اللجان والمجالس</h2>
  <table>
    <tr><th>اللجنة/الفريق</th><th>الحالة</th><th>الاجتماعات</th><th>المكتملة (بمحضر موقع)</th></tr>
    ${allCommittees
      .map((c) => {
        const ms = allMeetings.filter((m) => m.committeeId === c.id);
        return `<tr><td>${esc(c.nameAr)}</td><td>${esc(c.status)}</td><td>${ms.length}</td><td>${ms.filter((m) => m.status === "مكتمل").length}</td></tr>`;
      })
      .join("")}
  </table>

  <h2>ثالثاً: المهام والإجراءات</h2>
  <table>
    <tr><th>الإجمالي</th><th>مكتملة</th><th>قيد التنفيذ</th><th>متأخرة</th><th>إلزامية (قرارات)</th></tr>
    <tr>
      <td>${tasks.length}</td>
      <td>${tasks.filter((t) => t.status === "مكتملة").length}</td>
      <td>${tasks.filter((t) => t.status === "قيد التنفيذ").length}</td>
      <td>${tasks.filter((t) => t.dueDate && t.status !== "مكتملة" && t.status !== "ملغاة" && t.dueDate.toISOString().slice(0, 10) < today).length}</td>
      <td>${tasks.filter((t) => t.mandatory).length}</td>
    </tr>
  </table>

  <h2>رابعاً: الأداء الوظيفي (ملخص عام)</h2>
  <table>
    <tr><th>الفئة</th><th>الدورات</th><th>الجلسات</th><th>المقفلة</th></tr>
    ${["معلم", "موظف"]
      .map((t) => {
        const tc = cycles.filter((c) => c.cycleType === t);
        const ts = sessions.filter((s) => tc.some((c) => c.id === s.cycleId));
        return `<tr><td>${t}</td><td>${tc.length}</td><td>${ts.length}</td><td>${ts.filter((s) => s.status === "مقفلة" || s.status === "مكتملة").length}</td></tr>`;
      })
      .join("")}
  </table>
  `;

  if (opts.includeIndividual && cycles.length > 0) {
    body += `
    <h2>تفاصيل الأداء الفردي (سري — للمدير فقط)</h2>
    <table>
      <tr><th>الاسم</th><th>الفئة</th><th>السنة</th><th>الحالة</th><th>جلسات مقفلة</th></tr>
      ${cycles
        .map((c) => {
          const cs = sessions.filter((s) => s.cycleId === c.id);
          return `<tr><td>${esc(personName.get(c.personId) ?? "—")}</td><td>${esc(c.cycleType)}</td><td>${esc(c.yearKey)}</td><td>${esc(c.status)}</td><td>${cs.filter((s) => s.status === "مقفلة" || s.status === "مكتملة").length}/${cs.length}</td></tr>`;
        })
        .join("")}
    </table>`;
  }

  body += `
  <h2>خامساً: المبنى المدرسي</h2>
  <table>
    <tr><th>الغرف المسجلة</th><th>الفحوصات المنفذة</th><th>بلاغات مفتوحة</th><th>بلاغات مغلقة ومتحققة</th></tr>
    <tr>
      <td>${allRooms.length}</td>
      <td>${allInspections.length}</td>
      <td>${issues.filter((i) => i.status === "مفتوح" || i.status === "قيد الإصلاح").length}</td>
      <td>${issues.filter((i) => i.status === "مغلق ومتحقق").length}</td>
    </tr>
  </table>

  <h2>سادساً: الشواهد والوثائق</h2>
  <p>إجمالي الشواهد المسجلة في السجل الموحد: <strong>${evidenceCount.length}</strong></p>
  `;

  const title = `التقرير التنفيذي الشامل (${opts.period})`;
  const doc = await issueDocument({
    docType: "executive_report",
    title,
    htmlSnapshot: "",
    withSignature: opts.withSignature,
    withStamp: opts.withStamp,
    issuedBy: opts.issuedBy,
  });
  // الترويسة الرسمية المركزية (v2.3 §8): الهوية والشعارات من الإعدادات
  const identityHeader = await getOfficialHeader();
  const finalHtml = officialPageHtml({
    title,
    bodyHtml: body,
    issuedAtText,
    docNumber: doc.docNumber,
    verificationCode: doc.verificationCode,
    identity: identityHeader,
  });
  const pdf = await htmlToPdf(finalHtml);
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    sensitive: opts.includeIndividual,
    uploadedBy: opts.issuedBy,
  });
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

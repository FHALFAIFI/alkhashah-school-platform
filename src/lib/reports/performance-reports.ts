import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  people,
  perfSessions,
  perfRatings,
  improvementPlans,
  evidenceLinks,
  users,
  documents as documentsTable,
} from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";
import { escapeHtml as esc } from "@/lib/html-escape";
import { loadAnalyticsCycles, loadOverallAnalytics } from "@/lib/performance/analytics-service";
import { cycleProgress } from "@/lib/performance/scoring";

/**
 * v2.4 §13: مولدا تقارير الأداء الوظيفي —
 * (أ) «تقرير الأداء الوظيفي التفصيلي للموظف» لدورة محددة: المعايير بأوزانها وتقديراتها
 *     ودرجاتها الموزونة وملاحظاتها وشواهدها، وسجل الجلسات والزيارات، والملاحظات النوعية،
 *     وخطط التحسين، وإقرار الموظف واعتماد المدير.
 * (ب) «تقرير الأداء الوظيفي التفصيلي للمدرسة»: مؤشرات المدرسة كاملة مع ملحق أسماء —
 *     بيانات حساسة تصدر فقط لمن يملك performance.individual.read (D-013).
 * لا تقديرات لفظية مخترعة: النسب والفئات الرقمية المعتمدة في المنصة فقط.
 */

async function issuePerfDocument(opts: {
  docType: "employee_performance_report" | "overall_performance_report";
  title: string;
  entityType: string;
  entityId?: string;
  body: string;
  issuedBy: string;
}) {
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;
  const identityHeader = await getOfficialHeader();
  const preliminaryHtml = officialPageHtml({ title: opts.title, bodyHtml: opts.body, issuedAtText, identity: identityHeader });
  const doc = await issueDocument({
    docType: opts.docType,
    title: opts.title,
    entityType: opts.entityType,
    entityId: opts.entityId,
    htmlSnapshot: preliminaryHtml,
    withSignature: false,
    withStamp: false,
    issuedBy: opts.issuedBy,
  });
  const finalHtml = officialPageHtml({
    title: opts.title,
    bodyHtml: opts.body,
    issuedAtText,
    docNumber: doc.docNumber,
    verificationCode: doc.verificationCode,
    identity: identityHeader,
  });
  const pdf = await htmlToPdf(finalHtml, { pageNumbers: true });
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    uploadedBy: opts.issuedBy,
  });
  await db.update(documentsTable).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documentsTable.id, doc.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

/** درجة موزونة بدقة عُشر: (التقدير/5) × الوزن */
function weightedScore(rating: number | null, weight: number): number | null {
  if (rating === null) return null;
  return Math.round((rating / 5) * weight * 10) / 10;
}

export async function generateEmployeePerformanceReport(opts: {
  personId: string;
  cycleId?: string;
  issuedBy: string;
}) {
  const [person] = await db.select().from(people).where(eq(people.id, opts.personId));
  if (!person) throw new Error("المنسوب غير موجود");
  const cycles = await loadAnalyticsCycles(opts.personId);
  if (cycles.length === 0) throw new Error("لا دورات تقييم لهذا المنسوب");
  const cycle = opts.cycleId ? cycles.find((c) => c.id === opts.cycleId) : cycles.at(-1);
  if (!cycle) throw new Error("الدورة غير موجودة لهذا المنسوب");

  const sessions = await db
    .select()
    .from(perfSessions)
    .where(eq(perfSessions.cycleId, cycle.id))
    .orderBy(asc(perfSessions.createdAt));
  const sessionIds = sessions.map((s) => s.id);
  const ratings = sessionIds.length
    ? await db.select().from(perfRatings).where(inArray(perfRatings.sessionId, sessionIds))
    : [];
  const plans = await db.select().from(improvementPlans).where(eq(improvementPlans.cycleId, cycle.id));
  const evidence = sessionIds.length
    ? await db
        .select({ subKey: evidenceLinks.subKey })
        .from(evidenceLinks)
        .where(and(eq(evidenceLinks.entityType, "perf_session"), inArray(evidenceLinks.entityId, sessionIds)))
    : [];
  const evidenceByIndicator = new Map<string, number>();
  for (const e of evidence) {
    if (!e.subKey) continue;
    evidenceByIndicator.set(e.subKey, (evidenceByIndicator.get(e.subKey) ?? 0) + 1);
  }
  // ملاحظة كل معيار: أحدث ملاحظة مسجلة عبر الجلسات (ترتيب الجلسات تصاعدي فالأحدث يطغى)
  const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
  const noteByIndicator = new Map<string, string>();
  for (const r of [...ratings].sort((a, b) => (sessionOrder.get(a.sessionId) ?? 0) - (sessionOrder.get(b.sessionId) ?? 0))) {
    if (r.note) noteByIndicator.set(r.indicatorId, r.note);
  }
  const lockerIds = sessions.map((s) => s.lockedBy).filter(Boolean) as string[];
  const lockers = lockerIds.length
    ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, lockerIds))
    : [];
  const lockerName = new Map(lockers.map((u) => [u.id, u.name]));

  const progress = cycleProgress(cycle.sessions);
  const totalWeight = cycle.indicators.reduce((s, i) => s + i.weight, 0);
  const resultPercent =
    progress.evaluated && totalWeight > 0 ? Math.round((progress.result / totalWeight) * 1000) / 10 : null;
  const ratingByIndicator = new Map(progress.entries.map((e) => [e.indicatorId, e.rating]));
  const finalSession = sessions.filter((s) => s.sessionType === "نهائي").at(-1);

  let body = `
  <h2>بيانات الموظف والدورة</h2>
  <table>
    <tr><th style="width:22%">الاسم</th><td>${esc(orFallback(person.fullName))}</td></tr>
    ${person.jobTitle ? `<tr><th>العمل المكلف به</th><td>${esc(person.jobTitle)}</td></tr>` : ""}
    <tr><th>الفئة</th><td>${esc(orDash(person.category))}</td></tr>
    <tr><th>السنة</th><td>${esc(cycle.yearKey)}</td></tr>
    <tr><th>نموذج التقييم</th><td>${esc(cycle.modelName)}</td></tr>
    <tr><th>حالة الدورة</th><td>${esc(cycle.status)}</td></tr>
    <tr><th>النتيجة النهائية</th><td>${resultPercent === null ? "لم يكتمل التقييم بعد" : `${resultPercent}٪ (تغطية التقييم ${Math.round(progress.coverage)}٪)`}</td></tr>
  </table>

  <h2>المعايير والتقديرات</h2>
  <table>
    <tr><th>م</th><th>المعيار</th><th>الوزن ٪</th><th>التقدير (من 5)</th><th>الدرجة الموزونة</th><th>الشواهد</th><th>الملاحظة</th></tr>
    ${cycle.indicators
      .map((ind, i) => {
        const rating = ratingByIndicator.get(ind.id) ?? null;
        const weighted = weightedScore(rating, ind.weight);
        return `<tr><td>${i + 1}</td><td>${esc(ind.nameAr)}</td><td>${ind.weight}</td><td>${rating ?? "—"}</td><td>${weighted ?? "—"}</td><td>${evidenceByIndicator.get(ind.id) ?? 0}</td><td>${esc(orDash(noteByIndicator.get(ind.id) ?? null))}</td></tr>`;
      })
      .join("")}
  </table>

  <h2>سجل الجلسات والزيارات (${sessions.length})</h2>
  <table>
    <tr><th>النوع</th><th>التاريخ</th><th>الحالة</th><th>الاعتماد</th></tr>
    ${sessions
      .map((s) => {
        const approval = s.lockedAt
          ? `اعتُمدت بواسطة ${esc(orDash(s.lockedBy ? lockerName.get(s.lockedBy) ?? null : null))} — ${esc(toGregorianNumeric(s.lockedAt))}م`
          : "—";
        return `<tr><td>${esc(s.sessionType)}</td><td>${esc(orDash(s.sessionDate))}</td><td>${esc(orDash(s.status))}</td><td>${approval}</td></tr>`;
      })
      .join("")}
    ${sessions.length === 0 ? `<tr><td colspan="4">لا جلسات مسجلة</td></tr>` : ""}
  </table>`;

  const narrative = sessions.filter((s) => s.strengths || s.improvementAreas || s.recommendations || s.actionsText);
  if (narrative.length > 0) {
    body += `
  <h2>الملاحظات النوعية</h2>
  <table>
    <tr><th>الجلسة</th><th>نقاط القوة</th><th>جوانب التحسين</th><th>التوصيات</th><th>الإجراءات المطلوبة</th></tr>
    ${narrative
      .map(
        (s) =>
          `<tr><td>${esc(s.sessionType)}${s.sessionDate ? ` — ${esc(s.sessionDate)}` : ""}</td><td>${esc(orDash(s.strengths))}</td><td>${esc(orDash(s.improvementAreas))}</td><td>${esc(orDash(s.recommendations))}</td><td>${esc(orDash(s.actionsText))}</td></tr>`,
      )
      .join("")}
  </table>`;
  }

  if (plans.length > 0) {
    body += `
  <h2>خطط التحسين (${plans.length})</h2>
  <table>
    <tr><th>الخطة</th><th>الأهداف</th><th>الإجراءات</th><th>المدة</th><th>الحالة</th></tr>
    ${plans
      .map(
        (p) =>
          `<tr><td>${esc(orFallback(p.title))}</td><td>${esc(orDash(p.goals))}</td><td>${esc(orDash(p.actions))}</td><td>${esc(orDash(p.duration))}</td><td>${esc(orDash(p.status))}</td></tr>`,
      )
      .join("")}
  </table>`;
  }

  body += `
  <h2>الإقرار والاعتماد</h2>
  <table>
    <tr><th style="width:22%">إقرار الموظف</th><td>${esc(orDash(finalSession?.employeeComment ?? null))}</td></tr>
    <tr><th>تعقيب المدير</th><td>${esc(orDash(finalSession?.principalComment ?? null))}</td></tr>
    <tr><th>اعتماد التقييم النهائي</th><td>${
      finalSession?.lockedAt
        ? `معتمد — ${esc(orDash(finalSession.lockedBy ? lockerName.get(finalSession.lockedBy) ?? null : null))} بتاريخ ${esc(toGregorianNumeric(finalSession.lockedAt))}م`
        : "لم يُعتمد بعد"
    }</td></tr>
    <tr><th>التقرير الموقع</th><td>${finalSession?.signedReportFileId ? "مستلم ومحفوظ" : "لم يُستلم بعد"}</td></tr>
  </table>`;

  if (cycles.length > 1) {
    body += `
  <h2>سجل الدورات السابقة</h2>
  <table>
    <tr><th>السنة</th><th>النموذج</th><th>الحالة</th><th>النتيجة</th></tr>
    ${cycles
      .map((c) => {
        const p = cycleProgress(c.sessions);
        const tw = c.indicators.reduce((s, i) => s + i.weight, 0);
        const rp = p.evaluated && tw > 0 ? `${Math.round((p.result / tw) * 1000) / 10}٪` : "لم يكتمل";
        return `<tr><td>${esc(c.yearKey)}</td><td>${esc(c.modelName)}</td><td>${esc(c.status)}</td><td>${rp}</td></tr>`;
      })
      .join("")}
  </table>`;
  }

  return issuePerfDocument({
    docType: "employee_performance_report",
    title: `تقرير الأداء الوظيفي التفصيلي — ${orFallback(person.fullName)} (${cycle.yearKey})`,
    entityType: "perf_cycle",
    entityId: cycle.id,
    body,
    issuedBy: opts.issuedBy,
  });
}

export async function generateOverallPerformanceReport(opts: { issuedBy: string }) {
  const { analytics, threshold } = await loadOverallAnalytics();
  const a = analytics;
  const evaluatedEmployees = a.employees.filter((e) => e.evaluated);

  let body = `
  <h2>حالة دورات التقييم</h2>
  <table>
    <tr><th>لم يبدأ</th><th>قيد التقييم</th><th>بانتظار الاعتماد النهائي</th><th>مكتملة</th><th>بلا دورة تقييم</th></tr>
    <tr><td>${a.counts.notStarted}</td><td>${a.counts.inProgress}</td><td>${a.counts.awaitingFinalApproval}</td><td>${a.counts.completed}</td><td>${a.missingEvaluations.length}</td></tr>
  </table>

  <h2>متوسط الأداء لكل معيار (عتبة المعالجة: ${threshold}٪)</h2>
  <table>
    <tr><th>المعيار</th><th>المتوسط ٪</th><th>العينة</th><th>الحالة</th></tr>
    ${a.criteria
      .map((c) => {
        const state = c.insufficientData ? "عينة غير كافية" : c.averagePercent < threshold ? "يحتاج معالجة" : "جيد";
        return `<tr><td>${esc(c.name)}</td><td>${c.insufficientData ? "—" : c.averagePercent}</td><td>${c.sampleSize}</td><td>${state}</td></tr>`;
      })
      .join("")}
  </table>

  <h2>أقوى المعايير وأضعفها</h2>
  <table>
    <tr><th>الأقوى</th><th>الأضعف</th></tr>
    <tr>
      <td>${a.highest.map((c) => `${esc(c.name)} (${c.averagePercent}٪)`).join("؛ ") || "—"}</td>
      <td>${a.lowest.map((c) => `${esc(c.name)} (${c.averagePercent}٪)`).join("؛ ") || "—"}</td>
    </tr>
  </table>

  <h2>توزيع النتائج</h2>
  <table>
    <tr>${a.distribution.map((d) => `<th>${esc(d.bucket)}</th>`).join("")}</tr>
    <tr>${a.distribution.map((d) => `<td>${d.count}</td>`).join("")}</tr>
  </table>

  <h2>المتوسط حسب النموذج</h2>
  <table>
    <tr><th>النموذج</th><th>المتوسط ٪</th><th>العينة</th></tr>
    ${a.byModel.map((m) => `<tr><td>${esc(m.modelName)}</td><td>${m.averagePercent}</td><td>${m.sampleSize}</td></tr>`).join("")}
    ${a.byModel.length === 0 ? `<tr><td colspan="3">لا بيانات</td></tr>` : ""}
  </table>`;

  if (a.needsFollowUp.length > 0) {
    body += `
  <h2>موظفون يحتاجون متابعة (${a.needsFollowUp.length})</h2>
  <table>
    <tr><th>الاسم</th><th>السنة</th><th>النتيجة ٪</th><th>معايير دون العتبة</th></tr>
    ${a.needsFollowUp
      .map(
        (e) =>
          `<tr><td>${esc(e.personName)}</td><td>${esc(e.yearKey)}</td><td>${e.resultPercent ?? "—"}</td><td>${e.weakCriteria.map((w) => esc(w)).join("؛ ") || "—"}</td></tr>`,
      )
      .join("")}
  </table>`;
  }

  if (a.recurringWeaknesses.length > 0) {
    body += `
  <h2>جوانب ضعف متكررة (احتياجات تطوير مهني)</h2>
  <table>
    <tr><th>المعيار</th><th>عدد الدورات</th><th>عدد الموظفين</th></tr>
    ${a.recurringWeaknesses.map((w) => `<tr><td>${esc(w.name)}</td><td>${w.affectedCycles}</td><td>${w.affectedPeople}</td></tr>`).join("")}
  </table>`;
  }

  if (a.periodChange.length > 0) {
    body += `
  <h2>التغير بين آخر فترتين</h2>
  <table>
    <tr><th>الاسم</th><th>من</th><th>إلى</th><th>التغير ٪</th></tr>
    ${a.periodChange
      .map((p) => `<tr><td>${esc(p.personName)}</td><td>${esc(p.fromYear)}</td><td>${esc(p.toYear)}</td><td>${p.deltaPercent > 0 ? "+" : ""}${p.deltaPercent}</td></tr>`)
      .join("")}
  </table>`;
  }

  if (a.missingEvaluations.length > 0) {
    body += `
  <h2>منسوبون نشطون بلا دورة تقييم (${a.missingEvaluations.length})</h2>
  <p>${a.missingEvaluations.map((m) => esc(m.name)).join("؛ ")}</p>`;
  }

  body += `
  <h2>الملحق: تفصيل الموظفين المقيَّمين (${evaluatedEmployees.length})</h2>
  <table>
    <tr><th>م</th><th>الاسم</th><th>السنة</th><th>النتيجة ٪</th></tr>
    ${evaluatedEmployees
      .map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.personName)}</td><td>${esc(e.yearKey)}</td><td>${e.resultPercent ?? "—"}</td></tr>`)
      .join("")}
    ${evaluatedEmployees.length === 0 ? `<tr><td colspan="4">لا تقييمات مكتملة بعد</td></tr>` : ""}
  </table>
  <p class="meta">هذا التقرير يتضمن بيانات أداء فردية حساسة — يُصدر ويُتداول وفق صلاحية الاطلاع على الأداء الفردي فقط (D-013).</p>`;

  return issuePerfDocument({
    docType: "overall_performance_report",
    title: "تقرير الأداء الوظيفي التفصيلي للمدرسة",
    entityType: "performance_overall",
    body,
    issuedBy: opts.issuedBy,
  });
}

import "server-only";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { people, perfCycles, perfSessions } from "@/db/schema";
import { getExcludedIdSets } from "@/lib/synthetic";
import { employeeTypeOf, type EmployeeType } from "@/lib/employee-type";
import { cycleProgress } from "@/lib/performance/scoring";
import { loadAnalyticsCycles } from "@/lib/performance/analytics-service";
import { resultBandLabel } from "@/lib/performance/report-labels";
import { matchesMulti } from "@/lib/reports/loaders";
import { effectiveLowThreshold, type ReportFilters } from "@/lib/reports/filters";
import { orFallback } from "@/lib/format";

/**
 * نتائج الأداء الوظيفي — **مصدر واحد** لكل تقارير §7 (v2.5.0).
 *
 * قبل هذا الإصدار كانت لوحة التحليلات تحسب نتيجة، والتقرير الشامل يحسبها مرة أخرى،
 * وصفحة المنسوب ثالثة. هنا حساب واحد يُقرأ منه: التقرير الفردي، وتقارير المجموعات
 * (معلمون / إداريون / الجميع)، والتقارير الإحصائية، وتقرير الأداء المنخفض.
 *
 * ثلاث قواعد:
 *  1. **لا تقدير لفظي مخترع.** الفئة من شرائح التوزيع الرقمية المعلنة (`resultBandLabel`).
 *  2. **الغياب يُقال لا يُخفى.** الدورة بلا تقديرات تُعاد بنتيجة `null` وسبب مكتوب، فلا
 *     يظهر صفر مضلّل ولا يختفي الموظف من التقرير بلا تفسير (§7.3).
 *  3. **العتبة معطى لا ثابت.** «أقل من 70٪» هي القيمة الافتراضية، والمدير يغيّرها،
 *     والتقرير يذكر العتبة المستعملة (§7.5).
 */

export type EmployeeResult = {
  personId: string;
  personName: string;
  employeeType: EmployeeType;
  jobTitle: string | null;
  department: string | null;
  cycleId: string;
  yearKey: string;
  modelName: string;
  cycleStatus: string;
  /** عدد المعايير في نموذج الدورة */
  criteriaCount: number;
  /** عدد المعايير التي حملت تقديراً فعلياً */
  ratedCount: number;
  /** النتيجة النهائية كنسبة مئوية — `null` حين لا تقديرات */
  resultPercent: number | null;
  band: string;
  /** سبب غياب النتيجة بالعربية — فارغ حين توجد نتيجة */
  missingReason: string | null;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  /** المعايير التي حصلت على أقل التقديرات في هذه الدورة */
  weakCriteria: string[];
  completed: boolean;
};

/**
 * «أقل من العتبة» — العتبة الفعّالة لهذا التشغيل.
 *
 * تفويض إلى `lib/reports/filters` عمداً: الشاشة والتصدير والقالب وترويسة التقرير تقرأ الحد
 * من هناك، فلو بقي حسابه مكرَّراً هنا لأمكن أن ينحرف الرقمان دون أن يفشل شيء.
 */
export function effectiveThreshold(filters: ReportFilters): number {
  return effectiveLowThreshold(filters);
}

export function isLowPerformer(result: EmployeeResult, threshold: number): boolean {
  return result.resultPercent !== null && result.resultPercent < threshold;
}

/**
 * تحميل نتائج الأداء مرشَّحةً (§7.2).
 *
 * الترشيح يشمل نوع الموظف والموظف نفسه والدورة والمسمى والقسم ومدى النتيجة، ويقبل في كل
 * منها **واحداً أو عدة أو الكل** بالدلالة الموحّدة نفسها (§3.3).
 */
export async function loadEmployeeResults(filters: ReportFilters = {}): Promise<EmployeeResult[]> {
  const excluded = await getExcludedIdSets();
  const cycles = await loadAnalyticsCycles();
  if (cycles.length === 0) return [];

  const personIds = [...new Set(cycles.map((c) => c.personId))];
  const personRows = await db
    .select({
      id: people.id,
      name: people.fullName,
      category: people.category,
      employeeType: people.employeeType,
      jobTitle: people.jobTitle,
      orgUnit: people.orgUnit,
    })
    .from(people)
    .where(inArray(people.id, personIds));
  const byPerson = new Map(personRows.map((p) => [p.id, p]));

  // السرد النوعي يُقرأ من جلسات الدورة نفسها — لا يُختلق ولا يُجمَّع من دورات أخرى
  const cycleIds = cycles.map((c) => c.id);
  const sessions = cycleIds.length
    ? await db.select().from(perfSessions).where(inArray(perfSessions.cycleId, cycleIds)).orderBy(asc(perfSessions.createdAt))
    : [];
  const sessionsByCycle = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = sessionsByCycle.get(s.cycleId) ?? [];
    list.push(s);
    sessionsByCycle.set(s.cycleId, list);
  }

  const results: EmployeeResult[] = [];
  for (const c of cycles) {
    if (excluded.people.has(c.personId)) continue;
    const person = byPerson.get(c.personId);
    if (!person) continue;

    const progress = cycleProgress(c.sessions);
    const totalWeight = c.indicators.reduce((s, i) => s + i.weight, 0);
    const rated = progress.entries.filter((e) => e.rating !== null);
    const resultPercent =
      progress.evaluated && totalWeight > 0 ? Math.round((progress.result / totalWeight) * 1000) / 10 : null;

    const cycleSessions = sessionsByCycle.get(c.id) ?? [];
    const narrative = (field: "strengths" | "improvementAreas" | "recommendations") =>
      cycleSessions.map((s) => (s[field] ?? "").trim()).filter((v) => v !== "");

    // المعايير الأضعف في هذه الدورة — تُقرأ من التقديرات نفسها لا من نص حرّ
    const weakCriteria = rated
      .filter((e) => (e.rating ?? 5) <= 2)
      .map((e) => c.indicators.find((i) => i.id === e.indicatorId)?.nameAr)
      .filter((v): v is string => Boolean(v));

    results.push({
      personId: c.personId,
      personName: orFallback(person.name, "بدون اسم"),
      employeeType: employeeTypeOf(person),
      jobTitle: person.jobTitle,
      department: person.orgUnit,
      cycleId: c.id,
      yearKey: c.yearKey,
      modelName: c.modelName,
      cycleStatus: c.status,
      criteriaCount: c.indicators.length,
      ratedCount: rated.length,
      resultPercent,
      band: resultBandLabel(resultPercent),
      missingReason: missingReasonFor({
        criteria: c.indicators.length,
        rated: rated.length,
        sessions: cycleSessions.length,
      }),
      strengths: narrative("strengths"),
      weaknesses: narrative("improvementAreas"),
      recommendations: narrative("recommendations"),
      weakCriteria,
      completed: resultPercent !== null && rated.length === c.indicators.length,
    });
  }

  return applyResultFilters(results, filters);
}

/**
 * سبب غياب النتيجة — يُقال صراحةً بدل إخفاء الصف أو عرض صفر (§7.3).
 * الصياغة تحدّد **ما الناقص** فيعرف المدير الخطوة التالية.
 */
function missingReasonFor(opts: { criteria: number; rated: number; sessions: number }): string | null {
  if (opts.criteria === 0) return "نموذج الدورة بلا معايير — لا يمكن احتساب نتيجة";
  if (opts.sessions === 0) return "لا جلسات تقييم في هذه الدورة بعد";
  if (opts.rated === 0) return "الجلسات موجودة بلا تقديرات مسجّلة — لم يبدأ التقييم بعد";
  return null;
}

/** الترشيح المشترك لكل تقارير الأداء */
export function applyResultFilters(rows: EmployeeResult[], filters: ReportFilters): EmployeeResult[] {
  const threshold = effectiveThreshold(filters);
  let out = rows.filter(
    (r) =>
      matchesMulti(r.employeeType, filters.employeeTypes) &&
      matchesMulti(r.personId, filters.personIds) &&
      matchesMulti(r.yearKey, filters.cycleIds) &&
      matchesMulti(r.jobTitle, filters.jobTitles) &&
      matchesMulti(r.department, filters.departments) &&
      matchesMulti(r.cycleStatus, filters.statuses) &&
      (!filters.search ||
        [r.personName, r.jobTitle ?? "", r.department ?? "", r.modelName].some((v) => v.includes(filters.search!.trim()))),
  );

  if (filters.minScore !== undefined) out = out.filter((r) => r.resultPercent !== null && r.resultPercent >= filters.minScore!);
  if (filters.maxScore !== undefined) out = out.filter((r) => r.resultPercent !== null && r.resultPercent <= filters.maxScore!);

  const flags = filters.flags ?? [];
  if (flags.includes("lowPerformers")) out = out.filter((r) => isLowPerformer(r, threshold));
  if (flags.includes("incomplete")) out = out.filter((r) => !r.completed);
  return out;
}

/* ─────────────────────── التقرير الإحصائي (§7.4) ─────────────────────── */

export type ResultStatistics = {
  total: number;
  evaluated: number;
  incomplete: number;
  average: number | null;
  byBand: { band: string; count: number }[];
  byType: { type: EmployeeType; count: number; average: number | null }[];
  lowPerformers: EmployeeResult[];
  threshold: number;
  recurringStrengths: { text: string; count: number }[];
  recurringWeaknesses: { text: string; count: number }[];
  weakCriteria: { criterion: string; count: number }[];
};

/** الإحصاء مبنيّ على الصفوف المرشَّحة نفسها — الأرقام والأسماء تعودان للمجموعة ذاتها */
export function summarizeResults(rows: EmployeeResult[], threshold: number): ResultStatistics {
  const evaluated = rows.filter((r) => r.resultPercent !== null);
  const average =
    evaluated.length > 0
      ? Math.round((evaluated.reduce((s, r) => s + (r.resultPercent ?? 0), 0) / evaluated.length) * 10) / 10
      : null;

  const bandCounts = new Map<string, number>();
  for (const r of rows) bandCounts.set(r.band, (bandCounts.get(r.band) ?? 0) + 1);

  const types: EmployeeType[] = ["معلم", "موظف إداري"];
  const byType = types.map((type) => {
    const subset = evaluated.filter((r) => r.employeeType === type);
    return {
      type,
      count: rows.filter((r) => r.employeeType === type).length,
      average:
        subset.length > 0 ? Math.round((subset.reduce((s, r) => s + (r.resultPercent ?? 0), 0) / subset.length) * 10) / 10 : null,
    };
  });

  return {
    total: rows.length,
    evaluated: evaluated.length,
    incomplete: rows.filter((r) => !r.completed).length,
    average,
    byBand: [...bandCounts.entries()].map(([band, count]) => ({ band, count })),
    byType,
    lowPerformers: evaluated.filter((r) => isLowPerformer(r, threshold)).sort((a, b) => (a.resultPercent ?? 0) - (b.resultPercent ?? 0)),
    threshold,
    recurringStrengths: tally(rows.flatMap((r) => r.strengths)),
    recurringWeaknesses: tally(rows.flatMap((r) => r.weaknesses)),
    weakCriteria: tally(rows.flatMap((r) => r.weakCriteria)).map((t) => ({ criterion: t.text, count: t.count })),
  };
}

/** تكرار النصوص السردية — تطابق نصي تام بعد التشذيب، بلا تقارب لغوي مُختلق */
function tally(values: string[]): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ar"));
}

/* ─────────────────── سير التقرير الفردي (§7.3) ─────────────────── */

export type IndividualCandidate = { personId: string; name: string; type: EmployeeType; cycleCount: number };

/** الموظفون المتاحون للتقرير الفردي، مرشَّحين بالنوع — الخطوتان الأولى والثانية */
export async function loadIndividualCandidates(type?: EmployeeType): Promise<IndividualCandidate[]> {
  const excluded = await getExcludedIdSets();
  const rows = await db
    .select({ id: people.id, name: people.fullName, category: people.category, employeeType: people.employeeType })
    .from(people)
    .orderBy(asc(people.fullName));
  const cycleRows = await db.select({ personId: perfCycles.personId }).from(perfCycles);
  const counts = new Map<string, number>();
  for (const c of cycleRows) counts.set(c.personId, (counts.get(c.personId) ?? 0) + 1);

  return rows
    .filter((p) => !excluded.people.has(p.id))
    .map((p) => ({
      personId: p.id,
      name: orFallback(p.name, "بدون اسم"),
      type: employeeTypeOf(p),
      cycleCount: counts.get(p.id) ?? 0,
    }))
    .filter((p) => (type ? p.type === type : true));
}

/** دورات موظف بعينه للخطوة الثالثة — مع سبب واضح حين لا توجد بيانات كافية */
export async function loadIndividualCycles(personId: string): Promise<EmployeeResult[]> {
  const all = await loadEmployeeResults({ personIds: [personId] });
  return all.sort((a, b) => a.yearKey.localeCompare(b.yearKey));
}

/** الرسالة التي يطلبها التكليف حرفياً حين لا توجد بيانات كافية */
export const NO_INDIVIDUAL_DATA_MESSAGE =
  "لا توجد دورة أداء تحتوي بيانات كافية لهذا الموظف في الفترة المختارة.";

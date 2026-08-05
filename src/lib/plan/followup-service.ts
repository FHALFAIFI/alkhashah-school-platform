import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { planYears, programs, programFollowups } from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { programsEvidenceSummary } from "@/lib/plan/program-service";
import { programLifecycle } from "@/lib/plan/lifecycle";
import {
  isoWeekKey,
  isValidWeekKey,
  normalizeWeeklyStatus,
  previousWeekKey,
  weeklyGroup,
  NO_WEEKLY_UPDATE_LABEL,
  type WeeklyGroup,
} from "@/lib/plan/followup";
import { matchesMulti } from "@/lib/reports/loaders";
import { type ReportFilters } from "@/lib/reports/filters";

/**
 * **مصدر المتابعة الأسبوعية الواحد** (v2.5.0 §6.1).
 *
 * قبل هذا الإصدار كان لصفحة `/plan/followup` استعلامها ولتقرير «المتابعة الأسبوعية»
 * استعلام آخر، وكانا يختلفان في أمور جوهرية: التقرير كان يقرأ **أسبوع اليوم دائماً**
 * ويتجاهل الأسبوع المختار، ويصنّف بحقل الحالة الخام بدل التجميع الصادق الذي تعرضه
 * الشاشة، ويُدخل البرامج المغلقة في القائمة نفسها. فكان المدير يرى رقمين مختلفين
 * للأسبوع نفسه.
 *
 * الآن: استعلام واحد هنا، والشاشة تعرضه وتحرّره، والتقرير يعرضه ويُصدّره فقط. أي اختلاف
 * بينهما بعد اليوم عيب لا اجتهاد — يثبّت ذلك `tests/integration/followup-parity.test.ts`.
 *
 * ما **لا** يخرج من هنا: نسبة إنجاز مُدخلة يدوياً في المتابعة. أُزيلت من النموذج ومن كل
 * حساب (§6.2)؛ التقدم المعتمد هو `programs.progress` وحده (§6.4)، والعمود التاريخي
 * `program_followups.progress_snapshot` يبقى للسجلات القديمة ولا يُكتب ولا يُقرأ كحقيقة.
 */

export type WeeklyRow = {
  programId: string;
  seq: number;
  name: string;
  domain: string;
  owner: string;
  /** حالة الأسبوع المختار كما سُجِّلت — أو «لم يتم التحديث هذا الأسبوع» */
  weekStatus: string;
  /** التجميع الصادق المشترك بين الشاشة والتقرير */
  group: WeeklyGroup;
  /** الحالة الجارية للبرنامج (محور مستقل عن المتابعة الأسبوعية — §6.4) */
  executionStatus: string;
  /** التقدم المعتمد من سجل البرنامج — لا من إدخال المتابعة */
  progress: number;
  lifecycle: string;
  approval: string;
  note: string;
  /** ما أُنجز هذا الأسبوع والعوائق والإجراء المطلوب والخطوة التالية (§6.3) */
  completedWork: string;
  obstacles: string;
  requiredAction: string;
  nextStep: string;
  evidenceUpdate: string;
  interventionNeeded: boolean;
  lastFollowupAt: Date | null;
  evidenceCount: number;
  evidenceLatestAt: Date | null;
  updatedThisWeek: boolean;
  closedAt: Date | null;
  completedAt: Date | null;
  /** ملاحظة الأسبوع السابق — تُعرض حين لا يوجد تحديث لهذا الأسبوع */
  previousNote: string | null;
  previousWeekKey: string | null;
};

export type WeeklyFollowupResult = {
  week: string;
  currentWeek: string;
  isCurrentWeek: boolean;
  /** كل البرامج المعتمدة المفتوحة بعد الترشيح */
  rows: WeeklyRow[];
  /** البرامج المغلقة — تُعرض في ملخص منفصل ولا تُطالَب بمتابعة */
  closed: { programId: string; seq: number; name: string; closedAt: Date | null }[];
  /** الإجماليات قبل الترشيح — كي لا يبدو الترشيح كنقص في البيانات */
  totalOpen: number;
  updatedCount: number;
};

/** تطبيع مفتاح الأسبوع الوارد من المستخدم — غير الصالح يعود إلى الأسبوع الحالي */
export function resolveWeek(requested: string | undefined): string {
  const current = isoWeekKey();
  return requested && isValidWeekKey(requested) ? requested : current;
}

/**
 * تحميل المتابعة الأسبوعية للأسبوع المطلوب، مرشَّحةً (§6.6).
 *
 * الترشيح كله يُطبَّق على المجموعة نفسها التي تراها الشاشة، فالتقرير والتصدير والشاشة
 * تُجيب السؤال ذاته.
 */
export async function loadWeeklyFollowup(opts: {
  week?: string;
  filters?: ReportFilters;
}): Promise<WeeklyFollowupResult> {
  const filters = opts.filters ?? {};
  const week = resolveWeek(opts.week ?? filters.week);
  const currentWeek = isoWeekKey();
  const prevWeek = previousWeekKey(week);

  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];
  if (!activeYear) {
    return { week, currentWeek, isCurrentWeek: week === currentWeek, rows: [], closed: [], totalOpen: 0, updatedCount: 0 };
  }

  const excluded = await getExcludedIdSets();
  const approved = (
    await db
      .select()
      .from(programs)
      .where(
        and(
          eq(programs.planYearId, activeYear.id),
          notSynthetic(programs.id, excluded.programs),
          isNull(programs.archivedAt),
        ),
      )
      .orderBy(asc(programs.seq))
  ).filter((p) => p.status === "معتمد");

  const open = approved.filter((p) => !p.closedAt);
  const closedPrograms = approved.filter((p) => p.closedAt);
  const openIds = open.map((p) => p.id);

  // الأسبوع المختار وسابقه فقط — لا يُقرأ التاريخ كله لبناء شاشة أسبوع واحد
  const weekRows = openIds.length
    ? await db
        .select()
        .from(programFollowups)
        .where(
          and(
            inArray(programFollowups.programId, openIds),
            inArray(programFollowups.weekKey, prevWeek ? [week, prevWeek] : [week]),
          ),
        )
    : [];
  const thisWeek = new Map(weekRows.filter((f) => f.weekKey === week).map((f) => [f.programId, f]));
  const prev = new Map(weekRows.filter((f) => f.weekKey === prevWeek).map((f) => [f.programId, f]));
  const evidence = await programsEvidenceSummary(openIds);

  const all: WeeklyRow[] = open.map((p) => {
    const f = thisWeek.get(p.id);
    const ev = evidence.get(p.id) ?? { count: 0, latestAt: null };
    return {
      programId: p.id,
      seq: p.seq,
      name: p.name,
      domain: (p.domain ?? "").trim() || "بدون تصنيف",
      owner: (p.ownerPosition ?? "").trim() || "بدون مسؤول",
      weekStatus: normalizeWeeklyStatus(f?.executionStatus) ?? NO_WEEKLY_UPDATE_LABEL,
      group: weeklyGroup({
        closedAt: p.closedAt,
        completedAt: p.completedAt,
        weekStatus: f?.executionStatus ?? null,
        currentStatus: p.executionStatus,
      }),
      executionStatus: p.executionStatus,
      progress: p.progress,
      lifecycle: programLifecycle(p),
      approval: p.status,
      note: f?.note ?? "",
      completedWork: f?.completedWork ?? "",
      obstacles: f?.obstacles ?? "",
      requiredAction: f?.requiredAction ?? "",
      nextStep: f?.nextStep ?? "",
      evidenceUpdate: f?.evidenceUpdate ?? "",
      interventionNeeded: f?.interventionNeeded ?? false,
      lastFollowupAt: p.lastReviewAt,
      evidenceCount: ev.count,
      evidenceLatestAt: ev.latestAt,
      updatedThisWeek: Boolean(f),
      closedAt: p.closedAt,
      completedAt: p.completedAt,
      previousNote: prev.get(p.id)?.note ?? null,
      previousWeekKey: prevWeek,
    };
  });

  const rows = applyWeeklyFilters(all, filters);

  return {
    week,
    currentWeek,
    isCurrentWeek: week === currentWeek,
    rows,
    closed: closedPrograms.map((p) => ({ programId: p.id, seq: p.seq, name: p.name, closedAt: p.closedAt })),
    totalOpen: all.length,
    updatedCount: all.filter((r) => r.updatedThisWeek).length,
  };
}

/** الترشيح المشترك — تعريف واحد للشاشة والتقرير والتصدير (§6.6) */
export function applyWeeklyFilters(rows: WeeklyRow[], filters: ReportFilters): WeeklyRow[] {
  let out = rows.filter(
    (r) =>
      matchesMulti(r.domain, filters.domains) &&
      matchesMulti(r.owner, filters.owners) &&
      matchesMulti(r.programId, filters.programIds) &&
      // الحالة تُطابق حالة الأسبوع أو الحالة الجارية — المدير يفكّر بالاثنتين
      (!filters.statuses?.length ||
        filters.statuses.includes(r.weekStatus) ||
        filters.statuses.includes(r.executionStatus) ||
        filters.statuses.includes(r.group)) &&
      (!filters.search || [r.name, r.domain, r.owner, r.note].some((v) => v.includes(filters.search!.trim()))),
  );

  const flags = filters.flags ?? [];
  if (flags.includes("delayed")) out = out.filter((r) => r.weekStatus === "متأخر" || r.executionStatus === "متأخر");
  if (flags.includes("notUpdated")) out = out.filter((r) => !r.updatedThisWeek);
  if (flags.includes("needsIntervention")) out = out.filter((r) => r.interventionNeeded);
  if (flags.includes("hasEvidence")) out = out.filter((r) => r.evidenceCount > 0);
  if (flags.includes("noEvidence")) out = out.filter((r) => r.evidenceCount === 0);
  return out;
}

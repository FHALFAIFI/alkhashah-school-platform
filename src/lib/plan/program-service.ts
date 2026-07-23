import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  programActivities,
  activityDeliverables,
  activityEvidenceRequirements,
  programs,
  evidenceItems,
  evidenceLinks,
  people,
} from "@/db/schema";
import {
  computeProgramProgressFromActivities,
  WEIGHTING_MODE,
  type WeightingMode,
} from "./activity-progress";
import { computeReadiness, type ReadinessInput, type ReadinessResult } from "./readiness";

/**
 * قراءة البرنامج بأنشطته — المصدر الوحيد لتقدم التنفيذ والجاهزية في الواجهة (D-020).
 * المعالم القديمة لا تُقرأ هنا إطلاقاً؛ فلا احتساب مزدوج ولا مفهوم موازٍ للمستخدم.
 */

export type ActivityRow = typeof programActivities.$inferSelect;

export type ActivityView = ActivityRow & {
  ownerName: string | null;
  deliverables: (typeof activityDeliverables.$inferSelect)[];
  evidenceRequirements: ((typeof activityEvidenceRequirements.$inferSelect) & { satisfiedCount: number })[];
  /** عدد الشواهد غير المؤرشفة المرتبطة بالنشاط ككل */
  evidenceCount: number;
  /** الوزن الفعلي المطبَّق بعد وضع الوزن — للعرض */
  effectiveWeight: number;
};

/** يُحصي روابط الشواهد غير المؤرشفة لمجموعة أنشطة، مفصولةً حسب المفتاح الفرعي (معرّف المتطلب). */
async function evidenceCountsForActivities(activityIds: string[]) {
  if (activityIds.length === 0) return { byActivity: new Map<string, number>(), byRequirement: new Map<string, number>() };

  const rows = await db
    .select({
      entityId: evidenceLinks.entityId,
      subKey: evidenceLinks.subKey,
      role: evidenceItems.role,
    })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(
      and(
        eq(evidenceLinks.entityType, "activity"),
        inArray(evidenceLinks.entityId, activityIds),
        // الشواهد المؤرشفة لا تُحتسب في الاستيفاء
        isNull(evidenceItems.archivedAt),
      ),
    );

  const byActivity = new Map<string, number>();
  const byRequirement = new Map<string, number>();
  for (const r of rows) {
    byActivity.set(r.entityId, (byActivity.get(r.entityId) ?? 0) + 1);
    if (r.subKey) byRequirement.set(r.subKey, (byRequirement.get(r.subKey) ?? 0) + 1);
  }
  return { byActivity, byRequirement };
}

export async function listActivities(programId: string, opts: { includeArchived?: boolean } = {}): Promise<ActivityView[]> {
  const where = opts.includeArchived
    ? eq(programActivities.programId, programId)
    : and(eq(programActivities.programId, programId), isNull(programActivities.archivedAt));

  const acts = await db
    .select()
    .from(programActivities)
    .where(where)
    .orderBy(asc(programActivities.sortOrder), asc(programActivities.createdAt));
  if (acts.length === 0) return [];

  const ids = acts.map((a) => a.id);
  const ownerIds = [...new Set(acts.map((a) => a.ownerPersonId).filter((x): x is string => !!x))];

  const [dels, reqs, owners, counts, program] = await Promise.all([
    db.select().from(activityDeliverables).where(inArray(activityDeliverables.activityId, ids)).orderBy(asc(activityDeliverables.sortOrder)),
    db.select().from(activityEvidenceRequirements).where(inArray(activityEvidenceRequirements.activityId, ids)).orderBy(asc(activityEvidenceRequirements.sortOrder)),
    ownerIds.length > 0
      ? db.select({ id: people.id, fullName: people.fullName }).from(people).where(inArray(people.id, ownerIds))
      : Promise.resolve([] as { id: string; fullName: string }[]),
    evidenceCountsForActivities(ids),
    db.select({ mode: programs.weightingMode }).from(programs).where(eq(programs.id, programId)),
  ]);

  const ownerName = new Map(owners.map((o) => [o.id, o.fullName]));
  const mode = (program[0]?.mode ?? WEIGHTING_MODE.equal) as WeightingMode;
  const { effectiveWeights } = await import("./activity-progress");
  const weights = effectiveWeights(acts, mode);

  return acts.map((a) => ({
    ...a,
    ownerName: a.ownerPersonId ? ownerName.get(a.ownerPersonId) ?? null : null,
    deliverables: dels.filter((d) => d.activityId === a.id),
    evidenceRequirements: reqs
      .filter((r) => r.activityId === a.id)
      .map((r) => ({ ...r, satisfiedCount: counts.byRequirement.get(r.id) ?? 0 })),
    evidenceCount: counts.byActivity.get(a.id) ?? 0,
    effectiveWeight: weights.get(a.id) ?? 0,
  }));
}

export type ProgramOverview = {
  program: typeof programs.$inferSelect;
  activities: ActivityView[];
  progress: ReturnType<typeof computeProgramProgressFromActivities>;
  readiness: ReadinessResult;
};

/** كل ما تحتاجه صفحة البرنامج: الأنشطة + التقدم + الجاهزية، محسوبة من مصدر واحد. */
export async function getProgramOverview(programId: string): Promise<ProgramOverview | null> {
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return null;

  const activities = await listActivities(programId);
  const mode = program.weightingMode as WeightingMode;
  const progress = computeProgramProgressFromActivities(activities, mode);

  const readinessInput: ReadinessInput = {
    programId,
    program: {
      name: program.name,
      domain: program.domain,
      generalGoal: program.generalGoal,
      specificGoal: program.specificGoal,
      ownerPersonId: program.ownerPersonId,
      ownerPosition: program.ownerPosition,
      hijriStart: program.hijriStart,
      hijriEnd: program.hijriEnd,
      status: program.status,
      weightingMode: mode,
    },
    activities: activities.map((a) => ({ ...a, requiredForCompletion: a.requiredForCompletion })),
    deliverables: activities.flatMap((a) => a.deliverables.map((d) => ({ ...d, activityId: a.id }))),
    evidenceRequirements: activities.flatMap((a) =>
      a.evidenceRequirements.map((r) => ({
        id: r.id,
        activityId: a.id,
        label: r.label,
        required: r.required,
        minCount: r.minCount,
        satisfiedCount: r.satisfiedCount,
      })),
    ),
  };

  return { program, activities, progress, readiness: computeReadiness(readinessInput) };
}

/**
 * يعيد احتساب تقدم البرنامج من أنشطته ويحفظه.
 * يُستدعى بعد كل تغيير على نشاط. المصدر: الأنشطة فقط.
 */
export async function recomputeProgramProgress(programId: string): Promise<number> {
  const [program] = await db.select({ mode: programs.weightingMode }).from(programs).where(eq(programs.id, programId));
  if (!program) return 0;

  const acts = await db
    .select()
    .from(programActivities)
    .where(and(eq(programActivities.programId, programId), isNull(programActivities.archivedAt)));

  const result = computeProgramProgressFromActivities(acts, program.mode as WeightingMode);
  await db
    .update(programs)
    .set({ progress: result.display, updatedAt: new Date() })
    .where(eq(programs.id, programId));
  return result.display;
}

/** الترتيب التالي لنشاط جديد داخل البرنامج. */
export async function nextActivitySortOrder(programId: string): Promise<number> {
  const [row] = await db
    .select({ maxOrder: sql<number>`coalesce(max(sort_order), -1)::int` })
    .from(programActivities)
    .where(eq(programActivities.programId, programId));
  return (row?.maxOrder ?? -1) + 1;
}

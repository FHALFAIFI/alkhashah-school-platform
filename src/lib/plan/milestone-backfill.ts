import "server-only";
import { eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { programActivities, programMilestones, programs } from "@/db/schema";
import { ACTIVITY_STATUS } from "./activity-progress";

/**
 * نقل المعالم القديمة إلى الأنشطة (D-020).
 *
 * الضمانات:
 *   - كل معلم قديم ينتقل إلى **نشاط واحد بالضبط** — يفرضه القيد الفريد
 *     `activities_migrated_milestone_unique` على `migrated_from_milestone_id`.
 *   - **قابل لإعادة التشغيل**: الإدراج `onConflictDoNothing` على المرجع الفريد، فإعادة
 *     التنفيذ أو استئنافه بعد فشل لا تنتج نسخاً مكررة.
 *   - **لا اختلاق لقيم**: ما لا يوجد في المعلم القديم يبقى فارغاً في النشاط.
 *     المعالم لا تحمل مسؤولاً ولا تواريخ مخططة، فتبقى تلك الحقول NULL.
 *   - **الجدول القديم لا يُمس**: لا تحديث ولا حذف ولا تحويل — قراءة فقط.
 *
 * تحويل الحالة (معلم ← نشاط):
 *   لم يبدأ → لم يبدأ · قيد التنفيذ → قيد التنفيذ · مكتمل → مكتمل
 *   أي قيمة أخرى غير متوقعة تُنقل كما هي ويُبلَّغ عنها في المطابقة بدل ابتلاعها.
 */

const STATUS_MAP: Record<string, string> = {
  "لم يبدأ": ACTIVITY_STATUS.notStarted,
  "قيد التنفيذ": ACTIVITY_STATUS.inProgress,
  مكتمل: ACTIVITY_STATUS.completed,
};

export type BackfillResult = {
  /** عدد المعالم المرصودة قبل النقل — يُلتقط من الحياة لا من رقم ثابت */
  legacyCount: number;
  /** أنشطة أُنشئت في هذا التشغيل */
  created: number;
  /** معالم كانت منقولة مسبقاً (إعادة تشغيل آمنة) */
  alreadyMigrated: number;
  /** حالات قديمة غير متوقعة نُقلت كما هي */
  unmappedStatuses: string[];
};

/**
 * ينفّذ النقل في معاملة واحدة. لا يكتب في `program_milestones` إطلاقاً.
 * آمن التكرار: تشغيله مرتين لا يغيّر النتيجة.
 */
export async function backfillMilestonesToActivities(actorId?: string): Promise<BackfillResult> {
  return db.transaction(async (tx) => {
    const legacy = await tx.select().from(programMilestones).orderBy(programMilestones.programId, programMilestones.sortOrder);
    const legacyCount = legacy.length;

    const existing = await tx
      .select({ ref: programActivities.migratedFromMilestoneId })
      .from(programActivities)
      .where(isNotNull(programActivities.migratedFromMilestoneId));
    const already = new Set(existing.map((e) => e.ref as string));

    const unmapped = new Set<string>();
    let created = 0;
    let alreadyMigrated = 0;

    for (const m of legacy) {
      if (already.has(m.id)) {
        alreadyMigrated++;
        continue;
      }

      const mapped = STATUS_MAP[m.status];
      if (!mapped) unmapped.add(m.status);

      const inserted = await tx
        .insert(programActivities)
        .values({
          programId: m.programId,
          migratedFromMilestoneId: m.id,
          name: m.title,
          // المعالم لا تحمل وصفاً منفصلاً؛ الملاحظات تُنقل كما هي بلا تلفيق
          notes: m.notes,
          // المعلم يحمل موعداً نصياً واحداً — يُنقل كنهاية مخططة، والبداية تبقى فارغة
          plannedEnd: m.dueText,
          status: mapped ?? m.status,
          progress: Math.max(0, Math.min(100, m.progress)),
          // الوزن القديم يُحفظ كوزن مخصص، فتبقى النتيجة مكافئة عند اختيار الوضع المخصص
          weight: m.weight,
          requiredForCompletion: true,
          sortOrder: m.sortOrder,
          completedAt: m.completedAt,
          createdBy: actorId,
        })
        // إعادة التشغيل لا تُنتج تكراراً — القيد الفريد على المرجع القديم يحسم
        .onConflictDoNothing({ target: programActivities.migratedFromMilestoneId })
        .returning({ id: programActivities.id });

      if (inserted.length > 0) created++;
      else alreadyMigrated++;
    }

    return { legacyCount, created, alreadyMigrated, unmappedStatuses: [...unmapped] };
  });
}

export type ReconciliationRow = { checkAr: string; expected: number | string; actual: number | string; passed: boolean };

export type Reconciliation = {
  passed: boolean;
  rows: ReconciliationRow[];
  /** معالم بلا نشاط مقابل — يجب أن تكون صفراً */
  orphanMilestoneIds: string[];
  /** أنشطة تشير إلى معلم غير موجود — يجب أن تكون صفراً */
  danglingActivityIds: string[];
};

/**
 * برهان المطابقة بعد النقل. لا يكتب شيئاً.
 * يثبت: كل معلم مرة واحدة بالضبط، لا يتيم، لا ازدواج، ارتباط البرنامج ثابت،
 * التقدم مكافئ بعد التحول، ولا احتساب مزدوج.
 */
export async function reconcileMilestoneMigration(): Promise<Reconciliation> {
  const rows: ReconciliationRow[] = [];

  const [{ c: legacyCount }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(programMilestones);

  const [{ c: migratedCount }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(programActivities)
    .where(isNotNull(programActivities.migratedFromMilestoneId));

  rows.push({
    checkAr: "كل معلم قديم له نشاط مقابل",
    expected: legacyCount,
    actual: migratedCount,
    passed: legacyCount === migratedCount,
  });

  // معالم بلا نشاط (يتيمة)
  const orphans = await db.execute(sql`
    SELECT m.id::text AS id
    FROM program_milestones m
    LEFT JOIN program_activities a ON a.migrated_from_milestone_id = m.id
    WHERE a.id IS NULL
  `);
  const orphanMilestoneIds = (orphans.rows as { id: string }[]).map((r) => r.id);
  rows.push({
    checkAr: "لا معلم يتيم بلا نشاط",
    expected: 0,
    actual: orphanMilestoneIds.length,
    passed: orphanMilestoneIds.length === 0,
  });

  // ازدواج: القيد الفريد يمنعه، والفحص يثبته صراحةً
  const dupes = await db.execute(sql`
    SELECT migrated_from_milestone_id::text AS id, count(*)::int AS n
    FROM program_activities
    WHERE migrated_from_milestone_id IS NOT NULL
    GROUP BY migrated_from_milestone_id
    HAVING count(*) > 1
  `);
  rows.push({
    checkAr: "لا نشاط مزدوج لمعلم واحد",
    expected: 0,
    actual: dupes.rows.length,
    passed: dupes.rows.length === 0,
  });

  // أنشطة تشير إلى معلم غير موجود
  const dangling = await db.execute(sql`
    SELECT a.id::text AS id
    FROM program_activities a
    LEFT JOIN program_milestones m ON m.id = a.migrated_from_milestone_id
    WHERE a.migrated_from_milestone_id IS NOT NULL AND m.id IS NULL
  `);
  const danglingActivityIds = (dangling.rows as { id: string }[]).map((r) => r.id);
  rows.push({
    checkAr: "لا نشاط يشير إلى معلم غير موجود",
    expected: 0,
    actual: danglingActivityIds.length,
    passed: danglingActivityIds.length === 0,
  });

  // ارتباط البرنامج لم يتغير
  const mismatched = await db.execute(sql`
    SELECT a.id::text AS id
    FROM program_activities a
    JOIN program_milestones m ON m.id = a.migrated_from_milestone_id
    WHERE a.program_id <> m.program_id
  `);
  rows.push({
    checkAr: "ارتباط البرنامج لكل نشاط مطابق لمعلمه",
    expected: 0,
    actual: mismatched.rows.length,
    passed: mismatched.rows.length === 0,
  });

  // التقدم مكافئ: الوزن والإنجاز منقولان حرفياً
  const valueDrift = await db.execute(sql`
    SELECT a.id::text AS id
    FROM program_activities a
    JOIN program_milestones m ON m.id = a.migrated_from_milestone_id
    WHERE a.weight IS DISTINCT FROM m.weight OR a.progress <> m.progress
  `);
  rows.push({
    checkAr: "الوزن والإنجاز منقولان دون انحراف",
    expected: 0,
    actual: valueDrift.rows.length,
    passed: valueDrift.rows.length === 0,
  });

  // الجدول القديم لم يُمس: عدد البرامج المرتبطة به ثابت
  const [{ c: legacyPrograms }] = await db
    .select({ c: sql<number>`count(distinct program_id)::int` })
    .from(programMilestones);
  const [{ c: activityPrograms }] = await db
    .select({ c: sql<number>`count(distinct program_id)::int` })
    .from(programActivities)
    .where(isNotNull(programActivities.migratedFromMilestoneId));
  rows.push({
    checkAr: "عدد البرامج المغطاة متطابق",
    expected: legacyPrograms,
    actual: activityPrograms,
    passed: legacyPrograms === activityPrograms,
  });

  return {
    passed: rows.every((r) => r.passed),
    rows,
    orphanMilestoneIds,
    danglingActivityIds,
  };
}

/** لقطة عدّية سريعة لتقرير ما قبل النقل. */
export async function migrationCounts(): Promise<{ milestones: number; activities: number; migratedActivities: number; programs: number }> {
  const [[m], [a], [ma], [p]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(programMilestones),
    db.select({ c: sql<number>`count(*)::int` }).from(programActivities),
    db.select({ c: sql<number>`count(*)::int` }).from(programActivities).where(isNotNull(programActivities.migratedFromMilestoneId)),
    db.select({ c: sql<number>`count(*)::int` }).from(programs),
  ]);
  return { milestones: m.c, activities: a.c, migratedActivities: ma.c, programs: p.c };
}

/** تقدم برنامج واحد محسوباً من معالمه القديمة — لإثبات التكافؤ بعد التحول. */
export async function legacyProgramProgress(programId: string): Promise<number> {
  const ms = await db.select().from(programMilestones).where(eq(programMilestones.programId, programId));
  if (ms.length === 0) return 0;
  const totalWeight = ms.reduce((s, m) => s + m.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = ms.reduce((s, m) => s + m.weight * Math.max(0, Math.min(100, m.progress)), 0);
  return Math.round(weighted / totalWeight);
}

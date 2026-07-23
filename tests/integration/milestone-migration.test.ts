import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

/**
 * يبني نسخة أمينة من التوزيع المرصود في الإنتاج (D-022):
 * 26 برنامجاً — 25 منها بخمسة معالم و1 بأربعة، كل معلم وزنه 20 وحالته «لم يبدأ».
 * المجموع 129 معلماً، وهو العدد الحي وليس رقم 64 القديم.
 */
async function seedProductionShapedMilestones() {
  const { db } = await import("@/db");
  const { planYears, programs, programMilestones } = await import("@/db/schema");

  const [year] = await db.insert(planYears).values({ key: "mig-1448-1449", nameAr: "سنة النقل" }).returning();
  const titles = [
    "اعتماد الاستعداد قبل عودة الطلاب",
    "مراجعة قبل إجازة الخريف",
    "مراجعة منتصف العام",
    "مراجعة بعد عيد الفطر",
    "قياس نهائي وإغلاق",
  ];

  let total = 0;
  for (let p = 1; p <= 26; p++) {
    const [prog] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: p, domain: "مجال", name: `برنامج ${p}` })
      .returning();
    // البرنامج الأخير بأربعة معالم فقط — يعيد إنتاج الحالة التي مجموع أوزانها 80
    const n = p === 26 ? 4 : 5;
    for (let i = 0; i < n; i++) {
      await db.insert(programMilestones).values({
        programId: prog.id,
        sortOrder: i,
        title: titles[i],
        weight: 20,
        status: "لم يبدأ",
        progress: 0,
        dueText: `1448/${i + 3}/1`,
      });
      total++;
    }
  }
  return { yearId: year.id, total };
}

describe("نقل المعالم إلى الأنشطة (D-020) — المطابقة", () => {
  it("ينقل كل معلم مرصود إلى نشاط واحد بالضبط، والمطابقة تمر", async () => {
    await truncateAll(pool);
    const { total } = await seedProductionShapedMilestones();
    expect(total).toBe(129); // العدد الحي المرصود في الإنتاج، لا الرقم القديم 64

    const { backfillMilestonesToActivities, reconcileMilestoneMigration, migrationCounts } = await import(
      "@/lib/plan/milestone-backfill"
    );

    const before = await migrationCounts();
    expect(before.milestones).toBe(129);
    expect(before.activities).toBe(0);

    const result = await backfillMilestonesToActivities();
    expect(result.legacyCount).toBe(129);
    expect(result.created).toBe(129);
    expect(result.alreadyMigrated).toBe(0);
    expect(result.unmappedStatuses).toEqual([]);

    const rec = await reconcileMilestoneMigration();
    expect(rec.orphanMilestoneIds).toEqual([]);
    expect(rec.danglingActivityIds).toEqual([]);
    expect(rec.rows.filter((r) => !r.passed)).toEqual([]);
    expect(rec.passed).toBe(true);
  });

  it("إعادة التشغيل لا تنتج تكراراً — النقل آمن التكرار", async () => {
    const { backfillMilestonesToActivities, reconcileMilestoneMigration, migrationCounts } = await import(
      "@/lib/plan/milestone-backfill"
    );

    const second = await backfillMilestonesToActivities();
    expect(second.created).toBe(0);
    expect(second.alreadyMigrated).toBe(129);

    const third = await backfillMilestonesToActivities();
    expect(third.created).toBe(0);

    const counts = await migrationCounts();
    expect(counts.migratedActivities).toBe(129);
    expect(counts.activities).toBe(129);
    expect((await reconcileMilestoneMigration()).passed).toBe(true);
  });

  it("الجدول القديم لم يُمس ولم يُحذف منه صف", async () => {
    const { db } = await import("@/db");
    const { programMilestones } = await import("@/db/schema");
    const rows = await db.select().from(programMilestones);
    expect(rows.length).toBe(129);
    // القيم الأصلية كما هي
    expect(rows.every((m) => m.weight === 20 && m.status === "لم يبدأ" && m.progress === 0)).toBe(true);
  });

  it("التقدم بعد التحول مكافئ للحساب القديم — ولا احتساب مزدوج", async () => {
    const { db } = await import("@/db");
    const { programs, programActivities } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { legacyProgramProgress } = await import("@/lib/plan/milestone-backfill");
    const { computeProgramProgressFromActivities, WEIGHTING_MODE } = await import("@/lib/plan/activity-progress");

    // البرامج تبقى في الوضع المتساوي بعد النقل (لا يُستنتج الوضع المخصص من قيم الوزن القديمة).
    // بما أن كل الأوزان القديمة متساوية، يعطي الوضع المتساوي نفس نتيجة الحساب القديم بالضبط.
    const all = await db.select().from(programs);
    for (const prog of all) {
      expect(prog.weightingMode).toBe(WEIGHTING_MODE.equal);
      const acts = await db.select().from(programActivities).where(eq(programActivities.programId, prog.id));
      const legacy = await legacyProgramProgress(prog.id);
      const now = computeProgramProgressFromActivities(acts, WEIGHTING_MODE.equal);
      expect(now.display).toBe(legacy);
    }

    // لا احتساب مزدوج: عدد الأنشطة = عدد المعالم بالضبط، لا مجموعهما
    const { migrationCounts } = await import("@/lib/plan/milestone-backfill");
    const counts = await migrationCounts();
    expect(counts.activities).toBe(129);
    expect(counts.milestones).toBe(129);
  });

  it("البرنامج ذو الأوزان 80 يظهر مخالفاً في الوضع المخصص بدل أن يُطبَّع صامتاً", async () => {
    const { db } = await import("@/db");
    const { programs, programActivities } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { validateWeights, WEIGHTING_MODE } = await import("@/lib/plan/activity-progress");

    const [prog26] = await db.select().from(programs).where(eq(programs.seq, 26));
    const acts = await db.select().from(programActivities).where(eq(programActivities.programId, prog26.id));
    expect(acts.length).toBe(4);

    // الأوزان القديمة (20 لكل نشاط) محفوظة للتتبع فقط
    expect(acts.every((a) => a.weight === 20)).toBe(true);

    // الوضع الفعلي بعد النقل متساوٍ وصالح — لم يُستنتج المخصص من قيم الوزن القديمة
    const [prog26row] = await db.select().from(programs).where(eq(programs.id, prog26.id));
    expect(prog26row.weightingMode).toBe(WEIGHTING_MODE.equal);
    expect(validateWeights(acts, WEIGHTING_MODE.equal).valid).toBe(true);

    // ولو اختار المستخدم المخصص لاحقاً فالمجموع 80 يمنع الإقفال ولا يُطبَّع صامتاً
    const v = validateWeights(acts, WEIGHTING_MODE.custom);
    expect(v.valid).toBe(false);
    expect(v.total).toBe(80);
  });

  it("النقل يحافظ على العنوان والترتيب والموعد وارتباط البرنامج، ولا يختلق قيماً", async () => {
    const { db } = await import("@/db");
    const { programMilestones, programActivities } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [m] = await db.select().from(programMilestones).limit(1);
    const [a] = await db.select().from(programActivities).where(eq(programActivities.migratedFromMilestoneId, m.id));

    expect(a.name).toBe(m.title);
    expect(a.programId).toBe(m.programId);
    expect(a.sortOrder).toBe(m.sortOrder);
    expect(a.plannedEnd).toBe(m.dueText);
    expect(a.weight).toBe(m.weight);
    expect(a.progress).toBe(m.progress);
    // المعالم لا تحمل مسؤولاً ولا بداية مخططة ولا وصفاً — تبقى فارغة بلا تلفيق
    expect(a.ownerPersonId).toBeNull();
    expect(a.plannedStart).toBeNull();
    expect(a.description).toBeNull();
  });

  it("المطابقة ترصد المعلم اليتيم بدل ابتلاعه", async () => {
    const { db } = await import("@/db");
    const { programMilestones, programs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { reconcileMilestoneMigration } = await import("@/lib/plan/milestone-backfill");

    const [prog] = await db.select().from(programs).where(eq(programs.seq, 1));
    const [orphan] = await db
      .insert(programMilestones)
      .values({ programId: prog.id, sortOrder: 99, title: "معلم أضيف بعد النقل", weight: 0 })
      .returning();

    const rec = await reconcileMilestoneMigration();
    expect(rec.passed).toBe(false);
    expect(rec.orphanMilestoneIds).toContain(orphan.id);

    // النقل مجدداً يعالجه دون تكرار البقية
    const { backfillMilestonesToActivities } = await import("@/lib/plan/milestone-backfill");
    const r = await backfillMilestonesToActivities();
    expect(r.created).toBe(1);
    expect((await reconcileMilestoneMigration()).passed).toBe(true);

    // تنظيف حتى لا يؤثر على ملفات أخرى
    await db.delete(programMilestones).where(eq(programMilestones.id, orphan.id));
  });
});

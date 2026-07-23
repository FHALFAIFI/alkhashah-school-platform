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

async function makeProgram(seq: number, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { planYears, programs } = await import("@/db/schema");
  const [year] = await db
    .select()
    .from(planYears)
    .limit(1)
    .then(async (r) => (r.length ? r : db.insert(planYears).values({ key: "act-yr", nameAr: "سنة" }).returning()));
  const [prog] = await db
    .insert(programs)
    .values({
      planYearId: year.id,
      seq,
      domain: "مجال",
      name: `برنامج ${seq}`,
      generalGoal: "هدف عام",
      specificGoal: "هدف تفصيلي",
      ownerPosition: "وكيل",
      hijriStart: "1448/3/2",
      hijriEnd: "1449/1/5",
      ...over,
    })
    .returning();
  return prog;
}

async function addActivity(programId: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { programActivities } = await import("@/db/schema");
  const [a] = await db
    .insert(programActivities)
    .values({ programId, name: "نشاط", ...over })
    .returning();
  return a;
}

describe("الأنشطة: التقدم والجاهزية والإقفال", () => {
  it("تقدم البرنامج يُحسب من الأنشطة ويُحفظ — والمعالم القديمة لا تُحتسب", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { programs, programMilestones } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { recomputeProgramProgress } = await import("@/lib/plan/program-service");

    const prog = await makeProgram(1);
    // معلم قديم مكتمل 100٪ — يجب ألا يؤثر على التقدم إطلاقاً
    await db.insert(programMilestones).values({
      programId: prog.id,
      title: "معلم قديم",
      weight: 100,
      progress: 100,
      status: "مكتمل",
    });

    await addActivity(prog.id, { name: "نشاط أ", status: "مكتمل", progress: 100 });
    await addActivity(prog.id, { name: "نشاط ب", status: "لم يبدأ", progress: 0 });

    const progress = await recomputeProgramProgress(prog.id);
    expect(progress).toBe(50); // من الأنشطة وحدها، لا 100 من المعلم القديم

    const [saved] = await db.select().from(programs).where(eq(programs.id, prog.id));
    expect(saved.progress).toBe(50);
  });

  it("النظرة الشاملة تفصل التقدم عن الجاهزية", async () => {
    await truncateAll(pool);
    const { getProgramOverview } = await import("@/lib/plan/program-service");
    const { db } = await import("@/db");
    const { activityEvidenceRequirements } = await import("@/db/schema");

    const prog = await makeProgram(2);
    const act = await addActivity(prog.id, { name: "نشاط مكتمل", status: "مكتمل", progress: 100 });
    await db.insert(activityEvidenceRequirements).values({
      activityId: act.id,
      label: "شاهد أثر",
      required: true,
      minCount: 1,
    });

    const o = await getProgramOverview(prog.id);
    expect(o!.progress.display).toBe(100);
    expect(o!.readiness.ready).toBe(false);
    expect(o!.readiness.missing.some((m) => m.labelAr.includes("شاهد أثر"))).toBe(true);
  });

  it("شاهد واحد مرتبط بالنشاط يستوفي المتطلب دون رفع ثانٍ", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { activityEvidenceRequirements, evidenceItems } = await import("@/db/schema");
    const { linkEvidence } = await import("@/lib/evidence");
    const { getProgramOverview } = await import("@/lib/plan/program-service");

    const prog = await makeProgram(3);
    const act = await addActivity(prog.id, { name: "نشاط", status: "مكتمل", progress: 100 });
    const [req] = await db
      .insert(activityEvidenceRequirements)
      .values({ activityId: act.id, label: "محضر", required: true, minCount: 1 })
      .returning();

    const [ev] = await db.insert(evidenceItems).values({ title: "محضر مشترك", kind: "text", textContent: "ن" }).returning();
    // المفتاح الفرعي = معرّف المتطلب
    await linkEvidence({ evidenceId: ev.id, entityType: "activity", entityId: act.id, subKey: req.id });
    // ونفس الشاهد يخدم البرنامج أيضاً بلا رفع ثانٍ
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: prog.id });

    const o = await getProgramOverview(prog.id);
    expect(o!.readiness.ready).toBe(true);
    expect(o!.activities[0].evidenceRequirements[0].satisfiedCount).toBe(1);

    const { evidenceUsage } = await import("@/lib/evidence");
    const usage = await evidenceUsage(ev.id);
    expect(usage.map((u) => u.entityType).sort()).toEqual(["activity", "program"]);
  });

  it("الشاهد المؤرشف لا يُحتسب في الاستيفاء", async () => {
    const { db } = await import("@/db");
    const { evidenceItems } = await import("@/db/schema");
    const { getProgramOverview } = await import("@/lib/plan/program-service");
    const { programs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    await db.update(evidenceItems).set({ archivedAt: new Date(), archivedReason: "نسخة قديمة" });
    const [prog] = await db.select().from(programs).where(eq(programs.seq, 3));
    const o = await getProgramOverview(prog.id);
    expect(o!.readiness.ready).toBe(false);
    expect(o!.activities[0].evidenceRequirements[0].satisfiedCount).toBe(0);
  });

  it("الإقفال الطبيعي محجوب عند وجود نواقص، ولقطة التجاوز تحفظها", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { programs, activityDeliverables } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { getProgramOverview } = await import("@/lib/plan/program-service");

    const prog = await makeProgram(4);
    const act = await addActivity(prog.id, { name: "نشاط", status: "مكتمل", progress: 100 });
    await db.insert(activityDeliverables).values({ activityId: act.id, name: "تقرير ختامي", required: true, completed: false });

    const before = await getProgramOverview(prog.id);
    expect(before!.readiness.ready).toBe(false);
    const missing = before!.readiness.missing.map((m) => m.labelAr);
    expect(missing.some((m) => m.includes("تقرير ختامي"))).toBe(true);

    // محاكاة ما يكتبه إجراء التجاوز
    const now = new Date();
    await db
      .update(programs)
      .set({
        completedAt: now,
        completionOverride: true,
        overrideReason: "قرار المدير لضيق الوقت قبل نهاية العام",
        overrideAt: now,
        overrideReadiness: before!.readiness.percent,
        overrideMissing: missing,
      })
      .where(eq(programs.id, prog.id));

    const [saved] = await db.select().from(programs).where(eq(programs.id, prog.id));
    expect(saved.completionOverride).toBe(true);
    expect(saved.overrideReadiness).toBe(before!.readiness.percent);
    // النواقص لا تختفي من السجل التاريخي
    expect(saved.overrideMissing).toEqual(missing);
    expect(saved.overrideMissing!.some((m) => m.includes("تقرير ختامي"))).toBe(true);
  });

  it("النشاط المؤرشف يخرج من التقدم ولا يمنع الجاهزية", async () => {
    await truncateAll(pool);
    const { getProgramOverview, recomputeProgramProgress } = await import("@/lib/plan/program-service");

    const prog = await makeProgram(5);
    await addActivity(prog.id, { name: "نشاط حي", status: "مكتمل", progress: 100 });
    await addActivity(prog.id, {
      name: "نشاط مؤرشف",
      status: "لم يبدأ",
      progress: 0,
      archivedAt: new Date(),
      archivedReason: "أُلغي",
    });

    expect(await recomputeProgramProgress(prog.id)).toBe(100);
    const o = await getProgramOverview(prog.id);
    expect(o!.activities.length).toBe(1);
    expect(o!.readiness.ready).toBe(true);
  });

  it("حذف نشاط منقول من معلم ممنوع — الأرشفة هي البديل", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { programMilestones } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");

    const prog = await makeProgram(6);
    const [m] = await db
      .insert(programMilestones)
      .values({ programId: prog.id, title: "معلم", weight: 100 })
      .returning();
    const act = await addActivity(prog.id, { name: "نشاط منقول", migratedFromMilestoneId: m.id });

    // بلا تبعيات، الطبقة تسمح — والحارس في الإجراء يمنع بسبب المرجع القديم
    const a = await assessDeletion("activity", act.id);
    expect(a.blocked).toBe(false);
    expect(a.alternativeAr).toContain("أرشف النشاط");
  });

  it("حذف برنامج له أنشطة ممنوع، والتبعيات تذكر الأنشطة صراحةً", async () => {
    await truncateAll(pool);
    const { assessDeletion } = await import("@/lib/safe-delete");
    const prog = await makeProgram(7);
    await addActivity(prog.id, { name: "نشاط" });

    const a = await assessDeletion("program", prog.id);
    expect(a.blocked).toBe(true);
    expect(a.dependencies.find((d) => d.type === "activities")?.count).toBe(1);
  });
});

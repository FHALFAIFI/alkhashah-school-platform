import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * تصنيف السجلات الاصطناعية بأدلة بنيوية — لا بالاسم وحده.
 * يثبت أن:
 *  - الأشخاص/البرامج من دفعة استيراد اسمها يحوي «تجريبي» تُصنَّف اصطناعية.
 *  - البرامج الرسمية (اسم دفعة حقيقي) ودفعة فارس لا تُصنَّف اصطناعية (تبقى ظاهرة).
 *  - اللجنة التي كل أعضائها اصطناعيون تُصنَّف بنيوياً، واجتماعاتها تنتشر معها.
 *  - السجل المسمّى «تجريبي» بلا مرسى بنيوي يذهب لدلو «مشتبَه به» فقط، لا للاستبعاد.
 */

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function seedFixture() {
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { importBatches } = await import("@/db/schema");
  const { people, programs, planYears } = await import("@/db/schema");
  const { programMilestones, programDeliverables, programKpis, programRisks, planBudgetItems, programFollowups, programChangeRequests, programRoadmapCells } = await import("@/db/schema");
  const { committees, committeeMembers, meetings } = await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: "t-syn", displayName: "اختبار", passwordHash: "x" }).returning();

  // سنة تخطيطية حقيقية + سنة عرض (demo)
  const [realYear] = await db.insert(planYears).values({ key: "1448-1449", nameAr: "العام 1448/1449هـ" }).returning();
  const [demoYear] = await db.insert(planYears).values({ key: "demo-1448", nameAr: "سنة عرض" }).returning();

  // دفعات: اصطناعية (اسم ملف يحوي تجريبي) + رسمية (خطة) + فارس (معاينة)
  const [synthBatch] = await db.insert(importBatches).values({ importType: "people", sourceFileName: "موظفون تجريبي آلي 12345.xlsx", status: "منفذة" }).returning();
  const [officialPlanBatch] = await db.insert(importBatches).values({ importType: "operational_plan", sourceFileName: "الخطة التشغيلية 1448-1449.xlsx", status: "منفذة" }).returning();
  const faresBatch = (await db.insert(importBatches).values({ importType: "people", sourceFileName: "بيانات الموظفين في فارس.xlsx", status: "معاينة" }).returning())[0];

  // أشخاص: اثنان اصطناعيان من الدفعة الاصطناعية + واحد حقيقي بلا دفعة اصطناعية
  const [synthP1] = await db.insert(people).values({ fullName: "تجريبي أول مثال", category: "معلم", importBatchId: synthBatch.id }).returning();
  const [synthP2] = await db.insert(people).values({ fullName: "تجريبي ثانٍ مثال", category: "موظف", importBatchId: synthBatch.id }).returning();
  const [realP] = await db.insert(people).values({ fullName: "أحمد الحقيقي", category: "معلم" }).returning();

  // برامج: رسمي (سنة حقيقية، دفعة رسمية) + اصطناعي (دفعة اصطناعية) + برنامج سنة العرض
  const [officialProg] = await db.insert(programs).values({ planYearId: realYear.id, seq: 1, domain: "القيادة", name: "برنامج التميز القيادي", importBatchId: officialPlanBatch.id }).returning();
  const [synthProg] = await db.insert(programs).values({ planYearId: realYear.id, seq: 2, domain: "مجال تجريبي", name: "برنامج تجريبي آلي أول", importBatchId: synthBatch.id }).returning();
  const [demoProg] = await db.insert(programs).values({ planYearId: demoYear.id, seq: 901, domain: "مجال عرض", name: "برنامج العرض", importBatchId: null }).returning();

  // برنامج مسمّى «تجريبي» لكن بلا مرسى بنيوي (سنة حقيقية، بلا دفعة) — مشتبَه به بالاسم فقط
  const [nameOnlyProg] = await db.insert(programs).values({ planYearId: realYear.id, seq: 3, domain: "مجال", name: "برنامج تجريبي يدوي", importBatchId: null }).returning();

  // لجنة اصطناعية (كل أعضائها اصطناعيون) + لجنة حقيقية (عضو حقيقي)
  const [synthCommittee] = await db.insert(committees).values({ planYearId: realYear.id, nameAr: "لجنة الاختبار", kind: "لجنة" }).returning();
  await db.insert(committeeMembers).values([
    { committeeId: synthCommittee.id, personId: synthP1.id, role: "رئيس" },
    { committeeId: synthCommittee.id, personId: synthP2.id, role: "عضو" },
  ]);
  const [realCommittee] = await db.insert(committees).values({ planYearId: realYear.id, nameAr: "لجنة التميز", kind: "لجنة" }).returning();
  await db.insert(committeeMembers).values([{ committeeId: realCommittee.id, personId: realP.id, role: "رئيس" }]);

  // اجتماع للجنة الاصطناعية — يجب أن ينتشر التصنيف إليه
  const [synthMeeting] = await db.insert(meetings).values({ committeeId: synthCommittee.id, seq: 1, title: "اجتماع الاختبار" }).returning();

  // سجلات تابعة: للبرنامج الاصطناعي (بالمفتاح programId) وللسنة العرضية (بالمفتاح planYearId)
  const [synthMilestone] = await db.insert(programMilestones).values({ programId: synthProg.id, title: "معلم تجريبي", weight: 100 }).returning();
  const [officialMilestone] = await db.insert(programMilestones).values({ programId: officialProg.id, title: "معلم رسمي", weight: 100 }).returning();
  const [synthDeliverable] = await db.insert(programDeliverables).values({ programId: synthProg.id, mainOutput: "مخرج تجريبي" }).returning();
  const [synthRoadmap] = await db.insert(programRoadmapCells).values({ programId: synthProg.id, periodKey: "w1", periodLabel: "الأسبوع 1" }).returning();
  const [synthFollowup] = await db.insert(programFollowups).values({ programId: synthProg.id, weekKey: "2026-W01", note: "متابعة", executionStatus: "في المسار" }).returning();
  const [synthCR] = await db.insert(programChangeRequests).values({ programId: synthProg.id, field: "name", fieldLabel: "الاسم", reason: "تجربة" }).returning();

  const [demoKpi] = await db.insert(programKpis).values({ planYearId: demoYear.id, code: "K1", nameAr: "مؤشر عرض" }).returning();
  const [realKpi] = await db.insert(programKpis).values({ planYearId: realYear.id, code: "K2", nameAr: "مؤشر رسمي" }).returning();
  const [demoRisk] = await db.insert(programRisks).values({ planYearId: demoYear.id, code: "R1", risk: "خطر عرض" }).returning();
  const [demoBudget] = await db.insert(planBudgetItems).values({ planYearId: demoYear.id, item: "بند عرض" }).returning();

  return {
    u, realYear, demoYear, synthBatch, officialPlanBatch, faresBatch, synthP1, synthP2, realP,
    officialProg, synthProg, demoProg, nameOnlyProg, synthCommittee, realCommittee, synthMeeting,
    synthMilestone, officialMilestone, synthDeliverable, synthRoadmap, synthFollowup, synthCR,
    demoKpi, realKpi, demoRisk, demoBudget,
  };
}

describe("classifySynthetic — أدلة بنيوية", () => {
  it("يصنّف الأشخاص/البرامج الاصطناعية ويستثني الرسمية ودفعة فارس", async () => {
    const f = await seedFixture();
    const { classifySynthetic } = await import("@/lib/synthetic");
    const c = await classifySynthetic();

    // دفعة فارس ليست ضمن الدفعات الاصطناعية
    expect(c.syntheticBatchIds).toContain(f.synthBatch.id);
    expect(c.syntheticBatchIds).not.toContain(f.faresBatch.id);
    expect(c.syntheticBatchIds).not.toContain(f.officialPlanBatch.id);

    // الأشخاص
    expect(c.ids.people.has(f.synthP1.id)).toBe(true);
    expect(c.ids.people.has(f.synthP2.id)).toBe(true);
    expect(c.ids.people.has(f.realP.id)).toBe(false);

    // البرامج: الاصطناعي وبرنامج العرض مصنّفان؛ الرسمي والمسمّى-فقط ليسا
    expect(c.ids.programs.has(f.synthProg.id)).toBe(true);
    expect(c.ids.programs.has(f.demoProg.id)).toBe(true);
    expect(c.ids.programs.has(f.officialProg.id)).toBe(false);
    expect(c.ids.programs.has(f.nameOnlyProg.id)).toBe(false);
  });

  it("ينتشر التصنيف بنيوياً إلى اللجنة كاملة الأعضاء الاصطناعيين واجتماعها", async () => {
    const f = await seedFixture();
    const { classifySynthetic } = await import("@/lib/synthetic");
    const c = await classifySynthetic();

    expect(c.ids.committees.has(f.synthCommittee.id)).toBe(true);
    expect(c.ids.committees.has(f.realCommittee.id)).toBe(false);
    expect(c.ids.meetings.has(f.synthMeeting.id)).toBe(true);
  });

  it("السجل المسمّى «تجريبي» بلا مرسى بنيوي يذهب للمشتبَه بهم فقط، لا للاستبعاد", async () => {
    const f = await seedFixture();
    const { classifySynthetic } = await import("@/lib/synthetic");
    const c = await classifySynthetic();

    const suspect = c.nameOnlySuspects.find((s) => s.id === f.nameOnlyProg.id);
    expect(suspect).toBeDefined();
    expect(suspect!.entityType).toBe("program");
    // ليس ضمن المرشحين المؤكدين ولا مجموعات الاستبعاد
    expect(c.candidates.find((x) => x.id === f.nameOnlyProg.id)).toBeUndefined();
    expect(c.ids.programs.has(f.nameOnlyProg.id)).toBe(false);
  });

  it("ينتشر التصنيف للسجلات التابعة: معالم/مخرجات/متابعات/طلبات تغيير (بالبرنامج) ومؤشرات/مخاطر/ميزانية (بالسنة العرضية)", async () => {
    const f = await seedFixture();
    const { classifySynthetic } = await import("@/lib/synthetic");
    const c = await classifySynthetic();

    // تابعة للبرنامج الاصطناعي
    expect(c.ids.milestones.has(f.synthMilestone.id)).toBe(true);
    expect(c.ids.milestones.has(f.officialMilestone.id)).toBe(false);
    expect(c.ids.deliverables.has(f.synthDeliverable.id)).toBe(true);
    expect(c.ids.roadmapCells.has(f.synthRoadmap.id)).toBe(true);
    expect(c.ids.followups.has(f.synthFollowup.id)).toBe(true);
    expect(c.ids.changeRequests.has(f.synthCR.id)).toBe(true);

    // تابعة للسنة العرضية (demo) — تُصنَّف؛ نظيراتها في السنة الحقيقية لا
    expect(c.ids.kpis.has(f.demoKpi.id)).toBe(true);
    expect(c.ids.kpis.has(f.realKpi.id)).toBe(false);
    expect(c.ids.risks.has(f.demoRisk.id)).toBe(true);
    expect(c.ids.budgets.has(f.demoBudget.id)).toBe(true);
    expect(c.ids.planYears.has(f.demoYear.id)).toBe(true);
    expect(c.ids.planYears.has(f.realYear.id)).toBe(false);

    // العدّادات تعكس المجموعات
    expect(c.counts.milestone).toBe(c.ids.milestones.size);
    expect(c.counts.kpi).toBe(c.ids.kpis.size);
  });

  it("استعلام /plan (نفس المرشّح المركزي) يُظهر البرامج الرسمية فقط ويُخفي الاصطناعية", async () => {
    const f = await seedFixture();
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const { getExcludedIdSets, notSynthetic } = await import("@/lib/synthetic");

    // نفس استعلام صفحة /plan: برامج السنة النشطة مع استبعاد الاصطناعي
    const excluded = await getExcludedIdSets();
    const shown = await db
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(eq(programs.planYearId, f.realYear.id), notSynthetic(programs.id, excluded.programs)));

    const shownIds = shown.map((p) => p.id);
    // الرسمي والمسمّى-بالاسم-فقط يظهران؛ الاصطناعي (نفس السنة) لا يظهر
    expect(shownIds).toContain(f.officialProg.id);
    expect(shownIds).toContain(f.nameOnlyProg.id);
    expect(shownIds).not.toContain(f.synthProg.id);
    // برنامج سنة العرض ليس ضمن السنة النشطة أصلاً
    expect(shownIds).not.toContain(f.demoProg.id);
  });

  it("getExcludedIdSets يحترم مفتاح MADRASA_INCLUDE_SYNTHETIC", async () => {
    const f = await seedFixture();
    const { getExcludedIdSets } = await import("@/lib/synthetic");

    const prev = process.env.MADRASA_INCLUDE_SYNTHETIC;
    // مفعّل افتراضياً: يعيد المجموعات
    delete process.env.MADRASA_INCLUDE_SYNTHETIC;
    const on = await getExcludedIdSets();
    expect(on.programs.has(f.synthProg.id)).toBe(true);

    // معطّل: مجموعات فارغة (بيانات السيناريو تظهر)
    process.env.MADRASA_INCLUDE_SYNTHETIC = "1";
    const off = await getExcludedIdSets();
    expect(off.programs.size).toBe(0);

    if (prev === undefined) delete process.env.MADRASA_INCLUDE_SYNTHETIC;
    else process.env.MADRASA_INCLUDE_SYNTHETIC = prev;
  });
});

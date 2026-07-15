import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";
import { syntheticPlanWorkbook } from "../helpers/fixtures";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("استيراد الخطة التشغيلية (A9, A10)", () => {
  it("يخزن القيم الرسمية حرفياً دون تعديل — بما فيها 1449/1/5", async () => {
    const { parsePlanWorkbook, commitPlanRows, rollbackPlanBatch, deriveMilestones } = await import("@/lib/imports/plan");
    const { createBatch, commitBatch, rollbackBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, programs, programMilestones, programKpis, planYears } = await import("@/db/schema");

    const [u] = await db.insert(users).values({ username: "t-plan", displayName: "اختبار", passwordHash: "x" }).returning();

    const buf = await syntheticPlanWorkbook();
    const { rows, summary } = await parsePlanWorkbook(buf);
    expect(summary["برامج"]).toBe(2);
    expect(summary["مؤشرات"]).toBe(1);

    const batch = await createBatch({ importType: "operational_plan", sourceFileName: "plan-fixture.xlsx", rows, createdBy: u.id });
    await commitBatch(batch.id, u.id, (tx, ready) =>
      commitPlanRows(tx, ready, batch.id, { planYearKey: "test-1448", planYearName: "سنة اختبار", createdBy: u.id }),
    );

    const progs = await db.select().from(programs);
    expect(progs.length).toBe(2);
    const p1 = progs.find((p) => p.seq === 1)!;
    // القيم الرسمية حرفياً
    expect(p1.hijriStart).toBe("1448/3/2");
    expect(p1.hijriEnd).toBe("1449/1/5");
    expect(p1.name).toBe("برنامج تجريبي أول");
    expect(p1.status).toBe("مسودة");

    // المعالم مشتقة بأوزان مجموعها 100
    const ms = await db.select().from(programMilestones).where(eq(programMilestones.programId, p1.id));
    expect(ms.length).toBe(3);
    expect(ms.reduce((s, m) => s + m.weight, 0)).toBe(100);

    const kpis = await db.select().from(programKpis);
    expect(kpis[0].code).toBe("مؤشر-01");

    // التراجع الكامل
    await rollbackBatch(batch.id, u.id, (tx) => rollbackPlanBatch(tx, batch.id));
    expect((await db.select().from(programs)).length).toBe(0);
    expect((await db.select().from(programKpis)).length).toBe(0);
  });

  it("اشتقاق المعالم يوزع الأوزان بالتساوي والباقي للأول", async () => {
    const { deriveMilestones } = await import("@/lib/imports/plan");
    const three = deriveMilestones("أ؛ ب؛ ج");
    expect(three.map((m) => m.weight)).toEqual([34, 33, 33]);
    expect(deriveMilestones("")).toEqual([]);
  });
});

describe("حساب التقدم من المعالم الموزونة", () => {
  it("يحسب التقدم الموزون لا عدد المرفقات", async () => {
    const { computeProgramProgress } = await import("@/lib/plan/progress");
    expect(computeProgramProgress([])).toBe(0);
    expect(
      computeProgramProgress([
        { weight: 50, progress: 100 },
        { weight: 50, progress: 0 },
      ]),
    ).toBe(50);
    expect(
      computeProgramProgress([
        { weight: 34, progress: 100 },
        { weight: 33, progress: 50 },
        { weight: 33, progress: 0 },
      ]),
    ).toBe(51);
  });

  it("جاهزية الحزمة: تنفيذ + مخرج + أثر (+ خارجي عند الانطباق)", async () => {
    const { computePackageReadiness } = await import("@/lib/plan/progress");
    const r1 = computePackageReadiness({ requiresExternal: false, evidenceRoles: ["تنفيذ", "مخرج"] });
    expect(r1.readiness).toBe(67);
    expect(r1.missing).toEqual(["أثر"]);
    const r2 = computePackageReadiness({ requiresExternal: true, evidenceRoles: ["تنفيذ", "مخرج", "أثر", "خارجي"] });
    expect(r2.readiness).toBe(100);
  });
});

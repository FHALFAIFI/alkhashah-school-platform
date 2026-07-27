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

async function seedYear() {
  const { db } = await import("@/db");
  const { planYears } = await import("@/db/schema");
  const [year] = await db.insert(planYears).values({ key: "bud-yr", nameAr: "سنة الميزانية" }).returning();
  return year;
}

describe("وحدة الميزانية — التكامل مع الشواهد الموحّدة", () => {
  it("إيصال واحد مرتبط بمصروف وبرنامج معاً دون رفع مكرر", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { programs, budgetExpenses, evidenceItems } = await import("@/db/schema");
    const { linkEvidence, evidenceUsage } = await import("@/lib/evidence");
    const { getBudgetOverview } = await import("@/lib/budget/service");

    const year = await seedYear();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 1, domain: "م", name: "برنامج" }).returning();
    const [expense] = await db
      .insert(budgetExpenses)
      .values({ planYearId: year.id, amount: "300", category: "قرطاسية", programId: prog.id })
      .returning();
    const [receipt] = await db.insert(evidenceItems).values({ title: "إيصال شراء", kind: "file" }).returning();

    // نفس الإيصال يخدم المصروف والبرنامج
    await linkEvidence({ evidenceId: receipt.id, entityType: "budget_expense", entityId: expense.id });
    await linkEvidence({ evidenceId: receipt.id, entityType: "program", entityId: prog.id });

    const usage = await evidenceUsage(receipt.id);
    expect(usage.map((u) => u.entityType).sort()).toEqual(["budget_expense", "program"]);

    // المصروف يُحتسب كمرفق الإيصال في الملخص
    const overview = await getBudgetOverview(year.id);
    expect(overview.summary.missingReceiptCount).toBe(0);
    expect(overview.expenses[0].hasReceipt).toBe(true);
  });

  it("الملخص يعكس المستلم والمصروف والمصروفات غير المرتبطة", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { budgetIncome, budgetExpenses } = await import("@/db/schema");
    const { getBudgetOverview } = await import("@/lib/budget/service");

    const year = await seedYear();
    await db.insert(budgetIncome).values({ planYearId: year.id, source: "دعم", amount: "5000", status: "مستلم" });
    await db.insert(budgetIncome).values({ planYearId: year.id, source: "متوقع", amount: "2000", status: "متوقع" });
    await db.insert(budgetExpenses).values({ planYearId: year.id, amount: "1200", category: "صيانة" }); // غير مرتبط، بلا إيصال

    const o = await getBudgetOverview(year.id);
    expect(o.summary.totalIncomeReceived).toBe(5000);
    expect(o.summary.totalIncomeExpected).toBe(2000);
    expect(o.summary.totalExpenses).toBe(1200);
    expect(o.summary.availableBalance).toBe(3800);
    expect(o.summary.unlinkedExpenseCount).toBe(1);
    expect(o.summary.missingReceiptCount).toBe(1);
  });

  it("المصروف المتجاوز يُسجَّل بقيمته كما هي مع علم الإقرار — لا تغيير صامت", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { programs, budgetExpenses, planBudgetItems } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { getBudgetOverview } = await import("@/lib/budget/service");

    const year = await seedYear();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 2, domain: "م", name: "برنامج ب" }).returning();
    // المصروف المتجاوز يُحفظ بقيمته الكاملة
    const [e] = await db
      .insert(budgetExpenses)
      .values({ planYearId: year.id, amount: "9999", category: "تجاوز", programId: prog.id, overspendAcknowledged: true, overspendAckReason: "ضرورة" })
      .returning();

    const [saved] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, e.id));
    expect(Number(saved.amount)).toBe(9999); // لم تُغيَّر القيمة
    expect(saved.overspendAcknowledged).toBe(true);

    const o = await getBudgetOverview(year.id);
    expect(o.summary.unacknowledgedOverspendCount).toBe(0);
  });

  it("B4: بنود المستلزمات/النشاط لكلٍّ مخصص ومصروف ومتبقٍ مستقل، والحذف يعيد حساب بنده فقط", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { planBudgetItems, budgetExpenses } = await import("@/db/schema");
    const { getBudgetOverview } = await import("@/lib/budget/service");
    const { eq } = await import("drizzle-orm");

    const year = await seedYear();
    await db.insert(planBudgetItems).values([
      { planYearId: year.id, item: "المستلزمات", amount: "5000" },
      { planYearId: year.id, item: "النشاط", amount: "3000" },
    ]);
    const [supExp] = await db
      .insert(budgetExpenses)
      .values({ planYearId: year.id, amount: "1200", items: "المستلزمات" })
      .returning();
    await db.insert(budgetExpenses).values({ planYearId: year.id, amount: "800", items: "النشاط" });

    const byItem = (o: Awaited<ReturnType<typeof getBudgetOverview>>) =>
      new Map(o.itemLines.map((l) => [l.item, l]));

    let m = byItem(await getBudgetOverview(year.id));
    expect(m.get("المستلزمات")).toMatchObject({ allocated: 5000, spent: 1200, remaining: 3800 });
    expect(m.get("النشاط")).toMatchObject({ allocated: 3000, spent: 800, remaining: 2200 });

    // حذف مصروف المستلزمات → المستلزمات 0/5000، والنشاط دون تغيير (بنده وحده أُعيد حسابه)
    await db.delete(budgetExpenses).where(eq(budgetExpenses.id, supExp.id));
    m = byItem(await getBudgetOverview(year.id));
    expect(m.get("المستلزمات")).toMatchObject({ spent: 0, remaining: 5000 });
    expect(m.get("النشاط")).toMatchObject({ spent: 800, remaining: 2200 });
  });
});

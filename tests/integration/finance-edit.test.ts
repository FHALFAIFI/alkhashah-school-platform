import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { and, desc, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.3 §6 — تعديل العمليات المالية:
 * نسخة كاملة في record_versions قبل كل تعديل، «قبل/بعد» في التدقيق، updatedBy مثبَّت،
 * وإعادة نقل العملية بين البنود تعيد حساب البندين تلقائياً (المجموع حيّ).
 */

let pool: Pool;
let testUserId = "";
let yearId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["budget.read", "budget.write", "evidence.write"]),
    roleKeys: new Set<string>(),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db
    .insert(users)
    .values({ username: "t-fin-edit", displayName: "اختبار التعديل", passwordHash: "x" })
    .returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { budgetExpenses, budgetIncome, financialItems, planYears, recordVersions, auditLog } =
    await import("@/db/schema");
  await db.delete(recordVersions);
  await db.delete(auditLog);
  await db.delete(budgetExpenses);
  await db.delete(budgetIncome);
  await db.delete(financialItems);
  await db.delete(planYears);
  const [year] = await db
    .insert(planYears)
    .values({ key: "fin-edit-1448", nameAr: "سنة الاختبار", status: "نشطة" })
    .returning();
  yearId = year.id;
});

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("تعديل المصروف", () => {
  it("يحفظ نسخة كاملة قبل التعديل ويسجّل قبل/بعد ويثبّت updatedBy", async () => {
    const { db } = await import("@/db");
    const { budgetExpenses, recordVersions, auditLog, financialItems } = await import("@/db/schema");
    const { addExpenseAction, updateExpenseAction } = await import("@/app/(app)/budget/actions");

    const [itemA] = await db
      .insert(financialItems)
      .values({ nameAr: "المستلزمات", allocatedAmount: "1000", createdBy: testUserId })
      .returning();

    const added = await addExpenseAction(
      null,
      fd({ planYearId: yearId, amount: "300", expenseDate: "2026-07-01", financialItemId: itemA.id, supplier: "مورد أ" }),
    );
    expect(added?.success).toBeTruthy();
    const [row] = await db.select().from(budgetExpenses);

    const updated = await updateExpenseAction(
      null,
      fd({
        expenseId: row.id,
        amount: "450",
        expenseDate: "2026-07-05",
        financialItemId: itemA.id,
        supplier: "مورد ب",
        paymentReference: "INV-77",
      }),
    );
    expect(updated?.success).toBeTruthy();

    const [after] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, row.id));
    expect(after.amount).toBe("450");
    expect(after.supplier).toBe("مورد ب");
    expect(after.paymentReference).toBe("INV-77");
    expect(after.updatedBy).toBe(testUserId);

    // نسخة كاملة من حالة ما قبل التعديل
    const versions = await db
      .select()
      .from(recordVersions)
      .where(and(eq(recordVersions.entityType, "budget_expense"), eq(recordVersions.entityId, row.id)));
    expect(versions).toHaveLength(1);
    const snap = versions[0].snapshot as { amount: string; supplier: string };
    expect(snap.amount).toBe("300");
    expect(snap.supplier).toBe("مورد أ");

    // «قبل/بعد» في سجل التدقيق بالقيم المتغيرة
    const [auditRow] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "budget.expense_updated"))
      .orderBy(desc(auditLog.createdAt));
    const detail = auditRow.detail as { before: { mapped: Record<string, string> }; after: { mapped: Record<string, string> } };
    expect(detail.before.mapped["المبلغ"]).toBe("300");
    expect(detail.after.mapped["المبلغ"]).toBe("450");
    expect(detail.before.mapped["المورّد"]).toBe("مورد أ");
    expect(detail.after.mapped["المورّد"]).toBe("مورد ب");
  });

  it("نقل مصروف إلى بند آخر يعيد حساب البندين تلقائياً", async () => {
    const { db } = await import("@/db");
    const { budgetExpenses, financialItems } = await import("@/db/schema");
    const { addExpenseAction, updateExpenseAction } = await import("@/app/(app)/budget/actions");
    const { getSchoolFinance } = await import("@/lib/finance/service");

    const [itemA] = await db
      .insert(financialItems)
      .values({ nameAr: "أ", allocatedAmount: "1000", createdBy: testUserId })
      .returning();
    const [itemB] = await db
      .insert(financialItems)
      .values({ nameAr: "ب", allocatedAmount: "500", createdBy: testUserId, sortOrder: 1 })
      .returning();

    await addExpenseAction(null, fd({ planYearId: yearId, amount: "200", financialItemId: itemA.id }));
    const [row] = await db.select().from(budgetExpenses);

    const before = await getSchoolFinance({ planYearId: yearId });
    expect(before.lines.find((l) => l.id === itemA.id)?.expenses).toBe(200);
    expect(before.lines.find((l) => l.id === itemB.id)?.expenses).toBe(0);

    await updateExpenseAction(null, fd({ expenseId: row.id, amount: "200", financialItemId: itemB.id }));

    const after = await getSchoolFinance({ planYearId: yearId });
    expect(after.lines.find((l) => l.id === itemA.id)?.expenses).toBe(0);
    expect(after.lines.find((l) => l.id === itemA.id)?.remaining).toBe(1000);
    expect(after.lines.find((l) => l.id === itemB.id)?.expenses).toBe(200);
    expect(after.lines.find((l) => l.id === itemB.id)?.remaining).toBe(300);
  });

  it("المصروف المؤرشف لا يُعدَّل", async () => {
    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");
    const { addExpenseAction, updateExpenseAction } = await import("@/app/(app)/budget/actions");

    await addExpenseAction(null, fd({ planYearId: yearId, amount: "100" }));
    const [row] = await db.select().from(budgetExpenses);
    await db.update(budgetExpenses).set({ archivedAt: new Date() }).where(eq(budgetExpenses.id, row.id));

    const result = await updateExpenseAction(null, fd({ expenseId: row.id, amount: "999" }));
    expect(result?.error).toContain("مؤرشف");
    const [unchanged] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, row.id));
    expect(unchanged.amount).toBe("100");
  });
});

describe("تعديل الإيراد", () => {
  it("يعدّل المبلغ والحالة ورقم الفاتورة مع نسخة وقبل/بعد", async () => {
    const { db } = await import("@/db");
    const { budgetIncome, recordVersions } = await import("@/db/schema");
    const { addIncomeAction, updateIncomeAction } = await import("@/app/(app)/budget/actions");

    await addIncomeAction(
      null,
      fd({ planYearId: yearId, source: "الوزارة", amount: "5000", incomeDate: "2026-07-01", status: "متوقع" }),
    );
    const [row] = await db.select().from(budgetIncome);

    const result = await updateIncomeAction(
      null,
      fd({
        incomeId: row.id,
        source: "الوزارة",
        amount: "5200",
        incomeDate: "2026-07-03",
        status: "مستلم",
        paymentReference: "سند-12",
      }),
    );
    expect(result?.success).toBeTruthy();

    const [after] = await db.select().from(budgetIncome).where(eq(budgetIncome.id, row.id));
    expect(after.amount).toBe("5200");
    expect(after.status).toBe("مستلم");
    expect(after.paymentReference).toBe("سند-12");
    expect(after.updatedBy).toBe(testUserId);

    const versions = await db
      .select()
      .from(recordVersions)
      .where(and(eq(recordVersions.entityType, "budget_income"), eq(recordVersions.entityId, row.id)));
    expect(versions).toHaveLength(1);
    expect((versions[0].snapshot as { status: string }).status).toBe("متوقع");
  });

  it("التاريخ المستحيل يُرفض برسالة عربية", async () => {
    const { db } = await import("@/db");
    const { budgetIncome } = await import("@/db/schema");
    const { addIncomeAction, updateIncomeAction } = await import("@/app/(app)/budget/actions");

    await addIncomeAction(null, fd({ planYearId: yearId, source: "س", amount: "10" }));
    const [row] = await db.select().from(budgetIncome);

    // المبلغ صار إلزامياً (تصحيح ما بعد v2.5.0) فيُرسَل صالحاً هنا، وإلا حجب خطؤه خطأ التاريخ
    const result = await updateIncomeAction(null, fd({ incomeId: row.id, source: "س", amount: "10", incomeDate: "2026-02-30" }));
    expect(result?.error).toContain("التاريخ غير صحيح");
  });

  it("التعديل بمبلغ فارغ يُرفض ولا يمسّ الصف المحفوظ", async () => {
    const { db } = await import("@/db");
    const { budgetIncome } = await import("@/db/schema");
    const { addIncomeAction, updateIncomeAction } = await import("@/app/(app)/budget/actions");
    const { REQUIRED_AMOUNT_MESSAGE } = await import("@/lib/finance/amount");

    await addIncomeAction(null, fd({ planYearId: yearId, source: "س", amount: "10" }));
    const [row] = await db.select().from(budgetIncome);

    const result = await updateIncomeAction(null, fd({ incomeId: row.id, source: "س معدّل" }));
    expect(result?.error).toBe(REQUIRED_AMOUNT_MESSAGE);

    const [after] = await db.select().from(budgetIncome);
    expect(after.amount).toBe("10");
    expect(after.source).toBe("س");
  });
});

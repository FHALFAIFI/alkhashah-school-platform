import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Scope v2.2 §B — school-level finance.
 *
 * The behaviours pinned here are the ones the principal asked for by name: income and
 * expenses save with no program or classification, per-item allocation is independent,
 * the overrun warning never blocks a save, and no acknowledgment is required or written.
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
  const [u] = await db.insert(users).values({ username: "t-finance", displayName: "اختبار المالية", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { budgetExpenses, budgetIncome, financialItems, planYears, programs, evidenceLinks, evidenceItems } =
    await import("@/db/schema");
  // تنظيف بترتيب التبعية (المفاتيح الأجنبية)
  await db.delete(evidenceLinks);
  await db.delete(evidenceItems);
  await db.delete(budgetExpenses);
  await db.delete(budgetIncome);
  await db.delete(financialItems);
  await db.delete(programs);
  await db.delete(planYears);
  const suffix = Math.floor(Math.random() * 1e9);
  const [y] = await db.insert(planYears).values({ key: `fin-${suffix}`, nameAr: `سنة ${suffix}`, status: "نشطة" }).returning();
  yearId = y.id;
});

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function makeItem(name: string, allocated?: string) {
  const { createFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
  const res = await createFinancialItemAction(null, fd(allocated ? { nameAr: name, allocatedAmount: allocated } : { nameAr: name }));
  expect(res?.error).toBeUndefined();
  const { db } = await import("@/db");
  const { financialItems } = await import("@/db/schema");
  const rows = await db.select().from(financialItems);
  return rows.find((r) => r.nameAr === name)!;
}

describe("B3/B4 — الإيراد والمصروف على مستوى المدرسة", () => {
  it("يحفظ إيراداً بلا برنامج ولا تصنيف", async () => {
    const { addIncomeAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetIncome } = await import("@/db/schema");

    const res = await addIncomeAction(null, fd({ planYearId: yearId, source: "دعم", amount: "5000" }));
    expect(res?.error).toBeUndefined();

    const [row] = await db.select().from(budgetIncome);
    expect(row.programId).toBeNull();
    expect(row.financialItemId).toBeNull();
    expect(row.amount).toBe("5000");
  });

  it("يحفظ مصروفاً بلا برنامج ولا تصنيف", async () => {
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");

    const res = await addExpenseAction(null, fd({ planYearId: yearId, amount: "300" }));
    expect(res?.error).toBeUndefined();

    const [row] = await db.select().from(budgetExpenses);
    expect(row.programId).toBeNull();
    expect(row.amount).toBe("300");
  });

  /*
   * صُحِّح بعد نشر v2.5.0: كان هذا الاختبار يثبّت حفظ الحركة بمبلغ `NULL` بوصفه أثراً
   * لقاعدة «كل الحقول اختيارية» (v2.1 §H). القاعدة تبقى على الحقول الوصفية، أما المبلغ
   * فهو الحركة نفسها — وحركة مالية بلا مبلغ لا تدخل مجموعاً ولا رصيداً ولا نسبة إنفاق،
   * فتختفي من كل رقم مع بقائها في السجل. العقد الآن: تُرفض، ولا يُكتب صف.
   */
  it("يرفض حفظ عملية بلا مبلغ — ولا يكتب صفاً", async () => {
    const { addExpenseAction, addIncomeAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetExpenses, budgetIncome } = await import("@/db/schema");
    const { REQUIRED_AMOUNT_MESSAGE } = await import("@/lib/finance/amount");

    expect((await addExpenseAction(null, fd({ planYearId: yearId })))?.error).toBe(REQUIRED_AMOUNT_MESSAGE);
    expect((await addIncomeAction(null, fd({ planYearId: yearId })))?.error).toBe(REQUIRED_AMOUNT_MESSAGE);

    expect(await db.select().from(budgetExpenses)).toHaveLength(0);
    expect(await db.select().from(budgetIncome)).toHaveLength(0);
  });

  it("يرفض المبلغ غير صحيح الصيغة حين يُدخَل", async () => {
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const res = await addExpenseAction(null, fd({ planYearId: yearId, amount: "غير رقم" }));
    expect(res?.error).toBeTruthy();
  });

  it("يربط العملية ببند مالي مختار", async () => {
    const item = await makeItem("المستلزمات", "1000");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");

    await addExpenseAction(null, fd({ planYearId: yearId, amount: "250", financialItemId: item.id }));
    const [row] = await db.select().from(budgetExpenses);
    expect(row.financialItemId).toBe(item.id);
  });

  it("يرفض بنداً مالياً غير موجود (حارس تكامل)", async () => {
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    // معرّف صحيح الصيغة لكنه غير موجود — يجب أن يُرفض بحارس الوجود لا بخطأ صيغة
    const res = await addExpenseAction(
      null,
      fd({ planYearId: yearId, amount: "10", financialItemId: crypto.randomUUID() }),
    );
    expect(res?.error).toBe("البند المالي المختار غير موجود");
  });

  it("لا يسرّب رسالة خطأ إنجليزية عند معرّف مشوّه", async () => {
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const res = await addExpenseAction(null, fd({ planYearId: yearId, amount: "10", financialItemId: "not-a-uuid" }));
    expect(res?.error).toBeTruthy();
    // كل رسالة تصل المستخدم بالعربية — لا "Invalid UUID" ولا نص إنجليزي خام
    expect(res?.error).not.toMatch(/[A-Za-z]{4,}/);
  });
});

describe("B7 — تجاوز المخصص لا يمنع الحفظ ولا يتطلب إقراراً", () => {
  it("يحفظ مصروفاً يتجاوز المخصص بلا أي إقرار", async () => {
    const item = await makeItem("النشاط", "100");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");

    const res = await addExpenseAction(null, fd({ planYearId: yearId, amount: "500", financialItemId: item.id }));
    expect(res?.error).toBeUndefined();
    expect(res?.success).toBeTruthy();

    const [row] = await db.select().from(budgetExpenses);
    expect(row.amount).toBe("500");
    // عمود الإقرار لم يُكتب — المفهوم مُلغى
    expect(row.overspendAcknowledged).toBe(false);
    expect(row.overspendAckReason).toBeNull();
    expect(row.overspendAckAt).toBeNull();
  });

  it("رسالة النجاح لا تذكر إقرار تجاوز", async () => {
    const item = await makeItem("النشاط", "50");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const res = await addExpenseAction(null, fd({ planYearId: yearId, amount: "900", financialItemId: item.id }));
    expect(res?.success).not.toContain("إقرار");
  });
});

describe("B5 — الحسابات المدرسية من الخدمة الموحّدة", () => {
  it("يحسب المخصص والمنفَق والمتبقي لكل بند مستقلاً", async () => {
    const supplies = await makeItem("المستلزمات", "1000");
    const activity = await makeItem("النشاط", "500");
    const { addExpenseAction, addIncomeAction } = await import("@/app/(app)/budget/actions");

    await addExpenseAction(null, fd({ planYearId: yearId, amount: "300", financialItemId: supplies.id }));
    await addExpenseAction(null, fd({ planYearId: yearId, amount: "120", financialItemId: activity.id }));
    await addIncomeAction(null, fd({ planYearId: yearId, amount: "2000" }));

    const { getSchoolFinance } = await import("@/lib/finance/service");
    const f = await getSchoolFinance({ planYearId: yearId });

    const s = f.lines.find((l) => l.id === supplies.id)!;
    const a = f.lines.find((l) => l.id === activity.id)!;
    expect(s.allocated).toBe(1000);
    expect(s.expenses).toBe(300);
    expect(s.remaining).toBe(700);
    // استقلال تام بين البندين
    expect(a.expenses).toBe(120);
    expect(a.remaining).toBe(380);

    expect(f.summary.totalIncome).toBe(2000);
    expect(f.summary.totalExpenses).toBe(420);
    expect(f.summary.cashBalance).toBe(1580);
  });

  it("المجاميع تطابق الجمع المباشر من قاعدة البيانات", async () => {
    const item = await makeItem("المستلزمات", "10000");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    for (const amount of ["100", "250.5", "33"]) {
      await addExpenseAction(null, fd({ planYearId: yearId, amount, financialItemId: item.id }));
    }

    const direct = await pool.query<{ sum: string | null }>(
      "select sum(amount::numeric) as sum from budget_expenses where archived_at is null",
    );
    const { getSchoolFinance } = await import("@/lib/finance/service");
    const f = await getSchoolFinance({ planYearId: yearId });
    expect(f.summary.totalExpenses).toBe(Number(direct.rows[0].sum));
  });

  it("أرشفة مصروف تعيد حساب بنده وحده", async () => {
    const supplies = await makeItem("المستلزمات", "1000");
    const activity = await makeItem("النشاط", "1000");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    await addExpenseAction(null, fd({ planYearId: yearId, amount: "400", financialItemId: supplies.id }));
    await addExpenseAction(null, fd({ planYearId: yearId, amount: "200", financialItemId: activity.id }));

    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");
    const rows = await db.select().from(budgetExpenses);
    const suppliesExpense = rows.find((r) => r.financialItemId === supplies.id)!;

    const { archiveExpenseAction } = await import("@/app/(app)/budget/finance-actions");
    await archiveExpenseAction(suppliesExpense.id);

    const { getSchoolFinance } = await import("@/lib/finance/service");
    const f = await getSchoolFinance({ planYearId: yearId });
    expect(f.lines.find((l) => l.id === supplies.id)!.expenses).toBe(0);
    // البند الآخر لم يتأثر
    expect(f.lines.find((l) => l.id === activity.id)!.expenses).toBe(200);
  });

  it("نقل مصروف إلى بند آخر يعيد حساب البندين فقط", async () => {
    const a = await makeItem("المستلزمات", "1000");
    const b = await makeItem("النشاط", "1000");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    await addExpenseAction(null, fd({ planYearId: yearId, amount: "300", financialItemId: a.id }));

    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");
    const [row] = await db.select().from(budgetExpenses);
    await db.update(budgetExpenses).set({ financialItemId: b.id }).where(eq(budgetExpenses.id, row.id));

    const { getSchoolFinance } = await import("@/lib/finance/service");
    const f = await getSchoolFinance({ planYearId: yearId });
    expect(f.lines.find((l) => l.id === a.id)!.expenses).toBe(0);
    expect(f.lines.find((l) => l.id === b.id)!.expenses).toBe(300);
  });

  it("السجلات التاريخية المرتبطة ببرنامج ما زالت تُعرض", async () => {
    // صف تاريخي بأسلوب ما قبل v2.2: مرتبط ببرنامج وببند نصي، بلا financialItemId
    const { db } = await import("@/db");
    const { budgetExpenses, programs, planYears } = await import("@/db/schema");
    const [year] = await db.select().from(planYears).where(eq(planYears.id, yearId));
    const [prog] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: 1, domain: "مجال", name: "برنامج تاريخي" })
      .returning();
    await db.insert(budgetExpenses).values({ planYearId: year.id, amount: "75", programId: prog.id, items: "المستلزمات" });

    const { getSchoolFinance } = await import("@/lib/finance/service");
    const f = await getSchoolFinance({ planYearId: yearId });
    const row = f.expenses[0];
    // الربط التاريخي محفوظ ومعروض، والقيمة تدخل مجاميع المدرسة
    expect(row.legacyProgramName).toBe("برنامج تاريخي");
    expect(row.items).toBe("المستلزمات");
    expect(f.summary.totalExpenses).toBe(75);
    // لكنها لا تُنسب لأي بند مالي جديد — لا احتساب مزدوج
    expect(f.lines.every((l) => l.expenses === 0)).toBe(true);
  });
});

describe("B2 — إدارة بنود الصرف", () => {
  it("ينشئ بنداً ويعدّله ويؤرشفه ويستعيده", async () => {
    const item = await makeItem("بند تجريبي", "500");
    const { updateFinancialItemAction, archiveFinancialItemAction, restoreFinancialItemAction } = await import(
      "@/app/(app)/budget/finance-actions"
    );
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");

    await updateFinancialItemAction(item.id, null, fd({ nameAr: "بند معدَّل", allocatedAmount: "800", color: "أخضر" }));
    let [row] = await db.select().from(financialItems).where(eq(financialItems.id, item.id));
    expect(row.nameAr).toBe("بند معدَّل");
    expect(row.allocatedAmount).toBe("800");
    expect(row.color).toBe("أخضر");

    await archiveFinancialItemAction(item.id);
    [row] = await db.select().from(financialItems).where(eq(financialItems.id, item.id));
    expect(row.archivedAt).toBeTruthy();

    await restoreFinancialItemAction(item.id);
    [row] = await db.select().from(financialItems).where(eq(financialItems.id, item.id));
    expect(row.archivedAt).toBeNull();
  });

  it("يرفض لوناً خارج القائمة المسموحة (منع حقن CSS)", async () => {
    const { createFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const res = await createFinancialItemAction(null, fd({ nameAr: "بند", color: "red; background:url(evil)" }));
    expect(res?.error).toBeTruthy();
  });

  it("يقبل بنداً بلا اسم وبلا مخصص (القاعدة العامة)", async () => {
    const { createFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const res = await createFinancialItemAction(null, fd({}));
    expect(res?.error).toBeUndefined();
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    const [row] = await db.select().from(financialItems);
    expect(row.nameAr).toBeNull();
    expect(row.allocatedAmount).toBeNull();
  });

  it("أرشفة البند لا تحذف عملياته", async () => {
    const item = await makeItem("المستلزمات", "1000");
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    await addExpenseAction(null, fd({ planYearId: yearId, amount: "100", financialItemId: item.id }));

    const { archiveFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    await archiveFinancialItemAction(item.id);

    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");
    const rows = await db.select().from(budgetExpenses);
    expect(rows).toHaveLength(1);
    expect(rows[0].financialItemId).toBe(item.id);
  });

  it("إنشاء البندين الأساسيين idempotent ولا يكرّرهما", async () => {
    const { createDefaultFinancialItemsAction } = await import("@/app/(app)/budget/finance-actions");
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");

    await createDefaultFinancialItemsAction();
    await createDefaultFinancialItemsAction();
    const second = await createDefaultFinancialItemsAction();

    const rows = await db.select().from(financialItems);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.nameAr).sort()).toEqual(["المستلزمات", "النشاط"]);
    expect(second?.success).toContain("موجودة مسبقاً");
    // لا يخترع مخصصاً
    expect(rows.every((r) => r.allocatedAmount === null)).toBe(true);
  });

  it("الأرشفة والاستعادة idempotent", async () => {
    const item = await makeItem("بند");
    const { archiveFinancialItemAction, restoreFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    await archiveFinancialItemAction(item.id);
    const again = await archiveFinancialItemAction(item.id);
    expect(again?.success).toContain("مؤرشف مسبقاً");
    await restoreFinancialItemAction(item.id);
    const restoredAgain = await restoreFinancialItemAction(item.id);
    expect(restoredAgain?.success).toContain("غير مؤرشف");
  });
});

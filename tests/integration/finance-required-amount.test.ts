import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Corrective fix (post-v2.5.0 deployment), issue 2 — the financial amount is mandatory
 * at the SERVER boundary.
 *
 * The unit suite pins the schema. What can only be proven here is the part that actually
 * matters operationally: a request that omits the amount is refused, and when it is refused
 * **nothing is written** — no business row, and no audit row either. A validation failure that
 * still leaves an audit entry would make the log lie about what happened.
 *
 * Every call below goes through the real Server Action with a hand-built `FormData`. That is
 * exactly the shape a forged request takes: no browser, no HTML `required`, no client
 * validation — which is the whole reason the rule cannot live in the form.
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
  const [u] = await db.insert(users).values({ username: "t-req-amount", displayName: "اختبار المبلغ", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { budgetExpenses, budgetIncome, financialItems, planYears, auditLog, evidenceLinks, evidenceItems } =
    await import("@/db/schema");
  await db.delete(evidenceLinks);
  await db.delete(evidenceItems);
  await db.delete(budgetExpenses);
  await db.delete(budgetIncome);
  await db.delete(financialItems);
  await db.delete(planYears);
  await db.delete(auditLog);
  const suffix = Math.floor(Math.random() * 1e9);
  const [y] = await db.insert(planYears).values({ key: `req-${suffix}`, nameAr: `سنة ${suffix}`, status: "نشطة" }).returning();
  yearId = y.id;
});

/** FormData built by hand — the shape a forged request has, with no browser in the path */
function forged(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function counts() {
  const { db } = await import("@/db");
  const { budgetExpenses, budgetIncome, auditLog, financialItems } = await import("@/db/schema");
  return {
    income: (await db.select().from(budgetIncome)).length,
    expenses: (await db.select().from(budgetExpenses)).length,
    items: (await db.select().from(financialItems)).length,
    audit: (await db.select().from(auditLog)).length,
  };
}

/** The invalid inputs a real forged request could carry */
const INVALID = [
  ["omitted entirely", undefined],
  ["empty string", ""],
  ["whitespace", "   "],
  ["zero", "0"],
  ["negative", "-100"],
  ["malformed", "غير رقم"],
  ["finer than a halalah", "3.456"],
] as const;

describe("income — amount is mandatory at the server boundary", () => {
  for (const [label, value] of INVALID) {
    it(`refuses ${label}, and writes neither an income row nor an audit row`, async () => {
      const { addIncomeAction } = await import("@/app/(app)/budget/actions");
      const before = await counts();

      const payload: Record<string, string> = { planYearId: yearId, source: "دعم" };
      if (value !== undefined) payload.amount = value;
      const res = await addIncomeAction(null, forged(payload));

      expect(res?.error).toBeTruthy();
      const after = await counts();
      expect(after.income).toBe(before.income);
      expect(after.audit).toBe(before.audit);
    });
  }

  it("accepts a valid whole-riyal amount", async () => {
    const { addIncomeAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetIncome } = await import("@/db/schema");

    expect((await addIncomeAction(null, forged({ planYearId: yearId, source: "دعم", amount: "5000" })))?.error).toBeUndefined();
    const [row] = await db.select().from(budgetIncome);
    expect(row.amount).toBe("5000");
  });

  it("accepts a valid halalah amount and stores it exactly", async () => {
    const { addIncomeAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetIncome } = await import("@/db/schema");

    expect((await addIncomeAction(null, forged({ planYearId: yearId, amount: "12.50" })))?.error).toBeUndefined();
    const [row] = await db.select().from(budgetIncome);
    expect(Number(row.amount)).toBe(12.5);
  });

  it("keeps the descriptive fields optional — only the amount became mandatory", async () => {
    const { addIncomeAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetIncome } = await import("@/db/schema");

    // no source, no date, no purpose, no invoice number, no notes — just the amount
    expect((await addIncomeAction(null, forged({ planYearId: yearId, amount: "300" })))?.error).toBeUndefined();
    const [row] = await db.select().from(budgetIncome);
    expect(row.amount).toBe("300");
    expect(row.purpose).toBeNull();
    expect(row.paymentReference).toBeNull();
    expect(row.notes).toBeNull();
  });
});

describe("expense — amount is mandatory at the server boundary", () => {
  for (const [label, value] of INVALID) {
    it(`refuses ${label}, and writes neither an expense row nor an audit row`, async () => {
      const { addExpenseAction } = await import("@/app/(app)/budget/actions");
      const before = await counts();

      const payload: Record<string, string> = { planYearId: yearId };
      if (value !== undefined) payload.amount = value;
      const res = await addExpenseAction(null, forged(payload));

      expect(res?.error).toBeTruthy();
      const after = await counts();
      expect(after.expenses).toBe(before.expenses);
      expect(after.audit).toBe(before.audit);
    });
  }

  it("accepts a valid expense", async () => {
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const { db } = await import("@/db");
    const { budgetExpenses } = await import("@/db/schema");

    expect((await addExpenseAction(null, forged({ planYearId: yearId, amount: "250.75" })))?.error).toBeUndefined();
    const [row] = await db.select().from(budgetExpenses);
    expect(Number(row.amount)).toBe(250.75);
  });
});

describe("allocation update — amount is mandatory, removal is an explicit intent", () => {
  async function makeItem(allocated?: string) {
    const { createFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    const payload: Record<string, string> = { nameAr: "بند اختبار" };
    if (allocated !== undefined) payload.allocatedAmount = allocated;
    expect((await createFinancialItemAction(null, forged(payload)))?.error).toBeUndefined();
    const [row] = await db.select().from(financialItems);
    return row;
  }

  for (const [label, value] of INVALID) {
    it(`refuses ${label} — the existing allocation is left untouched`, async () => {
      const item = await makeItem("1000");
      const { setItemAllocationAction } = await import("@/app/(app)/budget/finance-actions");
      const { db } = await import("@/db");
      const { financialItems } = await import("@/db/schema");
      const before = await counts();

      const payload: Record<string, string> = {};
      if (value !== undefined) payload.allocatedAmount = value;
      const res = await setItemAllocationAction(item.id, null, forged(payload));

      expect(res?.error).toBeTruthy();
      const [after] = await db.select().from(financialItems);
      // the blank submit used to wipe the allocation to NULL — it must now change nothing
      expect(after.allocatedAmount).toBe("1000");
      expect((await counts()).audit).toBe(before.audit);
    });
  }

  it("accepts a valid allocation", async () => {
    const item = await makeItem();
    const { setItemAllocationAction } = await import("@/app/(app)/budget/finance-actions");
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");

    expect((await setItemAllocationAction(item.id, null, forged({ allocatedAmount: "2500" })))?.error).toBeUndefined();
    const [after] = await db.select().from(financialItems);
    expect(Number(after.allocatedAmount)).toBe(2500);
  });

  it("removes the allocation only when removal is asked for explicitly", async () => {
    const item = await makeItem("1000");
    const { setItemAllocationAction } = await import("@/app/(app)/budget/finance-actions");
    const { db } = await import("@/db");
    const { financialItems, auditLog } = await import("@/db/schema");

    const res = await setItemAllocationAction(item.id, null, forged({ removeAllocation: "1", note: "أُلغي المخصص" }));
    expect(res?.error).toBeUndefined();

    const [after] = await db.select().from(financialItems);
    expect(after.allocatedAmount).toBeNull();
    // the removal is a real, audited financial decision — not a silent side effect
    const audits = await db.select().from(auditLog);
    expect(audits.some((a) => a.action === "finance.item_allocation_set")).toBe(true);
  });

  it("rejects zero on item creation — an item allocated nothing is not allocated", async () => {
    const { createFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const before = await counts();
    expect((await createFinancialItemAction(null, forged({ nameAr: "بند", allocatedAmount: "0" })))?.error).toBeTruthy();
    expect((await counts()).items).toBe(before.items);
  });

  it("still allows an item to be created with no allocation yet", async () => {
    const { createFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    expect((await createFinancialItemAction(null, forged({ nameAr: "بند بلا مخصص" })))?.error).toBeUndefined();
    const [row] = await db.select().from(financialItems);
    expect(row.allocatedAmount).toBeNull();
  });
});

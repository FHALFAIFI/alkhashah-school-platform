import { describe, it, expect } from "vitest";
import {
  allocationState,
  allocationBelowSpentWarning,
  expenseSavedMessage,
  ALLOCATION_NONE_VALUE,
  REMAINING_UNAVAILABLE,
} from "@/lib/finance/allocation";
import { financialItemLines, type FinanceRecord, type FinancialItemInput } from "@/lib/finance/calc";

/**
 * v2.4.1 §4 — حالات المخصص. الجذر المُصحَّح: بنود الإنتاج بلا مخصص فيُعرض «—» بلا تفسير.
 * الاختبارات تثبت أن `null` و`0` حالتان مختلفتان وأن المتبقي لا يُختلق صفراً.
 */

const item = (over: Partial<FinancialItemInput> = {}): FinancialItemInput => ({
  id: "item-1",
  name: "المستلزمات",
  allocated: null,
  archivedAt: null,
  sortOrder: 0,
  color: null,
  ...over,
});

const expense = (amount: number | null, over: Partial<FinanceRecord> = {}): FinanceRecord => ({
  id: `e-${Math.abs(amount ?? 0)}-${over.financialItemId ?? "item-1"}`,
  amount,
  financialItemId: "item-1",
  archivedAt: null,
  hasInvoice: false,
  date: "2026-08-01",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

describe("allocationState", () => {
  it("يفرّق بين «لا مخصص» و«مخصص صفر» ولا يخلط بينهما", () => {
    expect(allocationState(null)).toBe("none");
    expect(allocationState(0)).toBe("zero");
    expect(allocationState(2500)).toBe("positive");
  });
});

describe("financialItemLines — حالات المخصص الأربع", () => {
  it("لا مخصص: المتبقي والنسبة null ولا تجاوز — الصرف محسوب كما هو", () => {
    const [line] = financialItemLines([item({ allocated: null })], [], [expense(1400)]);
    expect(line.allocationState).toBe("none");
    expect(line.hasAllocation).toBe(false);
    expect(line.expenses).toBe(1400);
    expect(line.remaining).toBeNull();
    expect(line.spentPercent).toBeNull();
    expect(line.overspent).toBe(false);
    expect(line.zeroAllocationSpending).toBe(false);
  });

  it("مخصص صفر مع صرف: المتبقي سالب ويُعلَّم تجاوزاً وصرفاً على مخصص صفر", () => {
    const [line] = financialItemLines([item({ allocated: 0 })], [], [expense(400)]);
    expect(line.allocationState).toBe("zero");
    expect(line.remaining).toBe(-400);
    expect(line.overspent).toBe(true);
    expect(line.zeroAllocationSpending).toBe(true);
  });

  it("مخصص صفر بلا صرف: لا تحذير", () => {
    const [line] = financialItemLines([item({ allocated: 0 })], [], []);
    expect(line.allocationState).toBe("zero");
    expect(line.remaining).toBe(0);
    expect(line.zeroAllocationSpending).toBe(false);
  });

  it("مخصص موجب: المتبقي والنسبة محسوبان", () => {
    const [line] = financialItemLines([item({ allocated: 2500 })], [], [expense(1400)]);
    expect(line.allocationState).toBe("positive");
    expect(line.remaining).toBe(1100);
    expect(line.spentPercent).toBe(56);
    expect(line.overspent).toBe(false);
  });

  it("تجاوز المخصص: المتبقي سالب ولا يُطبَّع إلى صفر", () => {
    const [line] = financialItemLines([item({ allocated: 1000 })], [], [expense(1400)]);
    expect(line.remaining).toBe(-400);
    expect(line.overspent).toBe(true);
    expect(line.zeroAllocationSpending).toBe(false);
  });

  it("المبلغ الفارغ لا يُحتسب صفراً في المصروف", () => {
    const [line] = financialItemLines(
      [item({ allocated: 1000 })],
      [],
      [expense(null), expense(200, { id: "e-200" })],
    );
    expect(line.expenses).toBe(200);
    expect(line.remaining).toBe(800);
  });
});

describe("نصوص الإرشاد", () => {
  it("رسالة حفظ المصروف تذكر المتبقي حين يمكن احتسابه", () => {
    expect(expenseSavedMessage(1100, "1,100.00")).toContain("1,100.00");
    expect(expenseSavedMessage(1100)).toContain("المتبقي بعد العملية");
  });

  it("رسالة حفظ المصروف تشرح سبب تعذّر الاحتساب بدل الصمت", () => {
    const msg = expenseSavedMessage(null);
    expect(msg).toContain("تم حفظ المصروف");
    expect(msg).toContain("المخصص غير محدد");
  });

  it("تحذير خفض المخصص تحت المصروف يذكر الرقمين", () => {
    const warn = allocationBelowSpentWarning(300, 1400);
    expect(warn).toContain("300");
    expect(warn).toContain("1400");
  });

  it("النصوص البديلة عن «—» غير فارغة", () => {
    expect(ALLOCATION_NONE_VALUE).not.toBe("—");
    expect(REMAINING_UNAVAILABLE.length).toBeGreaterThan(0);
  });
});

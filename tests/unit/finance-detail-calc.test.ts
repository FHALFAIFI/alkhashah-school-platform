import { describe, it, expect } from "vitest";
import {
  financialItemLines,
  ledgerWithRunningBalance,
  topSpendingItems,
  nearExhaustionItems,
  overspentItems,
  recentOperations,
  type FinanceRecord,
  type FinancialItemInput,
} from "@/lib/finance/calc";

/**
 * v2.3 §6 — بطاقات البنود وتفصيلها: «آخر عملية»، الدفتر بالرصيد الجاري،
 * البنود الأعلى صرفاً/القريبة من النفاد/المتجاوزة، والنشاط الأخير.
 */

const item = (over: Partial<FinancialItemInput> = {}): FinancialItemInput => ({
  id: "i1",
  name: "المستلزمات",
  allocated: 1000,
  archivedAt: null,
  sortOrder: 0,
  color: null,
  ...over,
});

const rec = (over: Partial<FinanceRecord> = {}): FinanceRecord => ({
  id: Math.random().toString(36).slice(2),
  amount: 100,
  financialItemId: "i1",
  archivedAt: null,
  date: "2026-07-01",
  hasInvoice: false,
  ...over,
});

describe("آخر عملية مالية على البند", () => {
  it("يختار الأحدث بتاريخ العملية ويعيد نوعها وقيمتها", () => {
    const income = [rec({ status: "مستلم", date: "2026-07-05", amount: 50 })];
    const expenses = [
      rec({ date: "2026-07-10", amount: 200 }),
      rec({ date: "2026-07-02", amount: 30 }),
    ];
    const [line] = financialItemLines([item()], income, expenses);
    expect(line.lastOperation).toEqual({ kind: "مصروف", date: "2026-07-10", amount: 200 });
  });

  it("العملية بلا تاريخ تُرتَّب بوقت إدخالها احتياطاً", () => {
    const expenses = [
      rec({ date: "2026-07-01", amount: 10 }),
      rec({ date: null, createdAt: new Date(Date.UTC(2026, 6, 20, 12)), amount: 99 }),
    ];
    const [line] = financialItemLines([item()], [], expenses);
    expect(line.lastOperation?.amount).toBe(99);
    expect(line.lastOperation?.date).toBe("2026-07-20");
  });

  it("بند بلا عمليات: lastOperation = null", () => {
    const [line] = financialItemLines([item()], [], []);
    expect(line.lastOperation).toBeNull();
  });

  it("العملية المؤرشفة والإيراد الملغى لا يظهران في «آخر عملية»", () => {
    const income = [rec({ status: "ملغى", date: "2026-07-30", amount: 500 })];
    const expenses = [
      rec({ date: "2026-07-25", amount: 70, archivedAt: new Date() }),
      rec({ date: "2026-07-03", amount: 40 }),
    ];
    const [line] = financialItemLines([item()], income, expenses);
    expect(line.lastOperation).toEqual({ kind: "مصروف", date: "2026-07-03", amount: 40 });
  });
});

describe("دفتر العمليات بالرصيد الجاري", () => {
  it("الإيراد المستلم يضيف والمصروف يخصم والترتيب زمني تصاعدي", () => {
    const income = [
      rec({ id: "in1", status: "مستلم", date: "2026-07-01", amount: 1000 }),
      rec({ id: "in2", status: "مستلم", date: "2026-07-15", amount: 500 }),
    ];
    const expenses = [rec({ id: "ex1", date: "2026-07-10", amount: 300 })];
    const ledger = ledgerWithRunningBalance(income, expenses);
    expect(ledger.map((l) => l.id)).toEqual(["in1", "ex1", "in2"]);
    expect(ledger.map((l) => l.runningBalance)).toEqual([1000, 700, 1200]);
  });

  it("الإيراد المتوقع يظهر في الدفتر ولا يؤثر على الرصيد", () => {
    const income = [
      rec({ id: "in1", status: "مستلم", date: "2026-07-01", amount: 100 }),
      rec({ id: "in2", status: "متوقع", date: "2026-07-02", amount: 900 }),
    ];
    const ledger = ledgerWithRunningBalance(income, []);
    expect(ledger).toHaveLength(2);
    expect(ledger[1].runningBalance).toBe(100);
  });

  it("الملغى لا يظهر والمؤرشف لا يظهر والمبلغ الفارغ لا يغيّر الرصيد", () => {
    const income = [
      rec({ id: "in1", status: "ملغى", date: "2026-07-01", amount: 100 }),
      rec({ id: "in2", status: "مستلم", date: "2026-07-02", amount: null }),
    ];
    const expenses = [rec({ id: "ex1", date: "2026-07-03", archivedAt: new Date(), amount: 50 })];
    const ledger = ledgerWithRunningBalance(income, expenses);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].id).toBe("in2");
    expect(ledger[0].runningBalance).toBe(0);
  });

  it("الرصيد الجاري النهائي يساوي مجموع المستلم ناقص المصروف", () => {
    const income = [
      rec({ id: "a", status: "مستلم", date: "2026-01-01", amount: 700 }),
      rec({ id: "b", status: "مستلم", date: "2026-02-01", amount: 300 }),
    ];
    const expenses = [
      rec({ id: "c", date: "2026-03-01", amount: 450 }),
      rec({ id: "d", date: "2026-04-01", amount: 150 }),
    ];
    const ledger = ledgerWithRunningBalance(income, expenses);
    expect(ledger.at(-1)?.runningBalance).toBe(700 + 300 - 450 - 150);
  });
});

describe("قوائم اللوحة: الأعلى صرفاً / القريبة من النفاد / المتجاوزة", () => {
  const mk = (id: string, allocated: number | null, spent: number) => {
    const [line] = financialItemLines(
      [item({ id, name: id, allocated })],
      [],
      spent > 0 ? [rec({ financialItemId: id, amount: spent })] : [],
    );
    return line;
  };

  it("الأعلى صرفاً تنازلياً ويستبعد بنداً بلا صرف", () => {
    const lines = [mk("a", 1000, 100), mk("b", 1000, 900), mk("c", 1000, 0)];
    expect(topSpendingItems(lines).map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("القريبة من النفاد = بلغت 90٪ دون تجاوز؛ والمتجاوزة قائمة مستقلة", () => {
    const near = mk("near", 1000, 950);
    const over = mk("over", 1000, 1100);
    const ok = mk("ok", 1000, 100);
    expect(nearExhaustionItems([near, over, ok]).map((l) => l.id)).toEqual(["near"]);
    expect(overspentItems([near, over, ok]).map((l) => l.id)).toEqual(["over"]);
  });
});

describe("النشاط المالي الأخير", () => {
  it("مدمج تنازلياً ومحدود بالعدد المطلوب", () => {
    const income = [rec({ id: "i-old", status: "مستلم", date: "2026-01-01" })];
    const expenses = [
      rec({ id: "e-new", date: "2026-07-01" }),
      rec({ id: "e-mid", date: "2026-04-01" }),
    ];
    const recent = recentOperations(income, expenses, 2);
    expect(recent.map((r) => r.id)).toEqual(["e-new", "e-mid"]);
    expect(recent[0].kind).toBe("مصروف");
  });
});

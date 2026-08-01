import { describe, it, expect } from "vitest";
import {
  toMinor,
  fromMinor,
  moneySubtract,
  financialItemLines,
  overrunWarning,
  ledgerWithRunningBalance,
  type FinanceRecord,
  type FinancialItemInput,
} from "@/lib/finance/calc";

const item = (allocated: number | null): FinancialItemInput => ({
  id: "item-1",
  name: "بند",
  allocated,
  archivedAt: null,
  sortOrder: 0,
  color: null,
});

const expense = (id: string, amount: number | null, date: string, createdAt?: Date): FinanceRecord => ({
  id,
  amount,
  financialItemId: "item-1",
  archivedAt: null,
  date,
  hasInvoice: false,
  createdAt: createdAt ?? null,
});

const income = (id: string, amount: number | null, date: string): FinanceRecord => ({
  id,
  amount,
  financialItemId: "item-1",
  archivedAt: null,
  date,
  hasInvoice: false,
  status: "مستلم",
});

describe("v2.4 §4: الحساب العشري الآمن بالهللات", () => {
  it("التحويل ذهاباً وإياباً دقيق", () => {
    expect(toMinor(0.1)).toBe(10);
    expect(toMinor(1234.56)).toBe(123456);
    expect(fromMinor(30)).toBe(0.3);
  });

  it("الطرح الدقيق لا يسرب أخطاء الفاصلة العائمة", () => {
    expect(moneySubtract(0.3, 0.1)).toBe(0.2); // 0.3-0.1 === 0.19999999999999998 بالفاصلة العائمة
    expect(moneySubtract(1.03, 0.42)).toBe(0.61);
  });

  it("مجموع المصروفات الكسرية دقيق والمتبقي مضبوط", () => {
    const lines = financialItemLines(
      [item(1)],
      [],
      [expense("e1", 0.1, "2026-01-01"), expense("e2", 0.1, "2026-01-02"), expense("e3", 0.1, "2026-01-03")],
    );
    expect(lines[0].expenses).toBe(0.3); // لا 0.30000000000000004
    expect(lines[0].remaining).toBe(0.7);
  });

  it("تحذير التجاوز بدقة الهللة", () => {
    const w = overrunWarning({ allocated: 10, spentSoFar: 9.9, newAmount: 0.2 });
    expect(w.willOverrun).toBe(true);
    expect(w.remainingAfter).toBe(-0.1);
    expect(w.overrunBy).toBe(0.1);
  });
});

describe("v2.4 §4: دفتر البند — المتبقي من المخصص قبل/بعد كل مصروف", () => {
  it("مثال الموجز: مخصص 12,500 ومصروف 2,000 → قبل 12,500 وبعد 10,500", () => {
    const ledger = ledgerWithRunningBalance([], [expense("e1", 2000, "2026-02-01")], { allocated: 12500 });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].remainingBefore).toBe(12500);
    expect(ledger[0].remainingAfter).toBe(10500);
  });

  it("المصروفات تتخاصم تتابعياً والإيراد لا يغير المتبقي من المخصص", () => {
    const ledger = ledgerWithRunningBalance(
      [income("i1", 500, "2026-02-02")],
      [expense("e1", 2000, "2026-02-01"), expense("e2", 1500, "2026-02-03")],
      { allocated: 12500 },
    );
    const [first, second, third] = ledger;
    expect(first.kind).toBe("مصروف");
    expect(first.remainingAfter).toBe(10500);
    expect(second.kind).toBe("إيراد");
    expect(second.remainingBefore).toBeNull();
    expect(second.remainingAfter).toBeNull();
    expect(third.kind).toBe("مصروف");
    expect(third.remainingBefore).toBe(10500);
    expect(third.remainingAfter).toBe(9000);
  });

  it("بلا مخصص: عمودا المتبقي فارغان والرصيد النقدي يعمل كما كان", () => {
    const ledger = ledgerWithRunningBalance([], [expense("e1", 100, "2026-02-01")]);
    expect(ledger[0].remainingBefore).toBeNull();
    expect(ledger[0].remainingAfter).toBeNull();
    expect(ledger[0].runningBalance).toBe(-100);
  });

  it("ترتيب حتمي لعمليات اليوم الواحد: وقت الإدخال ثم المعرف", () => {
    const t1 = new Date("2026-02-01T08:00:00Z");
    const t2 = new Date("2026-02-01T09:00:00Z");
    const ledger = ledgerWithRunningBalance(
      [],
      [expense("b-later", 10, "2026-02-01", t2), expense("a-earlier", 20, "2026-02-01", t1)],
      { allocated: 100 },
    );
    expect(ledger.map((l) => l.id)).toEqual(["a-earlier", "b-later"]);
    expect(ledger[0].remainingAfter).toBe(80);
    expect(ledger[1].remainingAfter).toBe(70);
  });

  it("المبلغ الفارغ لا يخصم ولا يكسر تتابع المتبقي", () => {
    const ledger = ledgerWithRunningBalance(
      [],
      [expense("e1", null, "2026-02-01"), expense("e2", 50, "2026-02-02")],
      { allocated: 100 },
    );
    expect(ledger[0].remainingBefore).toBe(100);
    expect(ledger[0].remainingAfter).toBe(100);
    expect(ledger[1].remainingAfter).toBe(50);
  });
});

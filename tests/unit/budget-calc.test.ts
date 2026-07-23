import { describe, it, expect } from "vitest";
import { summarize, programBudgetLines, wouldOverspend, type ExpenseRow, type IncomeRow } from "@/lib/budget/calc";

const inc = (amount: number, status = "مستلم", programId: string | null = null): IncomeRow => ({ amount, status, programId });
const exp = (o: Partial<ExpenseRow> & { id: string; amount: number }): ExpenseRow => ({
  programId: null,
  activityId: null,
  hasReceipt: true,
  overspendAcknowledged: false,
  ...o,
});

describe("حسابات الميزانية (§8)", () => {
  it("الملخص: المستلم والمتوقع والمصروف والرصيد والنسبة", () => {
    const s = summarize(
      [inc(1000), inc(500, "متوقع"), inc(200, "ملغى")],
      [exp({ id: "a", amount: 300 }), exp({ id: "b", amount: 100 })],
    );
    expect(s.totalIncomeReceived).toBe(1000); // «متوقع» و«ملغى» لا يُحتسبان في المستلم
    expect(s.totalIncomeExpected).toBe(500);
    expect(s.totalExpenses).toBe(400);
    expect(s.availableBalance).toBe(600);
    expect(s.spendingPercent).toBe(40);
  });

  it("يعدّ المصروفات غير المرتبطة والناقصة الإيصال", () => {
    const s = summarize(
      [inc(1000)],
      [
        exp({ id: "a", amount: 100, programId: "p1", hasReceipt: true }),
        exp({ id: "b", amount: 50, programId: null, hasReceipt: false }),
        exp({ id: "c", amount: 30, programId: null, hasReceipt: true }),
      ],
    );
    expect(s.unlinkedExpenseCount).toBe(2);
    expect(s.unlinkedExpenseTotal).toBe(80);
    expect(s.missingReceiptCount).toBe(1);
  });

  it("الرصيد يصبح سالباً عند تجاوز المصروف الإيراد — بلا تطبيع", () => {
    const s = summarize([inc(100)], [exp({ id: "a", amount: 250 })]);
    expect(s.availableBalance).toBe(-150);
    expect(s.spendingPercent).toBe(250);
  });

  it("خطوط البرامج: المخطط والفعلي والمتبقي وعلم التجاوز", () => {
    const lines = programBudgetLines(
      [{ programId: "p1", amount: 1000 }, { programId: "p2", amount: 500 }],
      [
        exp({ id: "a", amount: 400, programId: "p1" }),
        exp({ id: "b", amount: 700, programId: "p2" }), // تجاوز
      ],
    );
    const p1 = lines.get("p1")!;
    expect(p1.remaining).toBe(600);
    expect(p1.overspent).toBe(false);
    const p2 = lines.get("p2")!;
    expect(p2.remaining).toBe(-200);
    expect(p2.overspent).toBe(true);
    expect(p2.spentPercent).toBe(140);
  });

  it("wouldOverspend يقارن بالمخصص المتبقي لا بالرصيد الكلي", () => {
    const w = wouldOverspend({ programAllocated: 1000, programSpentSoFar: 800, newAmount: 300 });
    expect(w.overspend).toBe(true);
    expect(w.remainingBefore).toBe(200);
    expect(w.remainingAfter).toBe(-100);

    const ok = wouldOverspend({ programAllocated: 1000, programSpentSoFar: 300, newAmount: 200 });
    expect(ok.overspend).toBe(false);

    // بلا مخصص مخطط لا يُحسب تجاوز
    const noAlloc = wouldOverspend({ programAllocated: 0, programSpentSoFar: 0, newAmount: 500 });
    expect(noAlloc.overspend).toBe(false);
  });
});

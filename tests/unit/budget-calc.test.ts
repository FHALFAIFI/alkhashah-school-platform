import { describe, it, expect } from "vitest";
import { summarize, programBudgetLines, budgetItemLines, wouldOverspend, type ExpenseRow, type IncomeRow } from "@/lib/budget/calc";

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

  it("hasAllocation: برنامج بلا ميزانية معتمدة يظهر بحالة محايدة لا صفر/سالب مضلِّل", () => {
    const lines = programBudgetLines(
      [{ programId: "p1", amount: 1000 }], // p1 له مخصص، p2 بلا مخصص
      [
        exp({ id: "a", amount: 200, programId: "p1" }),
        exp({ id: "b", amount: 300, programId: "p2" }),
      ],
    );
    const p1 = lines.get("p1")!;
    expect(p1.hasAllocation).toBe(true);
    expect(p1.allocated).toBe(1000);
    expect(p1.remaining).toBe(800);

    const p2 = lines.get("p2")!;
    expect(p2.hasAllocation).toBe(false); // العرض يستعمل «—» بدل المتبقي/النسبة
    expect(p2.spent).toBe(300);
    expect(p2.overspent).toBe(false); // لا تجاوز بلا مخصص معتمد
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

describe("بنود الميزانية — مخصص/مصروف/متبقٍ مستقل لكل بند (B4)", () => {
  const alloc = (item: string, amount: number) => ({ item, amount });
  const iexp = (items: string | null, amount: number) => ({ items, amount });

  it("المستلزمات 5000 والنشاط 3000؛ مصروف 1200 و800 → المتبقي 3800 و2200 (كلٌّ مستقل)", () => {
    const lines = budgetItemLines(
      [alloc("المستلزمات", 5000), alloc("النشاط", 3000)],
      [iexp("المستلزمات", 1200), iexp("النشاط", 800)],
    );
    const sup = lines.get("المستلزمات")!;
    expect(sup.allocated).toBe(5000);
    expect(sup.spent).toBe(1200);
    expect(sup.remaining).toBe(3800);
    const act = lines.get("النشاط")!;
    expect(act.allocated).toBe(3000);
    expect(act.spent).toBe(800);
    expect(act.remaining).toBe(2200);
  });

  it("حذف مصروف يعيد حساب بنده فقط — النشاط يعود 0/3000 والمستلزمات كما هي", () => {
    const afterDelete = budgetItemLines(
      [alloc("المستلزمات", 5000), alloc("النشاط", 3000)],
      [iexp("المستلزمات", 1200)], // حُذف مصروف النشاط 800
    );
    expect(afterDelete.get("النشاط")!.spent).toBe(0);
    expect(afterDelete.get("النشاط")!.remaining).toBe(3000);
    expect(afterDelete.get("المستلزمات")!.remaining).toBe(3800); // بند المستلزمات لم يتغيّر
  });

  it("تعديل مبلغ مصروف يعيد حساب بنده فقط — المستلزمات 1200→2000، النشاط ثابت", () => {
    const afterEdit = budgetItemLines(
      [alloc("المستلزمات", 5000), alloc("النشاط", 3000)],
      [iexp("المستلزمات", 2000), iexp("النشاط", 800)],
    );
    expect(afterEdit.get("المستلزمات")!.spent).toBe(2000);
    expect(afterEdit.get("المستلزمات")!.remaining).toBe(3000);
    expect(afterEdit.get("النشاط")!.remaining).toBe(2200); // بند النشاط لم يتغيّر
  });

  it("إعادة تصنيف مصروف من بند لآخر تنقل المبلغ بين البندين فقط", () => {
    // نُقل 1200 من المستلزمات إلى النشاط
    const moved = budgetItemLines(
      [alloc("المستلزمات", 5000), alloc("النشاط", 3000)],
      [iexp("النشاط", 1200), iexp("النشاط", 800)],
    );
    expect(moved.get("المستلزمات")!.spent).toBe(0);
    expect(moved.get("المستلزمات")!.remaining).toBe(5000);
    expect(moved.get("النشاط")!.spent).toBe(2000);
    expect(moved.get("النشاط")!.remaining).toBe(1000);
  });

  it("بند بلا مخصص معتمد يظهر محايداً؛ التجاوز يُعلَّم على بنده وحده", () => {
    const lines = budgetItemLines(
      [alloc("المستلزمات", 1000)],
      [iexp("المستلزمات", 1500), iexp("النشاط", 200)],
    );
    expect(lines.get("المستلزمات")!.overspent).toBe(true);
    expect(lines.get("المستلزمات")!.remaining).toBe(-500);
    // النشاط له مصروف بلا مخصص → حالة محايدة، لا تجاوز
    expect(lines.get("النشاط")!.hasAllocation).toBe(false);
    expect(lines.get("النشاط")!.overspent).toBe(false);
  });
});

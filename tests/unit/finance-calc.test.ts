import { describe, it, expect } from "vitest";
import {
  financialItemLines,
  summarizeSchoolFinance,
  overrunWarning,
  monthlyTotals,
  amountOrNull,
  type FinanceRecord,
  type FinancialItemInput,
} from "@/lib/finance/calc";

/**
 * Scope v2.2 §B5 — the single authoritative finance calculation service.
 *
 * The rules under test are the ones the principal's prompt calls out explicitly:
 * no double counting, no silent null→zero, no NaN, per-item independence, and an
 * overrun warning that never blocks a save.
 */

const ITEM_A = "11111111-1111-1111-1111-111111111111";
const ITEM_B = "22222222-2222-2222-2222-222222222222";

function item(over: Partial<FinancialItemInput> & { id: string }): FinancialItemInput {
  return { name: "بند", allocated: null, archivedAt: null, sortOrder: 0, color: null, ...over };
}

function rec(over: Partial<FinanceRecord> & { id: string }): FinanceRecord {
  return {
    amount: null,
    financialItemId: null,
    archivedAt: null,
    date: null,
    hasInvoice: false,
    ...over,
  };
}

const income = (o: Partial<FinanceRecord> & { id: string }) => rec({ status: "مستلم", ...o });
const expense = (o: Partial<FinanceRecord> & { id: string }) => rec(o);

describe("amountOrNull — لا NaN ولا صفر مُختلق", () => {
  it("يعيد null للفارغ وغير الرقمي", () => {
    for (const v of ["", "   ", null, undefined, "abc", NaN, Infinity]) {
      expect(amountOrNull(v as never)).toBeNull();
    }
  });
  it("يقبل الأرقام والنصوص الرقمية بما فيها الصفر الصريح", () => {
    expect(amountOrNull("0")).toBe(0);
    expect(amountOrNull("1500.5")).toBe(1500.5);
    expect(amountOrNull(-20)).toBe(-20);
  });
});

describe("financialItemLines — كل بند مستقل تماماً", () => {
  it("يحسب المخصص والإيراد والمصروف والمتبقي لكل بند على حدة", () => {
    const lines = financialItemLines(
      [item({ id: ITEM_A, name: "المستلزمات", allocated: 1000 }), item({ id: ITEM_B, name: "النشاط", allocated: 500 })],
      [income({ id: "i1", amount: 300, financialItemId: ITEM_A })],
      [
        expense({ id: "e1", amount: 200, financialItemId: ITEM_A }),
        expense({ id: "e2", amount: 100, financialItemId: ITEM_B }),
      ],
    );
    const a = lines.find((l) => l.id === ITEM_A)!;
    const b = lines.find((l) => l.id === ITEM_B)!;

    expect(a.allocated).toBe(1000);
    expect(a.income).toBe(300);
    expect(a.expenses).toBe(200);
    expect(a.remaining).toBe(800);
    expect(a.spentPercent).toBe(20);

    // استقلال تام: مصروف «النشاط» لم يمسّ «المستلزمات» بحال
    expect(b.expenses).toBe(100);
    expect(b.remaining).toBe(400);
  });

  it("البند بلا مخصص يعطي متبقياً null لا صفراً ولا رقماً سالباً", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A, allocated: null })],
      [],
      [expense({ id: "e1", amount: 700, financialItemId: ITEM_A })],
    );
    expect(line.hasAllocation).toBe(false);
    expect(line.remaining).toBeNull();
    expect(line.spentPercent).toBeNull();
    expect(line.overspent).toBe(false);
    expect(line.expenses).toBe(700);
  });

  it("لا يحوّل المبلغ الفارغ إلى صفر ولا ينتج NaN", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A, allocated: 100 })],
      [],
      [
        expense({ id: "e1", amount: null, financialItemId: ITEM_A }),
        expense({ id: "e2", amount: 40, financialItemId: ITEM_A }),
      ],
    );
    expect(line.expenses).toBe(40);
    expect(Number.isNaN(line.expenses)).toBe(false);
    expect(line.remaining).toBe(60);
  });

  it("يعلّم التجاوز دون تعديل أي رقم (لا تطبيع)", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A, allocated: 100 })],
      [],
      [expense({ id: "e1", amount: 250, financialItemId: ITEM_A })],
    );
    expect(line.expenses).toBe(250);
    expect(line.remaining).toBe(-150);
    expect(line.overspent).toBe(true);
  });

  it("يعلّم الاقتراب من استنفاد المخصص", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A, allocated: 100 })],
      [],
      [expense({ id: "e1", amount: 95, financialItemId: ITEM_A })],
    );
    expect(line.nearExhaustion).toBe(true);
    expect(line.overspent).toBe(false);
  });

  it("العملية بلا بند لا تُنسب لأي بند", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A, allocated: 100 })],
      [],
      [expense({ id: "e1", amount: 50, financialItemId: null })],
    );
    expect(line.expenses).toBe(0);
    expect(line.remaining).toBe(100);
  });

  it("السجل المؤرشف يخرج من المجاميع الجارية", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A, allocated: 100 })],
      [],
      [
        expense({ id: "e1", amount: 30, financialItemId: ITEM_A }),
        expense({ id: "e2", amount: 70, financialItemId: ITEM_A, archivedAt: new Date() }),
      ],
    );
    expect(line.expenses).toBe(30);
  });

  it("الإيراد الملغى والمتوقع لا يدخلان إيراد البند", () => {
    const [line] = financialItemLines(
      [item({ id: ITEM_A })],
      [
        income({ id: "i1", amount: 100, financialItemId: ITEM_A }),
        rec({ id: "i2", amount: 500, financialItemId: ITEM_A, status: "ملغى" }),
        rec({ id: "i3", amount: 400, financialItemId: ITEM_A, status: "متوقع" }),
      ],
      [],
    );
    expect(line.income).toBe(100);
  });

  it("لا احتساب مزدوج عند تكرار نفس البند في عمليات كثيرة", () => {
    const many = Array.from({ length: 10 }, (_, i) => expense({ id: `e${i}`, amount: 10, financialItemId: ITEM_A }));
    const [line] = financialItemLines([item({ id: ITEM_A, allocated: 1000 })], [], many);
    expect(line.expenses).toBe(100);
    expect(line.operationCount).toBe(10);
  });
});

describe("summarizeSchoolFinance — المجاميع المدرسية", () => {
  const items = [
    item({ id: ITEM_A, name: "المستلزمات", allocated: 1000 }),
    item({ id: ITEM_B, name: "النشاط", allocated: 500 }),
  ];

  it("الرصيد الحالي = الإيراد المستلم − المصروف", () => {
    const s = summarizeSchoolFinance(
      items,
      [income({ id: "i1", amount: 2000, financialItemId: ITEM_A })],
      [expense({ id: "e1", amount: 750, financialItemId: ITEM_A })],
    );
    expect(s.totalIncome).toBe(2000);
    expect(s.totalExpenses).toBe(750);
    expect(s.cashBalance).toBe(1250);
  });

  it("الإيراد المتوقع يُتابع منفصلاً ولا يدخل الرصيد", () => {
    const s = summarizeSchoolFinance(
      items,
      [
        income({ id: "i1", amount: 1000, financialItemId: ITEM_A }),
        rec({ id: "i2", amount: 900, status: "متوقع", financialItemId: ITEM_A }),
      ],
      [],
    );
    expect(s.totalIncome).toBe(1000);
    expect(s.totalExpectedIncome).toBe(900);
    expect(s.cashBalance).toBe(1000);
  });

  it("يجمع المخصصات والمتبقي من البنود الحيّة فقط", () => {
    const s = summarizeSchoolFinance(
      [...items, item({ id: "33333333-3333-3333-3333-333333333333", allocated: 9999, archivedAt: new Date() })],
      [],
      [expense({ id: "e1", amount: 200, financialItemId: ITEM_A })],
    );
    expect(s.totalAllocated).toBe(1500);
    expect(s.totalRemaining).toBe(1300);
  });

  it("يعدّ الفواتير المرفقة والعمليات بلا فاتورة", () => {
    const s = summarizeSchoolFinance(
      items,
      [income({ id: "i1", amount: 10, hasInvoice: true })],
      [expense({ id: "e1", amount: 20, hasInvoice: false }), expense({ id: "e2", amount: 30, hasInvoice: true })],
    );
    expect(s.operationCount).toBe(3);
    expect(s.withInvoiceCount).toBe(2);
    expect(s.withoutInvoiceCount).toBe(1);
  });

  it("يُظهر نقص المبالغ بدل إخفائه خلف صفر", () => {
    const s = summarizeSchoolFinance(items, [], [expense({ id: "e1", amount: null, financialItemId: ITEM_A })]);
    expect(s.missingAmountCount).toBe(1);
    expect(s.totalExpenses).toBe(0);
    expect(Number.isNaN(s.totalExpenses)).toBe(false);
  });

  it("يعدّ البنود المتجاوزة والمقاربة للاستنفاد", () => {
    const s = summarizeSchoolFinance(
      items,
      [],
      [
        expense({ id: "e1", amount: 1200, financialItemId: ITEM_A }), // تجاوز
        expense({ id: "e2", amount: 480, financialItemId: ITEM_B }), // قارب الاستنفاد
      ],
    );
    expect(s.overAllocationCount).toBe(1);
    expect(s.nearExhaustionCount).toBe(1);
  });

  it("لا ينتج NaN ولا undefined على مجموعة فارغة تماماً", () => {
    const s = summarizeSchoolFinance([], [], []);
    // v2.4.1 §1.1: الملخّص صار يحمل حقلين غير عدديين عمداً — `hasAnyAllocation` منطقي
    // و`spentPercent` يساوي `null` حين لا مقام يُقسم عليه. كلاهما إعلان حالة لا رقم.
    const { hasAnyAllocation, spentPercent, ...numeric } = s;
    for (const v of Object.values(numeric)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(hasAnyAllocation).toBe(false);
    expect(spentPercent).toBeNull();
    expect(s.cashBalance).toBe(0);
  });

  it("المجاميع تطابق الجمع المباشر للسجلات (لا احتساب مزدوج)", () => {
    const inc = [1000, 250, 75].map((amount, i) => income({ id: `i${i}`, amount, financialItemId: ITEM_A }));
    const exp = [300, 120, 45.5].map((amount, i) => expense({ id: `e${i}`, amount, financialItemId: ITEM_B }));
    const s = summarizeSchoolFinance(items, inc, exp);
    expect(s.totalIncome).toBe(1325);
    expect(s.totalExpenses).toBe(465.5);
    expect(s.cashBalance).toBe(859.5);
  });
});

describe("overrunWarning — تحذير لا يمنع الحفظ (§B7)", () => {
  it("يعيد مقدار التجاوز المتوقع", () => {
    const w = overrunWarning({ allocated: 1000, spentSoFar: 900, newAmount: 250 });
    expect(w.willOverrun).toBe(true);
    expect(w.overrunBy).toBe(150);
    expect(w.remainingAfter).toBe(-150);
  });

  it("لا تجاوز حين يبقى ضمن المخصص", () => {
    expect(overrunWarning({ allocated: 1000, spentSoFar: 100, newAmount: 50 }).willOverrun).toBe(false);
  });

  it("بلا مخصص لا يوجد تجاوز يُقاس", () => {
    const w = overrunWarning({ allocated: null, spentSoFar: 500, newAmount: 900 });
    expect(w.willOverrun).toBe(false);
    expect(w.remainingAfter).toBeNull();
  });

  it("المبلغ الفارغ لا ينتج NaN", () => {
    const w = overrunWarning({ allocated: 100, spentSoFar: 20, newAmount: null });
    expect(Number.isNaN(w.overrunBy)).toBe(false);
    expect(w.remainingAfter).toBe(80);
  });
});

describe("monthlyTotals — اتجاه شهري", () => {
  it("يجمع حسب الشهر ويتجاهل ما لا تاريخ له", () => {
    const rows = monthlyTotals([
      expense({ id: "e1", amount: 100, date: "2026-07-05" }),
      expense({ id: "e2", amount: 50, date: "2026-07-20" }),
      expense({ id: "e3", amount: 70, date: "2026-08-01" }),
      expense({ id: "e4", amount: 999, date: null }),
    ]);
    expect(rows).toEqual([
      { month: "2026-07", total: 150, count: 2 },
      { month: "2026-08", total: 70, count: 1 },
    ]);
  });

  it("لا يسقط على تاريخ مشوّه", () => {
    expect(() => monthlyTotals([expense({ id: "e1", amount: 10, date: "غير صالح" })])).not.toThrow();
    expect(monthlyTotals([expense({ id: "e1", amount: 10, date: "غير صالح" })])).toEqual([]);
  });

  it("يستثني المؤرشف", () => {
    const rows = monthlyTotals([expense({ id: "e1", amount: 10, date: "2026-07-01", archivedAt: new Date() })]);
    expect(rows).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * v2.4.1 §1.1 / §5.1 — الملخّص الأعلى: المخصص والمتبقي ونسبة الإنفاق.
 *
 * الفرق المحمي هنا: **صفر لأنه نفد** ≠ **صفر لعدم وجود ما يُحتسب**. حين لا مخصص لأي بند
 * تُنقل الحالة صراحةً (`hasAnyAllocation = false`, `spentPercent = null`) فتعرض الشاشة
 * نصاً عربياً بدل رقم صفري يُقرأ خطأ.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("v2.4.1 §1.1 — إجماليات الملخّص الأعلى", () => {
  const item = (id: string, allocated: number | null) => ({
    id,
    name: id,
    allocated,
    archivedAt: null,
    sortOrder: 0,
    color: null,
  });
  const expense = (id: string, itemId: string | null, amount: number | null) => ({
    id,
    amount,
    financialItemId: itemId,
    archivedAt: null,
    date: "2026-01-01",
    hasInvoice: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });

  it("بلا أي مخصص: الحالة معلنة والنسبة null — لا صفر مضلِّل", () => {
    const s = summarizeSchoolFinance([item("a", null), item("b", null)], [], [expense("e1", "a", 300)]);
    expect(s.hasAnyAllocation).toBe(false);
    expect(s.unallocatedItemCount).toBe(2);
    expect(s.spentPercent).toBeNull();
    expect(s.totalAllocated).toBe(0);
    expect(s.totalRemaining).toBe(0);
    // والمصروف نفسه محسوب رغم غياب المخصص — المالية لا تتوقف
    expect(s.totalExpenses).toBe(300);
  });

  it("بمخصص موجب: المتبقي والنسبة محسوبان بدقة الهللة", () => {
    const s = summarizeSchoolFinance([item("a", 1000)], [], [expense("e1", "a", 250.5)]);
    expect(s.hasAnyAllocation).toBe(true);
    expect(s.unallocatedItemCount).toBe(0);
    expect(s.totalAllocated).toBe(1000);
    expect(s.totalRemaining).toBe(749.5);
    expect(s.spentPercent).toBe(25);
  });

  it("مخصص صفر: النسبة null لأن القسمة على صفر بلا معنى، والحالة ليست «بلا مخصص»", () => {
    const s = summarizeSchoolFinance([item("a", 0)], [], [expense("e1", "a", 50)]);
    expect(s.hasAnyAllocation).toBe(true);
    expect(s.unallocatedItemCount).toBe(0);
    expect(s.spentPercent).toBeNull();
    expect(s.totalRemaining).toBe(-50);
  });

  it("خليط: النسبة تُحسب من البنود ذات المخصص وحدها، والبنود بلا مخصص تُعدّ", () => {
    const s = summarizeSchoolFinance(
      [item("a", 1000), item("b", null)],
      [],
      [expense("e1", "a", 400), expense("e2", "b", 999)],
    );
    expect(s.hasAnyAllocation).toBe(true);
    expect(s.unallocatedItemCount).toBe(1);
    // 400 من 1000 — مصروف البند بلا مخصص لا يدخل النسبة (لا مقام له)
    expect(s.spentPercent).toBe(40);
    expect(s.totalRemaining).toBe(600);
    expect(s.totalExpenses).toBe(1399);
  });

  it("التجاوز يُنقل كنسبة أكبر من 100 لا يُطبَّع", () => {
    const s = summarizeSchoolFinance([item("a", 100)], [], [expense("e1", "a", 150)]);
    expect(s.spentPercent).toBe(150);
    expect(s.totalRemaining).toBe(-50);
    expect(s.overAllocationCount).toBe(1);
  });

  it("البند المؤرشف خارج الإجماليات والعدّ", () => {
    const archived = { ...item("z", 500), archivedAt: new Date() };
    const s = summarizeSchoolFinance([item("a", 1000), archived], [], [expense("e1", "a", 100)]);
    expect(s.totalAllocated).toBe(1000);
    expect(s.unallocatedItemCount).toBe(0);
  });
});

/**
 * حسابات الميزانية (§8) — وحدة خالصة بلا وصول لقاعدة البيانات.
 * كل القيم المالية تُحسب هنا وتُعرض؛ لا تُغيَّر قيمة مالية صامتاً أبداً.
 */

export type IncomeRow = {
  amount: number;
  status: string; // متوقع | مستلم | ملغى
  programId: string | null;
};

export type ExpenseRow = {
  id: string;
  amount: number;
  programId: string | null;
  activityId: string | null;
  hasReceipt: boolean;
  overspendAcknowledged: boolean;
};

export type PlannedRow = {
  programId: string | null;
  amount: number;
};

export const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export type BudgetSummary = {
  /** المستلم فعلياً (لا يشمل «متوقع» أو «ملغى») */
  totalIncomeReceived: number;
  /** المتوقع (لم يُستلم بعد) */
  totalIncomeExpected: number;
  totalExpenses: number;
  /** الرصيد المتاح = المستلم − المصروف */
  availableBalance: number;
  /** نسبة الإنفاق من المستلم */
  spendingPercent: number;
  /** مصروفات غير مرتبطة ببرنامج */
  unlinkedExpenseCount: number;
  unlinkedExpenseTotal: number;
  /** مصروفات بلا إيصال/شاهد */
  missingReceiptCount: number;
  /** مصروفات متجاوزة لم يُقرّ تجاوزها */
  unacknowledgedOverspendCount: number;
};

export function summarize(income: IncomeRow[], expenses: ExpenseRow[]): BudgetSummary {
  const totalIncomeReceived = income.filter((i) => i.status === "مستلم").reduce((s, i) => s + num(i.amount), 0);
  const totalIncomeExpected = income.filter((i) => i.status === "متوقع").reduce((s, i) => s + num(i.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const availableBalance = totalIncomeReceived - totalExpenses;
  const spendingPercent = totalIncomeReceived > 0 ? Math.round((totalExpenses / totalIncomeReceived) * 100) : 0;

  const unlinked = expenses.filter((e) => !e.programId);
  const missingReceipt = expenses.filter((e) => !e.hasReceipt);
  const unackOverspend = expenses.filter((e) => !e.overspendAcknowledged);

  return {
    totalIncomeReceived,
    totalIncomeExpected,
    totalExpenses,
    availableBalance,
    spendingPercent,
    unlinkedExpenseCount: unlinked.length,
    unlinkedExpenseTotal: unlinked.reduce((s, e) => s + num(e.amount), 0),
    missingReceiptCount: missingReceipt.length,
    unacknowledgedOverspendCount: unackOverspend.filter((e) => e.overspendAcknowledged === false).length,
  };
}

export type ProgramBudgetLine = {
  programId: string;
  /** المخصص المخطط للبرنامج */
  allocated: number;
  /** المنفَق الفعلي على البرنامج */
  spent: number;
  /** المتبقي من المخصص = المخصص − المنفَق (قد يكون سالباً عند التجاوز) */
  remaining: number;
  /** نسبة الإنفاق من المخصص */
  spentPercent: number;
  /** تجاوز = المنفَق > المخصص */
  overspent: boolean;
};

/**
 * مقارنة المخطط بالفعلي لكل برنامج. لا تطبيع: المنفَق يبقى كما هو حتى عند تجاوز المخصص،
 * ويُعلَّم `overspent` بدل تعديل أي رقم.
 */
export function programBudgetLines(planned: PlannedRow[], expenses: ExpenseRow[]): Map<string, ProgramBudgetLine> {
  const allocByProgram = new Map<string, number>();
  for (const p of planned) {
    if (!p.programId) continue;
    allocByProgram.set(p.programId, (allocByProgram.get(p.programId) ?? 0) + num(p.amount));
  }
  const spentByProgram = new Map<string, number>();
  for (const e of expenses) {
    if (!e.programId) continue;
    spentByProgram.set(e.programId, (spentByProgram.get(e.programId) ?? 0) + num(e.amount));
  }

  const lines = new Map<string, ProgramBudgetLine>();
  const programIds = new Set([...allocByProgram.keys(), ...spentByProgram.keys()]);
  for (const programId of programIds) {
    const allocated = allocByProgram.get(programId) ?? 0;
    const spent = spentByProgram.get(programId) ?? 0;
    lines.set(programId, {
      programId,
      allocated,
      spent,
      remaining: allocated - spent,
      spentPercent: allocated > 0 ? Math.round((spent / allocated) * 100) : 0,
      overspent: spent > allocated && allocated > 0,
    });
  }
  return lines;
}

/**
 * هل يتجاوز مصروف جديد المخصص المتبقي للبرنامج؟ يُستعمل لإظهار التحذير وطلب الإقرار.
 * يقارن بالمخصص المخطط، لا بالرصيد الكلي.
 */
export function wouldOverspend(opts: {
  programAllocated: number;
  programSpentSoFar: number;
  newAmount: number;
}): { overspend: boolean; remainingBefore: number; remainingAfter: number } {
  const remainingBefore = opts.programAllocated - opts.programSpentSoFar;
  const remainingAfter = remainingBefore - num(opts.newAmount);
  // التجاوز يُحتسب فقط حين يوجد مخصص مخطط
  return {
    overspend: opts.programAllocated > 0 && remainingAfter < 0,
    remainingBefore,
    remainingAfter,
  };
}

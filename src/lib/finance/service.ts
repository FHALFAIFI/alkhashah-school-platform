import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetIncome,
  budgetExpenses,
  financialItems,
  evidenceItems,
  evidenceLinks,
  programs,
  people,
} from "@/db/schema";
import {
  amountOrNull,
  financialItemLines,
  summarizeSchoolFinance,
  monthlyTotals,
  ledgerWithRunningBalance,
  type FinanceRecord,
  type FinancialItemLine,
  type FinancialItemInput,
  type SchoolFinanceSummary,
  type LedgerLine,
} from "./calc";
import { users } from "@/db/schema";

/**
 * طبقة قراءة المالية المدرسية (v2.2 §B) — تجمع السجلات وتمرّرها إلى خدمة الحساب الوحيدة
 * في `./calc`. لا يوجد هنا أي منطق حسابي: الأرقام كلها تخرج من `calc` فلا تتفرّع النتائج
 * بين اللوحة والتقارير والتصدير.
 */

/** أي السجلات لها فاتورة/إيصال مرفق غير مؤرشف — معلوماتي لا إلزامي */
async function invoiceFlags(entityType: "budget_expense" | "budget_income", ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ entityId: evidenceLinks.entityId })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(
      and(
        eq(evidenceLinks.entityType, entityType),
        inArray(evidenceLinks.entityId, ids),
        isNull(evidenceItems.archivedAt),
      ),
    );
  return new Set(rows.map((r) => r.entityId));
}

export type IncomeRow = typeof budgetIncome.$inferSelect & {
  hasInvoice: boolean;
  itemName: string | null;
  /** اسم البرنامج التاريخي إن وُجد ربط قديم — للعرض التاريخي فقط (§B1) */
  legacyProgramName: string | null;
};

export type ExpenseRow = typeof budgetExpenses.$inferSelect & {
  hasInvoice: boolean;
  itemName: string | null;
  responsibleName: string | null;
  legacyProgramName: string | null;
};

export type SchoolFinanceOverview = {
  summary: SchoolFinanceSummary;
  items: (typeof financialItems.$inferSelect)[];
  lines: FinancialItemLine[];
  income: IncomeRow[];
  expenses: ExpenseRow[];
  monthlyIncome: { month: string; total: number; count: number }[];
  monthlyExpenses: { month: string; total: number; count: number }[];
};

/** تحويل صف إيراد إلى سجل الحساب المحايد */
function toIncomeRecord(r: typeof budgetIncome.$inferSelect, hasInvoice: boolean): FinanceRecord {
  return {
    id: r.id,
    amount: amountOrNull(r.amount),
    financialItemId: r.financialItemId,
    archivedAt: r.archivedAt,
    date: r.incomeDate,
    hasInvoice,
    status: r.status,
    createdAt: r.createdAt,
  };
}

function toExpenseRecord(r: typeof budgetExpenses.$inferSelect, hasInvoice: boolean): FinanceRecord {
  return {
    id: r.id,
    amount: amountOrNull(r.amount),
    financialItemId: r.financialItemId,
    archivedAt: r.archivedAt,
    date: r.expenseDate,
    hasInvoice,
    createdAt: r.createdAt,
  };
}

/**
 * نظرة المالية المدرسية الكاملة.
 *
 * المالية على مستوى المدرسة (§B1): لا تُرشَّح بالبرنامج ولا بالتصنيف ولا بالمجال. تبقى
 * السنة التخطيطية فترةً محاسبية اختيارية للترشيح الزمني لا ارتباطاً تشغيلياً ببرنامج.
 */
export async function getSchoolFinance(opts?: { planYearId?: string }): Promise<SchoolFinanceOverview> {
  const yearFilter = opts?.planYearId;

  const [items, income, expenses] = await Promise.all([
    db.select().from(financialItems).orderBy(asc(financialItems.sortOrder), asc(financialItems.createdAt)),
    db
      .select()
      .from(budgetIncome)
      .where(yearFilter ? eq(budgetIncome.planYearId, yearFilter) : undefined)
      .orderBy(desc(budgetIncome.createdAt)),
    db
      .select()
      .from(budgetExpenses)
      .where(yearFilter ? eq(budgetExpenses.planYearId, yearFilter) : undefined)
      .orderBy(desc(budgetExpenses.createdAt)),
  ]);

  const [incomeInvoices, expenseInvoices] = await Promise.all([
    invoiceFlags("budget_income", income.map((r) => r.id)),
    invoiceFlags("budget_expense", expenses.map((r) => r.id)),
  ]);

  // أسماء البنود والمسؤولين والبرامج التاريخية — استعلام واحد لكل مجموعة معرّفات (لا N+1)
  const itemName = new Map(items.map((i) => [i.id, i.nameAr]));

  const personIds = [...new Set(expenses.map((e) => e.responsiblePersonId).filter((x): x is string => !!x))];
  const persons = personIds.length
    ? await db.select({ id: people.id, name: people.fullName }).from(people).where(inArray(people.id, personIds))
    : [];
  const personName = new Map(persons.map((p) => [p.id, p.name]));

  const legacyProgramIds = [
    ...new Set([...income, ...expenses].map((r) => r.programId).filter((x): x is string => !!x)),
  ];
  const legacyPrograms = legacyProgramIds.length
    ? await db.select({ id: programs.id, name: programs.name }).from(programs).where(inArray(programs.id, legacyProgramIds))
    : [];
  const legacyProgramName = new Map(legacyPrograms.map((p) => [p.id, p.name]));

  const incomeRows: IncomeRow[] = income.map((r) => ({
    ...r,
    hasInvoice: incomeInvoices.has(r.id),
    itemName: r.financialItemId ? itemName.get(r.financialItemId) ?? null : null,
    legacyProgramName: r.programId ? legacyProgramName.get(r.programId) ?? null : null,
  }));
  const expenseRows: ExpenseRow[] = expenses.map((r) => ({
    ...r,
    hasInvoice: expenseInvoices.has(r.id),
    itemName: r.financialItemId ? itemName.get(r.financialItemId) ?? null : null,
    responsibleName: r.responsiblePersonId ? personName.get(r.responsiblePersonId) ?? null : null,
    legacyProgramName: r.programId ? legacyProgramName.get(r.programId) ?? null : null,
  }));

  const incomeRecords = income.map((r) => toIncomeRecord(r, incomeInvoices.has(r.id)));
  const expenseRecords = expenses.map((r) => toExpenseRecord(r, expenseInvoices.has(r.id)));
  const itemInputs: FinancialItemInput[] = items.map((i) => ({
    id: i.id,
    name: i.nameAr,
    allocated: amountOrNull(i.allocatedAmount),
    archivedAt: i.archivedAt,
    sortOrder: i.sortOrder,
    color: i.color,
  }));

  return {
    summary: summarizeSchoolFinance(itemInputs, incomeRecords, expenseRecords),
    items,
    lines: financialItemLines(itemInputs, incomeRecords, expenseRecords),
    income: incomeRows,
    expenses: expenseRows,
    monthlyIncome: monthlyTotals(incomeRecords.filter((r) => r.status === "مستلم")),
    monthlyExpenses: monthlyTotals(expenseRecords),
  };
}

export type ItemFinanceDetail = {
  line: FinancialItemLine;
  income: IncomeRow[];
  expenses: ExpenseRow[];
  /** دفتر مُدمج بترتيب زمني تصاعدي مع رصيد جارٍ للبند */
  ledger: LedgerLine[];
  /** أسماء المستخدمين (مُدخِل/مُعدِّل) — المفتاح معرّف المستخدم */
  userNames: Map<string, string>;
};

/**
 * تفصيل بند مالي واحد (v2.3 §6) — يعيد استعمال حمولة `getSchoolFinance` نفسها
 * فيبقى الحساب من مصدر واحد (`calc`)، ثم يقيّد العرض على عمليات البند.
 */
export async function getItemFinanceDetail(
  itemId: string,
  opts?: { planYearId?: string },
): Promise<ItemFinanceDetail | null> {
  const overview = await getSchoolFinance(opts);
  const line = overview.lines.find((l) => l.id === itemId);
  if (!line) return null;

  const income = overview.income.filter((r) => r.financialItemId === itemId);
  const expenses = overview.expenses.filter((r) => r.financialItemId === itemId);

  const ledger = ledgerWithRunningBalance(
    income.map((r) => toIncomeRecord(r, r.hasInvoice)),
    expenses.map((r) => toExpenseRecord(r, r.hasInvoice)),
    // v2.4 §4: تمرير مخصص البند يفعّل عمودي «المتبقي قبل/بعد» لكل مصروف في الدفتر
    { allocated: line.allocated },
  );

  const userIds = [
    ...new Set(
      [...income, ...expenses]
        .flatMap((r) => [r.createdBy, r.updatedBy])
        .filter((x): x is string => !!x),
    ),
  ];
  const userRows = userIds.length
    ? await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds))
    : [];

  return { line, income, expenses, ledger, userNames: new Map(userRows.map((u) => [u.id, u.name])) };
}

/**
 * المصروف الجاري على بند واحد — يُستعمل لحساب تحذير التجاوز قبل الحفظ.
 * استعلام مُفهرَس على `financial_item_id` بلا مسح كامل للجدول.
 */
export async function spentOnItem(financialItemId: string): Promise<number> {
  const rows = await db
    .select({ amount: budgetExpenses.amount })
    .from(budgetExpenses)
    .where(and(eq(budgetExpenses.financialItemId, financialItemId), isNull(budgetExpenses.archivedAt)));
  let total = 0;
  for (const r of rows) {
    const n = amountOrNull(r.amount);
    if (n !== null) total += n;
  }
  return total;
}

import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetIncome,
  budgetExpenses,
  programs,
  people,
  evidenceItems,
  evidenceLinks,
} from "@/db/schema";
import { summarize, programBudgetLines, num, type BudgetSummary, type ProgramBudgetLine, type PlannedRow } from "./calc";
import { numOrNull } from "@/lib/format";

/** أي السجلات (مصروف/إيراد) لديها إيصال/شاهد غير مؤرشف مرتبط — معلوماتي فقط، غير إلزامي (D-026). */
async function receiptFlags(entityType: "budget_expense" | "budget_income", ids: string[]): Promise<Set<string>> {
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

export type BudgetOverview = {
  summary: BudgetSummary;
  income: ((typeof budgetIncome.$inferSelect) & { hasReceipt: boolean })[];
  expenses: ((typeof budgetExpenses.$inferSelect) & { hasReceipt: boolean; programName: string | null; responsibleName: string | null })[];
  programLines: (ProgramBudgetLine & { programName: string })[];
};

export async function getBudgetOverview(planYearId: string): Promise<BudgetOverview> {
  const [income, expenses] = await Promise.all([
    db.select().from(budgetIncome).where(eq(budgetIncome.planYearId, planYearId)).orderBy(desc(budgetIncome.createdAt)),
    db.select().from(budgetExpenses).where(eq(budgetExpenses.planYearId, planYearId)).orderBy(desc(budgetExpenses.createdAt)),
  ]);

  const [receipts, incomeReceipts] = await Promise.all([
    receiptFlags("budget_expense", expenses.map((e) => e.id)),
    receiptFlags("budget_income", income.map((i) => i.id)),
  ]);
  const incomeRows = income.map((i) => ({ ...i, hasReceipt: incomeReceipts.has(i.id) }));

  // برامج السنة: الاسم للعرض و `programs.budget` مصدر «الميزانية المعتمدة» الوحيد (D-026/§8)
  // بدل مسار plan_budget_items الفارغ. نجلب كل برامج السنة (حتى المؤرشفة) حتى يظهر اسم البرنامج
  // المرتبط بمصروف تاريخي؛ أما التخصيص فيؤخذ من البرامج غير المؤرشفة ذات القيمة الموجبة فقط.
  const planPrograms = await db
    .select({ id: programs.id, name: programs.name, budget: programs.budget, archivedAt: programs.archivedAt })
    .from(programs)
    .where(eq(programs.planYearId, planYearId));
  const progName = new Map(planPrograms.map((p) => [p.id, p.name]));

  // أسماء المسؤولين لعرض المصروفات
  const personIds = [...new Set(expenses.map((e) => e.responsiblePersonId).filter((x): x is string => !!x))];
  const persons = personIds.length
    ? await db.select({ id: people.id, name: people.fullName }).from(people).where(inArray(people.id, personIds))
    : [];
  const personName = new Map(persons.map((p) => [p.id, p.name]));

  const expenseRows = expenses.map((e) => ({
    ...e,
    hasReceipt: receipts.has(e.id),
    programName: e.programId ? progName.get(e.programId) ?? null : null,
    responsibleName: e.responsiblePersonId ? personName.get(e.responsiblePersonId) ?? null : null,
  }));

  // صفوف الحساب — null-safe: `num` يحوّل المبلغ الفارغ (المبلغ اختياري v2.1) إلى 0 دون NaN.
  // القيمة الفارغة تسهم بصفر في المجاميع لكنها ليست «مُدخلة» — والعرض يستعمل «—» بدلها.
  const incomeCalc = income.map((i) => ({ amount: num(i.amount), status: i.status, programId: i.programId }));
  const expenseCalc = expenseRows.map((e) => ({
    id: e.id,
    amount: num(e.amount),
    programId: e.programId,
    activityId: e.activityId,
    hasReceipt: e.hasReceipt,
    overspendAcknowledged: e.overspendAcknowledged,
  }));

  const summary = summarize(incomeCalc, expenseCalc);

  // «الميزانية المعتمدة» لكل برنامج = programs.budget (للبرامج غير المؤرشفة وحين تكون قيمة موجبة).
  // البرنامج بلا مخصص يظهر بحالة محايدة عبر hasAllocation في خط البرنامج، لا صفر مضلِّل.
  const planned: PlannedRow[] = [];
  for (const p of planPrograms) {
    if (p.archivedAt) continue;
    const amt = numOrNull(p.budget);
    if (amt !== null && amt > 0) planned.push({ programId: p.id, amount: amt });
  }

  const linesMap = programBudgetLines(planned, expenseCalc);
  const programLines = [...linesMap.values()]
    .map((line) => ({ ...line, programName: progName.get(line.programId) ?? "برنامج" }))
    .sort((a, b) => a.programName.localeCompare(b.programName, "ar"));

  return { summary, income: incomeRows, expenses: expenseRows, programLines };
}

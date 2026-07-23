import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  budgetIncome,
  budgetExpenses,
  planBudgetItems,
  programs,
  programActivities,
  people,
  evidenceItems,
  evidenceLinks,
} from "@/db/schema";
import { summarize, programBudgetLines, type BudgetSummary, type ProgramBudgetLine } from "./calc";

/** أي المصروفات لديها شاهد/إيصال غير مؤرشف مرتبط. */
async function expenseReceiptFlags(expenseIds: string[]): Promise<Set<string>> {
  if (expenseIds.length === 0) return new Set();
  const rows = await db
    .select({ entityId: evidenceLinks.entityId })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(
      and(
        eq(evidenceLinks.entityType, "budget_expense"),
        inArray(evidenceLinks.entityId, expenseIds),
        isNull(evidenceItems.archivedAt),
      ),
    );
  return new Set(rows.map((r) => r.entityId));
}

export type BudgetOverview = {
  summary: BudgetSummary;
  income: (typeof budgetIncome.$inferSelect)[];
  expenses: ((typeof budgetExpenses.$inferSelect) & { hasReceipt: boolean; programName: string | null; responsibleName: string | null })[];
  programLines: (ProgramBudgetLine & { programName: string })[];
};

export async function getBudgetOverview(planYearId: string): Promise<BudgetOverview> {
  const [income, expenses, planned] = await Promise.all([
    db.select().from(budgetIncome).where(eq(budgetIncome.planYearId, planYearId)).orderBy(desc(budgetIncome.createdAt)),
    db.select().from(budgetExpenses).where(eq(budgetExpenses.planYearId, planYearId)).orderBy(desc(budgetExpenses.createdAt)),
    db.select().from(planBudgetItems).where(eq(planBudgetItems.planYearId, planYearId)),
  ]);

  const receipts = await expenseReceiptFlags(expenses.map((e) => e.id));

  // أسماء البرامج والمسؤولين لعرض المصروفات
  const programIds = [...new Set(expenses.map((e) => e.programId).filter((x): x is string => !!x))];
  const personIds = [...new Set(expenses.map((e) => e.responsiblePersonId).filter((x): x is string => !!x))];
  const [progs, persons] = await Promise.all([
    programIds.length ? db.select({ id: programs.id, name: programs.name }).from(programs).where(inArray(programs.id, programIds)) : Promise.resolve([]),
    personIds.length ? db.select({ id: people.id, name: people.fullName }).from(people).where(inArray(people.id, personIds)) : Promise.resolve([]),
  ]);
  const progName = new Map(progs.map((p) => [p.id, p.name]));
  const personName = new Map(persons.map((p) => [p.id, p.name]));

  const expenseRows = expenses.map((e) => ({
    ...e,
    hasReceipt: receipts.has(e.id),
    programName: e.programId ? progName.get(e.programId) ?? null : null,
    responsibleName: e.responsiblePersonId ? personName.get(e.responsiblePersonId) ?? null : null,
  }));

  const summary = summarize(
    income.map((i) => ({ amount: Number(i.amount), status: i.status, programId: i.programId })),
    expenseRows.map((e) => ({
      id: e.id,
      amount: Number(e.amount),
      programId: e.programId,
      activityId: e.activityId,
      hasReceipt: e.hasReceipt,
      overspendAcknowledged: e.overspendAcknowledged,
    })),
  );

  const lines = programBudgetLines(
    planned.map((p) => ({ programId: null as string | null, amount: Number(p.amount) })),
    expenseRows.map((e) => ({ id: e.id, amount: Number(e.amount), programId: e.programId, activityId: e.activityId, hasReceipt: e.hasReceipt, overspendAcknowledged: e.overspendAcknowledged })),
  );
  // plan_budget_items ليست مرتبطة ببرنامج في المخطط الحالي؛ خطوط البرامج تُبنى من المصروفات
  // المرتبطة ببرامج (والمخصص المخطط لكل برنامج يُضاف مستقبلاً عبر ربط البنود بالبرامج).
  const allProgramIds = [...new Set(expenseRows.map((e) => e.programId).filter((x): x is string => !!x))];
  const programLines = allProgramIds.map((pid) => {
    const spent = expenseRows.filter((e) => e.programId === pid).reduce((s, e) => s + Number(e.amount), 0);
    const line = lines.get(pid) ?? { programId: pid, allocated: 0, spent, remaining: -spent, spentPercent: 0, overspent: false };
    return { ...line, spent, programName: progName.get(pid) ?? "برنامج" };
  });

  return { summary, income, expenses: expenseRows, programLines };
}

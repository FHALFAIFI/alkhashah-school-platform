"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetIncome, budgetExpenses, programs, programActivities, people, planYears } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export type ActionState = { error?: string; success?: string } | null;

const incomeSchema = z.object({
  planYearId: z.string().uuid(),
  source: z.string().min(2, "مصدر الإيراد مطلوب"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون موجباً"),
  incomeDate: z.string().optional(),
  purpose: z.string().optional(),
  periodText: z.string().optional(),
  programId: z.string().uuid().optional().or(z.literal("")),
  status: z.enum(["متوقع", "مستلم", "ملغى"]).optional(),
  notes: z.string().optional(),
});

export async function addIncomeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = incomeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [year] = await db.select().from(planYears).where(eq(planYears.id, d.planYearId));
  if (!year) return { error: "السنة غير موجودة" };
  if (d.programId) {
    const [p] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, d.programId));
    if (!p) return { error: "البرنامج المختار غير موجود" };
  }

  const [row] = await db
    .insert(budgetIncome)
    .values({
      planYearId: d.planYearId,
      source: d.source,
      amount: String(d.amount),
      incomeDate: d.incomeDate || null,
      purpose: d.purpose || null,
      periodText: d.periodText || null,
      programId: d.programId || null,
      status: d.status ?? "مستلم",
      notes: d.notes || null,
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "budget.income_added", entityType: "budget_income", entityId: row.id, summary: `إيراد «${d.source}» ${d.amount}` });
  revalidatePath("/budget");
  return { success: "أُضيف الإيراد" };
}

const expenseSchema = z.object({
  planYearId: z.string().uuid(),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون موجباً"),
  expenseDate: z.string().optional(),
  programId: z.string().uuid().optional().or(z.literal("")),
  activityId: z.string().uuid().optional().or(z.literal("")),
  category: z.string().optional(),
  items: z.string().optional(),
  supplier: z.string().optional(),
  paymentReference: z.string().optional(),
  responsiblePersonId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().optional(),
  /** إقرار التجاوز — يُرسل حين ينبّه العميل إلى تجاوز المخصص */
  overspendAck: z.string().optional(),
  overspendAckReason: z.string().optional(),
});

export async function addExpenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [year] = await db.select().from(planYears).where(eq(planYears.id, d.planYearId));
  if (!year) return { error: "السنة غير موجودة" };
  if (d.programId) {
    const [p] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, d.programId));
    if (!p) return { error: "البرنامج المختار غير موجود" };
  }
  if (d.activityId) {
    const [a] = await db.select({ id: programActivities.id, programId: programActivities.programId }).from(programActivities).where(eq(programActivities.id, d.activityId));
    if (!a) return { error: "النشاط المختار غير موجود" };
    if (d.programId && a.programId !== d.programId) return { error: "النشاط لا يتبع البرنامج المختار" };
  }
  if (d.responsiblePersonId) {
    const [person] = await db.select({ id: people.id }).from(people).where(eq(people.id, d.responsiblePersonId));
    if (!person) return { error: "المسؤول المختار غير موجود في سجل المنسوبين" };
  }

  const overspendAck = d.overspendAck === "on";
  const [row] = await db
    .insert(budgetExpenses)
    .values({
      planYearId: d.planYearId,
      amount: String(d.amount),
      expenseDate: d.expenseDate || null,
      programId: d.programId || null,
      activityId: d.activityId || null,
      category: d.category || null,
      items: d.items || null,
      supplier: d.supplier || null,
      paymentReference: d.paymentReference || null,
      responsiblePersonId: d.responsiblePersonId || null,
      notes: d.notes || null,
      overspendAcknowledged: overspendAck,
      overspendAckReason: overspendAck ? d.overspendAckReason || null : null,
      overspendAckBy: overspendAck ? user.id : null,
      overspendAckAt: overspendAck ? new Date() : null,
      createdBy: user.id,
    })
    .returning();
  await audit({
    actorId: user.id,
    action: "budget.expense_added",
    entityType: "budget_expense",
    entityId: row.id,
    summary: `مصروف ${d.amount}${d.category ? ` — ${d.category}` : ""}${overspendAck ? " (تجاوز مُقَر)" : ""}`,
    detail: overspendAck ? { overspend: true, reason: d.overspendAckReason } : undefined,
  });
  revalidatePath("/budget");
  // القيم المالية لا تُغيَّر صامتاً؛ التحذير والإقرار للعرض والتقارير فقط
  return { success: overspendAck ? "سُجّل المصروف مع إقرار التجاوز" : "أُضيف المصروف" };
}

/** إقرار تجاوز مصروف موجود لاحقاً. */
export async function acknowledgeOverspendAction(expenseId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "اذكر سبب الإقرار بالتجاوز" };
  const [e] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  if (!e) return { error: "المصروف غير موجود" };

  await db
    .update(budgetExpenses)
    .set({ overspendAcknowledged: true, overspendAckReason: reason, overspendAckBy: user.id, overspendAckAt: new Date(), updatedAt: new Date() })
    .where(eq(budgetExpenses.id, expenseId));
  await audit({ actorId: user.id, action: "budget.overspend_acknowledged", entityType: "budget_expense", entityId: expenseId, summary: reason });
  revalidatePath("/budget");
  return { success: "أُقرّ التجاوز — القيم المالية كما هي" };
}

export async function deleteIncomeAction(incomeId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetIncome).where(eq(budgetIncome.id, incomeId));
  if (!row) return { error: "الإيراد غير موجود" };
  await db.delete(budgetIncome).where(eq(budgetIncome.id, incomeId));
  await audit({ actorId: user.id, action: "budget.income_deleted", entityType: "budget_income", entityId: incomeId, summary: `حذف إيراد «${row.source}»` });
  revalidatePath("/budget");
  return { success: "حُذف الإيراد" };
}

export async function deleteExpenseAction(expenseId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  if (!row) return { error: "المصروف غير موجود" };
  // الحذف مسموح للمصروف؛ الشواهد المرتبطة تبقى في المكتبة (لا حذف تعاقبي للشواهد)
  await db.delete(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  await audit({ actorId: user.id, action: "budget.expense_deleted", entityType: "budget_expense", entityId: expenseId, summary: `حذف مصروف ${row.amount}` });
  revalidatePath("/budget");
  return { success: "حُذف المصروف" };
}

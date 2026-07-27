"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetIncome, budgetExpenses, planBudgetItems, programs, programActivities, people, planYears, evidenceItems } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { saveUploadedFile, validateUpload } from "@/lib/storage";
import { linkEvidence } from "@/lib/evidence";

/**
 * مبلغ اختياري (قاعدة v2.1 §H): الحقل الفارغ يُخزَّن null، وإن أُدخلت قيمة وجب أن تكون عدداً
 * موجباً صحيح الصيغة. لا تطبيع صامت.
 */
const optionalPositiveAmount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number().positive("المبلغ يجب أن يكون موجباً").optional(),
);

export type ActionState = { error?: string; success?: string } | null;

const incomeSchema = z.object({
  planYearId: z.string().uuid(),
  source: z.string().optional(),
  amount: optionalPositiveAmount,
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
      // مصدر اختياري: يُخزَّن "" عند الفراغ (العمود notNull) — null-safe في العرض عبر orFallback/orDash
      source: d.source ?? "",
      // مبلغ اختياري: null عند الفراغ، لا "0" مضلِّل
      amount: d.amount === undefined ? null : String(d.amount),
      incomeDate: d.incomeDate || null,
      purpose: d.purpose || null,
      periodText: d.periodText || null,
      programId: d.programId || null,
      status: d.status ?? "مستلم",
      notes: d.notes || null,
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "budget.income_added", entityType: "budget_income", entityId: row.id, summary: `إيراد «${d.source ?? ""}» ${d.amount ?? ""}`.trim() });
  revalidatePath("/budget");
  return { success: "أُضيف الإيراد" };
}

const expenseSchema = z.object({
  planYearId: z.string().uuid(),
  amount: optionalPositiveAmount,
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

  // B2: فاتورة اختيارية مرفقة — نتحقق من صحتها قبل الإدراج حتى لا يبقى مصروف نصفه محفوظ عند ملف غير صالح.
  const invoice = formData.get("invoice");
  let invoiceFile: File | null = null;
  if (invoice instanceof File && invoice.size > 0) {
    const invErr = validateUpload(invoice.name, invoice.type || "application/octet-stream", invoice.size);
    if (invErr) return { error: invErr };
    invoiceFile = invoice;
  }

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
      // مبلغ اختياري: null عند الفراغ، لا "0" مضلِّل — null-safe في الحساب والتقارير والتصدير
      amount: d.amount === undefined ? null : String(d.amount),
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
    summary: `مصروف ${d.amount ?? ""}${d.category ? ` — ${d.category}` : ""}${overspendAck ? " (تجاوز مُقَر)" : ""}`.trim(),
    detail: overspendAck ? { overspend: true, reason: d.overspendAckReason } : undefined,
  });

  // B2: احفظ الفاتورة المرفقة (إن وُجدت) عبر خط الشواهد الآمن نفسه (تحقق MIME/امتداد/حجم،
  // اسم UUID من الخادم، حارس المسار، sha256) ثم أنشئ شاهداً واربطه بالمصروف حتى يظهر في لوحة
  // الفاتورة/الشواهد. الإرفاق اختياري: حفظ مصروف بلا فاتورة يعمل.
  if (invoiceFile) {
    try {
      const stored = await saveUploadedFile({
        originalName: invoiceFile.name,
        mime: invoiceFile.type || "application/octet-stream",
        data: Buffer.from(await invoiceFile.arrayBuffer()),
        scope: "attachments",
        uploadedBy: user.id,
      });
      const [ev] = await db
        .insert(evidenceItems)
        .values({
          title: `فاتورة مصروف${d.category ? ` — ${d.category}` : ""}`,
          kind: "file",
          fileId: stored.id,
          description: invoiceFile.name,
          createdBy: user.id,
        })
        .returning();
      await linkEvidence({ evidenceId: ev.id, entityType: "budget_expense", entityId: row.id, linkedBy: user.id });
      await audit({ actorId: user.id, action: "evidence.created", entityType: "evidence", entityId: ev.id, summary: "إرفاق فاتورة بمصروف" });
    } catch (e) {
      // المصروف حُفظ؛ فشل الإرفاق فقط — رسالة عربية واضحة، وتبقى الفاتورة قابلة للإرفاق لاحقاً من اللوحة.
      revalidatePath("/budget");
      return { error: e instanceof Error ? e.message : "تعذر حفظ الفاتورة المرفقة — حُفظ المصروف ويمكن إرفاق الفاتورة لاحقاً من لوحة الفاتورة." };
    }
  }

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
  // الحذف مسموح للمصروف؛ الشواهد المرتبطة تبقى في المكتبة (لا حذف تعاقبي للشواهد).
  // «المنفَق» لكل بند مجموع حيّ من المصروفات، فحذف مصروف يعيد حساب بنده فقط تلقائياً (B4).
  await db.delete(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  await audit({ actorId: user.id, action: "budget.expense_deleted", entityType: "budget_expense", entityId: expenseId, summary: `حذف مصروف ${row.amount ?? ""}`.trim() });
  revalidatePath("/budget");
  return { success: "حُذف المصروف" };
}

/**
 * B4: بند ميزانية له مخصص مستقل (المستلزمات/النشاط). اسم البند مفتاح المطابقة (بنية، لا محتوى حر)
 * فيبقى مطلوباً؛ والمخصص اختياري (بند بلا مخصص يظهر بحالة محايدة). upsert بالاسم داخل السنة يمنع
 * التكرار — تحديث مخصص بند قائم بدل إنشاء ثانٍ بالاسم نفسه.
 */
const budgetItemSchema = z.object({
  planYearId: z.string().uuid(),
  item: z.string().trim().min(1, "اسم البند مطلوب"),
  amount: optionalPositiveAmount,
});

export async function setBudgetItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = budgetItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const [year] = await db.select().from(planYears).where(eq(planYears.id, d.planYearId));
  if (!year) return { error: "السنة غير موجودة" };
  const item = d.item.trim();
  const amount = d.amount === undefined ? null : String(d.amount);
  const [existing] = await db
    .select()
    .from(planBudgetItems)
    .where(and(eq(planBudgetItems.planYearId, d.planYearId), eq(planBudgetItems.item, item)));
  if (existing) {
    await db.update(planBudgetItems).set({ amount }).where(eq(planBudgetItems.id, existing.id));
    await audit({ actorId: user.id, action: "budget.item_updated", entityType: "plan_budget_item", entityId: existing.id, summary: `تحديث مخصص البند «${item}» = ${d.amount ?? "—"}` });
  } else {
    const [row] = await db.insert(planBudgetItems).values({ planYearId: d.planYearId, item, amount }).returning();
    await audit({ actorId: user.id, action: "budget.item_added", entityType: "plan_budget_item", entityId: row.id, summary: `مخصص البند «${item}» = ${d.amount ?? "—"}` });
  }
  revalidatePath("/budget");
  return { success: `حُفظ مخصص البند «${item}»` };
}

export async function deleteBudgetItemAction(itemId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(planBudgetItems).where(eq(planBudgetItems.id, itemId));
  if (!row) return { error: "البند غير موجود" };
  // حذف مخصص البند فقط — المصروفات المختارة له تبقى، ويظهر البند بحالة محايدة (بلا مخصص) لا حذف بيانات.
  await db.delete(planBudgetItems).where(eq(planBudgetItems.id, itemId));
  await audit({ actorId: user.id, action: "budget.item_deleted", entityType: "plan_budget_item", entityId: itemId, summary: `حذف مخصص البند «${row.item}»` });
  revalidatePath("/budget");
  return { success: "حُذف مخصص البند" };
}

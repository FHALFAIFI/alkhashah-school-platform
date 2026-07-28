"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetExpenses, budgetIncome, financialItems } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";

/**
 * إدارة بنود الصرف المدرسية والعمليات المالية (v2.2 §B).
 *
 * كل الحقول التي يُدخلها المستخدم اختيارية (القاعدة العامة §8): الاسم والمبلغ والملاحظات
 * قد تكون فارغة. ما يبقى إلزامياً هو حقول السلامة والتكامل فقط: الهوية والملكية وبيانات
 * التدقيق. وحين تُدخَل قيمة يُتحقق من صيغتها.
 */

export type ActionState = { error?: string; success?: string } | null;

/**
 * ألوان العرض المسموحة — قائمة مغلقة (allowlist) لا نص CSS حر من المستخدم.
 * تمنع حقن CSS وتحافظ على اتساق الواجهة.
 */
export const ITEM_COLORS = ["أزرق", "أخضر", "كهرماني", "أحمر", "بنفسجي", "رمادي"] as const;
export type ItemColor = (typeof ITEM_COLORS)[number];

/** مبلغ اختياري: الفارغ يبقى null، والمُدخَل يجب أن يكون عدداً صحيح الصيغة غير سالب */
const optionalAmount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number({ message: "المبلغ غير صحيح" }).nonnegative("المبلغ لا يكون سالباً").optional(),
);

const itemSchema = z.object({
  nameAr: z.string().trim().max(120, "اسم البند طويل جداً").optional(),
  allocatedAmount: optionalAmount,
  color: z.enum(ITEM_COLORS).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional(),
});

/** إنشاء بند صرف مدرسي جديد */
export async function createFinancialItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // الترتيب حقل داخلي: البند الجديد يذهب إلى آخر القائمة
  const [maxRow] = await db.select({ maxOrder: sql<number | null>`max(${financialItems.sortOrder})` }).from(financialItems);
  const [row] = await db
    .insert(financialItems)
    .values({
      nameAr: d.nameAr || null,
      allocatedAmount: d.allocatedAmount === undefined ? null : String(d.allocatedAmount),
      color: d.color || null,
      notes: d.notes || null,
      sortOrder: (maxRow?.maxOrder ?? 0) + 1,
      createdBy: user.id,
    })
    .returning();

  await audit({
    actorId: user.id,
    action: "finance.item_created",
    entityType: "financial_item",
    entityId: row.id,
    summary: `إنشاء بند «${orFallback(d.nameAr, "بند بدون اسم")}»`,
  });
  revalidatePath("/budget");
  return { success: "أُنشئ البند" };
}

/** تعديل اسم البند أو مخصصه أو لونه */
export async function updateFinancialItemAction(itemId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [existing] = await db.select().from(financialItems).where(eq(financialItems.id, itemId));
  if (!existing) return { error: "البند غير موجود" };

  await db
    .update(financialItems)
    .set({
      nameAr: d.nameAr || null,
      allocatedAmount: d.allocatedAmount === undefined ? null : String(d.allocatedAmount),
      color: d.color || null,
      notes: d.notes || null,
      updatedAt: new Date(),
    })
    .where(eq(financialItems.id, itemId));

  await audit({
    actorId: user.id,
    action: "finance.item_updated",
    entityType: "financial_item",
    entityId: itemId,
    summary: `تعديل بند «${orFallback(d.nameAr, "بند بدون اسم")}» — المخصص ${d.allocatedAmount ?? "—"}`,
  });
  revalidatePath("/budget");
  return { success: "حُفظ البند" };
}

/**
 * أرشفة بند (تعطيل) — إخفاء غير مدمّر: العمليات المرتبطة تبقى كما هي ولا يُحذف أي رابط،
 * ويظل البند ظاهراً في التقارير التاريخية. idempotent.
 */
export async function archiveFinancialItemAction(itemId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [item] = await db.select().from(financialItems).where(eq(financialItems.id, itemId));
  if (!item) return { error: "البند غير موجود" };
  if (item.archivedAt) return { success: "البند مؤرشف مسبقاً" };

  await db
    .update(financialItems)
    .set({ archivedAt: new Date(), archivedBy: user.id, updatedAt: new Date() })
    .where(and(eq(financialItems.id, itemId), isNull(financialItems.archivedAt)));
  await audit({
    actorId: user.id,
    action: "finance.item_archived",
    entityType: "financial_item",
    entityId: itemId,
    summary: `أرشفة بند «${orFallback(item.nameAr, "بند بدون اسم")}»`,
  });
  revalidatePath("/budget");
  return { success: "أُرشف البند — عملياته محفوظة" };
}

/** استعادة بند مؤرشف */
export async function restoreFinancialItemAction(itemId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [item] = await db.select().from(financialItems).where(eq(financialItems.id, itemId));
  if (!item) return { error: "البند غير موجود" };
  if (!item.archivedAt) return { success: "البند غير مؤرشف" };

  await db
    .update(financialItems)
    .set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
    .where(eq(financialItems.id, itemId));
  await audit({
    actorId: user.id,
    action: "finance.item_restored",
    entityType: "financial_item",
    entityId: itemId,
    summary: `استعادة بند «${orFallback(item.nameAr, "بند بدون اسم")}»`,
  });
  revalidatePath("/budget");
  return { success: "استُعيد البند" };
}

/** تحريك بند لأعلى/أسفل في ترتيب العرض — تبديل ترتيب مع الجار المباشر */
export async function reorderFinancialItemAction(itemId: string, direction: "up" | "down"): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const all = await db.select().from(financialItems).orderBy(financialItems.sortOrder, financialItems.createdAt);
  const index = all.findIndex((i) => i.id === itemId);
  if (index === -1) return { error: "البند غير موجود" };
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= all.length) return { success: "البند في موضعه" };

  const a = all[index];
  const b = all[swapWith];
  // التبديل داخل معاملة واحدة حتى لا يبقى ترتيبان متساويان عند تزامن الطلبات
  await db.transaction(async (tx) => {
    await tx.update(financialItems).set({ sortOrder: b.sortOrder, updatedAt: new Date() }).where(eq(financialItems.id, a.id));
    await tx.update(financialItems).set({ sortOrder: a.sortOrder, updatedAt: new Date() }).where(eq(financialItems.id, b.id));
  });
  await audit({
    actorId: user.id,
    action: "finance.item_reordered",
    entityType: "financial_item",
    entityId: itemId,
    summary: `تغيير ترتيب بند «${orFallback(a.nameAr, "بند بدون اسم")}»`,
  });
  revalidatePath("/budget");
  return { success: "حُدّث الترتيب" };
}

/**
 * إنشاء البندين الأساسيين «المستلزمات» و«النشاط» — تدفّق إداري مُتحكَّم به يُشغّله المستخدم
 * صراحةً مرة واحدة (v2.2 §B2). **ليس بذرة (seed)**: لا يُشغَّل تلقائياً ولا عند الترحيل ولا
 * عند الإقلاع، ولا يُنشئ أي سجل صامتاً.
 *
 * idempotent تماماً: البند الموجود بالاسم نفسه لا يُكرَّر ولا يُعدَّل مخصصه.
 */
export async function createDefaultFinancialItemsAction(): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const names = ["المستلزمات", "النشاط"];

  const existing = await db.select().from(financialItems);
  const existingNames = new Set(existing.map((i) => (i.nameAr ?? "").trim()));
  const missing = names.filter((n) => !existingNames.has(n));
  if (missing.length === 0) return { success: "البنود الأساسية موجودة مسبقاً" };

  let order = existing.reduce((max, i) => Math.max(max, i.sortOrder), 0);
  for (const name of missing) {
    order += 1;
    const [row] = await db
      .insert(financialItems)
      // المخصص يُترك فارغاً عمداً: لا يُخترع رقم مالي، والمدير يُدخله بنفسه
      .values({ nameAr: name, sortOrder: order, createdBy: user.id })
      .returning();
    await audit({
      actorId: user.id,
      action: "finance.item_created",
      entityType: "financial_item",
      entityId: row.id,
      summary: `إنشاء البند الأساسي «${name}» (تدفّق إداري صريح)`,
    });
  }
  revalidatePath("/budget");
  return { success: `أُنشئ ${missing.length} من البنود الأساسية` };
}

/* ─────────────────────── أرشفة العمليات المالية (§B3/§B4) ─────────────────────── */

/**
 * أرشفة إيراد أو مصروف — بديل غير مدمّر للحذف: السجل يبقى وتخرج قيمته من المجاميع
 * الجارية وتبقى في تقارير الأرشيف. الفاتورة المرفقة لا تُمسّ. idempotent.
 */
export async function archiveIncomeAction(incomeId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetIncome).where(eq(budgetIncome.id, incomeId));
  if (!row) return { error: "الإيراد غير موجود" };
  if (row.archivedAt) return { success: "الإيراد مؤرشف مسبقاً" };
  await db
    .update(budgetIncome)
    .set({ archivedAt: new Date(), archivedBy: user.id, updatedAt: new Date() })
    .where(and(eq(budgetIncome.id, incomeId), isNull(budgetIncome.archivedAt)));
  await audit({ actorId: user.id, action: "finance.income_archived", entityType: "budget_income", entityId: incomeId, summary: "أرشفة إيراد" });
  revalidatePath("/budget");
  return { success: "أُرشف الإيراد" };
}

export async function restoreIncomeAction(incomeId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetIncome).where(eq(budgetIncome.id, incomeId));
  if (!row) return { error: "الإيراد غير موجود" };
  if (!row.archivedAt) return { success: "الإيراد غير مؤرشف" };
  await db.update(budgetIncome).set({ archivedAt: null, archivedBy: null, updatedAt: new Date() }).where(eq(budgetIncome.id, incomeId));
  await audit({ actorId: user.id, action: "finance.income_restored", entityType: "budget_income", entityId: incomeId, summary: "استعادة إيراد" });
  revalidatePath("/budget");
  return { success: "استُعيد الإيراد" };
}

export async function archiveExpenseAction(expenseId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  if (!row) return { error: "المصروف غير موجود" };
  if (row.archivedAt) return { success: "المصروف مؤرشف مسبقاً" };
  await db
    .update(budgetExpenses)
    .set({ archivedAt: new Date(), archivedBy: user.id, updatedAt: new Date() })
    .where(and(eq(budgetExpenses.id, expenseId), isNull(budgetExpenses.archivedAt)));
  await audit({ actorId: user.id, action: "finance.expense_archived", entityType: "budget_expense", entityId: expenseId, summary: "أرشفة مصروف" });
  revalidatePath("/budget");
  return { success: "أُرشف المصروف — أُعيد حساب بنده" };
}

export async function restoreExpenseAction(expenseId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  if (!row) return { error: "المصروف غير موجود" };
  if (!row.archivedAt) return { success: "المصروف غير مؤرشف" };
  await db.update(budgetExpenses).set({ archivedAt: null, archivedBy: null, updatedAt: new Date() }).where(eq(budgetExpenses.id, expenseId));
  await audit({ actorId: user.id, action: "finance.expense_restored", entityType: "budget_expense", entityId: expenseId, summary: "استعادة مصروف" });
  revalidatePath("/budget");
  return { success: "استُعيد المصروف" };
}

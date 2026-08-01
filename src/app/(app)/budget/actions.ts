"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetIncome, budgetExpenses, planBudgetItems, programs, programActivities, people, planYears, evidenceItems, financialItems } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { saveUploadedFile, validateUpload } from "@/lib/storage";
import { linkEvidence } from "@/lib/evidence";
import { userFacingError } from "@/lib/user-error";
import { optionalIsoDate } from "@/lib/dates-zod";
import { snapshotRecord } from "@/lib/versioning";

/**
 * مبلغ اختياري (قاعدة v2.1 §H): الحقل الفارغ يُخزَّن null، وإن أُدخلت قيمة وجب أن تكون عدداً
 * موجباً صحيح الصيغة. لا تطبيع صامت.
 */
const optionalPositiveAmount = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number().positive("المبلغ يجب أن يكون موجباً").optional(),
);

export type ActionState = { error?: string; success?: string } | null;

/**
 * التحقق من فاتورة/إيصال مرفق قبل أي إدراج — حتى لا يبقى سجل نصفه محفوظ عند ملف غير صالح.
 * الإرفاق اختياري: غياب الملف ليس خطأ.
 */
function pickInvoiceFile(formData: FormData): { file: File | null; error?: string } {
  const invoice = formData.get("invoice");
  if (!(invoice instanceof File) || invoice.size === 0) return { file: null };
  const err = validateUpload(invoice.name, invoice.type || "application/octet-stream", invoice.size);
  if (err) return { file: null, error: err };
  return { file: invoice };
}

/**
 * حفظ الفاتورة المرفقة وربطها بالسجل المالي عبر خط الشواهد الآمن الموحّد:
 * تحقق MIME/امتداد/حجم، اسم مخزَّن عشوائي من الخادم، حارس المسار، بصمة sha256.
 *
 * مشترك بين الإيراد والمصروف فلا يتكرّر منطق الرفع في مسارين (مصدر واحد للحقيقة).
 */
async function attachInvoice(opts: {
  file: File;
  entityType: "budget_income" | "budget_expense";
  entityId: string;
  title: string;
  userId: string;
}): Promise<void> {
  const stored = await saveUploadedFile({
    originalName: opts.file.name,
    mime: opts.file.type || "application/octet-stream",
    data: Buffer.from(await opts.file.arrayBuffer()),
    scope: "attachments",
    uploadedBy: opts.userId,
  });
  const [ev] = await db
    .insert(evidenceItems)
    .values({
      title: opts.title,
      kind: "file",
      fileId: stored.id,
      description: opts.file.name,
      createdBy: opts.userId,
    })
    .returning();
  await linkEvidence({ evidenceId: ev.id, entityType: opts.entityType, entityId: opts.entityId, linkedBy: opts.userId });
  await audit({ actorId: opts.userId, action: "evidence.created", entityType: "evidence", entityId: ev.id, summary: opts.title });
}

/**
 * الإيراد على مستوى المدرسة (v2.2 §B3): لا يشترط برنامجاً ولا تصنيفاً ولا مجالاً ولا فئة.
 * `financialItemId` بند صرف مدرسي اختياري. `programId` لم يعد يُرسَل من النماذج الجديدة
 * ويبقى مقبولاً هنا للتوافق مع السجلات والاختبارات التاريخية فقط.
 */
const incomeSchema = z.object({
  planYearId: z.string().uuid(),
  source: z.string().optional(),
  amount: optionalPositiveAmount,
  incomeDate: optionalIsoDate,
  purpose: z.string().optional(),
  periodText: z.string().optional(),
  programId: z.string().uuid().optional().or(z.literal("")),
  financialItemId: z.string().uuid("البند المالي المختار غير صالح").optional().or(z.literal("")),
  status: z.enum(["متوقع", "مستلم", "ملغى"]).optional(),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
});

export async function addIncomeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = incomeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const invoice = pickInvoiceFile(formData);
  if (invoice.error) return { error: invoice.error };

  const [year] = await db.select().from(planYears).where(eq(planYears.id, d.planYearId));
  if (!year) return { error: "السنة غير موجودة" };
  if (d.programId) {
    const [p] = await db.select({ id: programs.id }).from(programs).where(eq(programs.id, d.programId));
    if (!p) return { error: "البرنامج المختار غير موجود" };
  }
  // البند المختار يجب أن يكون موجوداً — حارس تكامل لا شرط عمل (البند نفسه اختياري)
  if (d.financialItemId) {
    const [fi] = await db.select({ id: financialItems.id }).from(financialItems).where(eq(financialItems.id, d.financialItemId));
    if (!fi) return { error: "البند المالي المختار غير موجود" };
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
      financialItemId: d.financialItemId || null,
      status: d.status ?? "مستلم",
      paymentReference: d.paymentReference || null,
      notes: d.notes || null,
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "budget.income_added", entityType: "budget_income", entityId: row.id, summary: `إيراد «${d.source ?? ""}» ${d.amount ?? ""}`.trim() });

  if (invoice.file) {
    try {
      await attachInvoice({
        file: invoice.file,
        entityType: "budget_income",
        entityId: row.id,
        title: `إيصال إيراد${d.source ? ` — ${d.source}` : ""}`,
        userId: user.id,
      });
    } catch (e) {
      // الإيراد حُفظ؛ فشل الإرفاق وحده — يبقى الإيصال قابلاً للإرفاق لاحقاً من لوحة الشواهد.
      revalidatePath("/budget");
      return { error: userFacingError(e, "تعذر حفظ الإيصال المرفق — حُفظ الإيراد ويمكن إرفاق الإيصال لاحقاً.") };
    }
  }

  revalidatePath("/budget");
  return { success: "أُضيف الإيراد" };
}

/**
 * المصروف على مستوى المدرسة (v2.2 §B4): لا يشترط برنامجاً ولا تصنيفاً. البند المالي
 * (`financialItemId`) اختياري وهو المصدر المعتمد لنسبة المصروف إلى بند.
 *
 * لا يوجد «إقرار تجاوز» (§B7): التجاوز يُظهر تحذيراً بمقداره ولا يمنع الحفظ ولا يطلب
 * مربع اختيار ولا سبباً.
 */
const expenseSchema = z.object({
  planYearId: z.string().uuid(),
  amount: optionalPositiveAmount,
  expenseDate: optionalIsoDate,
  programId: z.string().uuid().optional().or(z.literal("")),
  activityId: z.string().uuid().optional().or(z.literal("")),
  financialItemId: z.string().uuid("البند المالي المختار غير صالح").optional().or(z.literal("")),
  category: z.string().optional(),
  items: z.string().optional(),
  supplier: z.string().optional(),
  paymentReference: z.string().optional(),
  responsiblePersonId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().optional(),
});

export async function addExpenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = expenseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // فاتورة اختيارية مرفقة — يُتحقق منها قبل الإدراج حتى لا يبقى مصروف نصفه محفوظ عند ملف غير صالح.
  const invoice = pickInvoiceFile(formData);
  if (invoice.error) return { error: invoice.error };

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

  if (d.financialItemId) {
    const [fi] = await db.select({ id: financialItems.id }).from(financialItems).where(eq(financialItems.id, d.financialItemId));
    if (!fi) return { error: "البند المالي المختار غير موجود" };
  }

  const [row] = await db
    .insert(budgetExpenses)
    .values({
      planYearId: d.planYearId,
      // مبلغ اختياري: null عند الفراغ، لا "0" مضلِّل — null-safe في الحساب والتقارير والتصدير
      amount: d.amount === undefined ? null : String(d.amount),
      expenseDate: d.expenseDate || null,
      programId: d.programId || null,
      activityId: d.activityId || null,
      financialItemId: d.financialItemId || null,
      category: d.category || null,
      items: d.items || null,
      supplier: d.supplier || null,
      paymentReference: d.paymentReference || null,
      responsiblePersonId: d.responsiblePersonId || null,
      notes: d.notes || null,
      // «إقرار التجاوز» أُلغي (§B7) — لا تُكتب أعمدته بعد الآن، وتبقى للسجلات التاريخية.
      createdBy: user.id,
    })
    .returning();
  await audit({
    actorId: user.id,
    action: "budget.expense_added",
    entityType: "budget_expense",
    entityId: row.id,
    summary: `مصروف ${d.amount ?? ""}${d.category ? ` — ${d.category}` : ""}`.trim(),
  });

  // الفاتورة المرفقة (إن وُجدت) تمرّ بخط الشواهد الآمن الموحّد نفسه. الإرفاق اختياري:
  // حفظ مصروف بلا فاتورة يعمل.
  if (invoice.file) {
    try {
      await attachInvoice({
        file: invoice.file,
        entityType: "budget_expense",
        entityId: row.id,
        title: `فاتورة مصروف${d.category ? ` — ${d.category}` : ""}`,
        userId: user.id,
      });
    } catch (e) {
      // المصروف حُفظ؛ فشل الإرفاق فقط — رسالة عربية واضحة، وتبقى الفاتورة قابلة للإرفاق لاحقاً من اللوحة.
      revalidatePath("/budget");
      return { error: userFacingError(e, "تعذر حفظ الفاتورة المرفقة — حُفظ المصروف ويمكن إرفاق الفاتورة لاحقاً من لوحة الفاتورة.") };
    }
  }

  revalidatePath("/budget");
  // القيم المالية لا تُغيَّر صامتاً. تجاوز المخصص لا يمنع الحفظ ولا يتطلب إقراراً (§B7).
  return { success: "أُضيف المصروف" };
}

/** قيم العرض للمقارنة قبل/بعد — مفاتيح عربية تُعرض في سجل التدقيق كما هي */
function incomeAuditView(r: typeof budgetIncome.$inferSelect): Record<string, string> {
  return {
    "المصدر": r.source || "—",
    "المبلغ": r.amount ?? "—",
    "التاريخ": r.incomeDate ?? "—",
    "الغرض": r.purpose ?? "—",
    "رقم الفاتورة": r.paymentReference ?? "—",
    "الملاحظات": r.notes ?? "—",
  };
}

function expenseAuditView(r: typeof budgetExpenses.$inferSelect): Record<string, string> {
  return {
    "المبلغ": r.amount ?? "—",
    "التاريخ": r.expenseDate ?? "—",
    "المورّد": r.supplier ?? "—",
    "رقم الفاتورة": r.paymentReference ?? "—",
    "الوصف": r.category ?? "—",
    "الملاحظات": r.notes ?? "—",
  };
}

const incomeUpdateSchema = z.object({
  incomeId: z.string().uuid(),
  source: z.string().optional(),
  amount: optionalPositiveAmount,
  incomeDate: optionalIsoDate,
  purpose: z.string().optional(),
  financialItemId: z.string().uuid("البند المالي المختار غير صالح").optional().or(z.literal("")),
  status: z.enum(["متوقع", "مستلم", "ملغى"]).optional(),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * تعديل إيراد (v2.3 §6): قبل التعديل تُحفظ نسخة كاملة في `record_versions`،
 * ويسجَّل «قبل/بعد» في التدقيق، ويُثبَّت `updatedBy`. «المنفَق/الإيراد» لكل بند
 * مجموع حيّ فتعديل العملية يعيد حساب البند المتأثر وحده تلقائياً.
 */
export async function updateIncomeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = incomeUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [before] = await db.select().from(budgetIncome).where(eq(budgetIncome.id, d.incomeId));
  if (!before) return { error: "الإيراد غير موجود" };
  if (before.archivedAt) return { error: "الإيراد مؤرشف — استعده أولاً ثم عدّله" };
  if (d.financialItemId) {
    const [fi] = await db.select({ id: financialItems.id }).from(financialItems).where(eq(financialItems.id, d.financialItemId));
    if (!fi) return { error: "البند المالي المختار غير موجود" };
  }

  await snapshotRecord({
    entityType: "budget_income",
    entityId: before.id,
    action: "updated",
    snapshot: before,
    actorId: user.id,
  });

  const [after] = await db
    .update(budgetIncome)
    .set({
      source: d.source ?? "",
      amount: d.amount === undefined ? null : String(d.amount),
      incomeDate: d.incomeDate || null,
      purpose: d.purpose || null,
      financialItemId: d.financialItemId || null,
      status: d.status ?? before.status,
      paymentReference: d.paymentReference || null,
      notes: d.notes || null,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(budgetIncome.id, d.incomeId))
    .returning();

  await audit({
    actorId: user.id,
    action: "budget.income_updated",
    entityType: "budget_income",
    entityId: before.id,
    summary: `تعديل إيراد «${after.source || "بدون مصدر"}»`,
    detail: {
      before: { status: before.status, mapped: incomeAuditView(before) },
      after: { status: after.status, mapped: incomeAuditView(after) },
    },
  });
  revalidatePath("/budget");
  return { success: "عُدّل الإيراد" };
}

const expenseUpdateSchema = z.object({
  expenseId: z.string().uuid(),
  amount: optionalPositiveAmount,
  expenseDate: optionalIsoDate,
  financialItemId: z.string().uuid("البند المالي المختار غير صالح").optional().or(z.literal("")),
  category: z.string().optional(),
  supplier: z.string().optional(),
  paymentReference: z.string().optional(),
  notes: z.string().optional(),
});

/** تعديل مصروف (v2.3 §6) — نفس ضمانات تعديل الإيراد: نسخة كاملة + قبل/بعد + updatedBy */
export async function updateExpenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const parsed = expenseUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const [before] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, d.expenseId));
  if (!before) return { error: "المصروف غير موجود" };
  if (before.archivedAt) return { error: "المصروف مؤرشف — استعده أولاً ثم عدّله" };
  if (d.financialItemId) {
    const [fi] = await db.select({ id: financialItems.id }).from(financialItems).where(eq(financialItems.id, d.financialItemId));
    if (!fi) return { error: "البند المالي المختار غير موجود" };
  }

  await snapshotRecord({
    entityType: "budget_expense",
    entityId: before.id,
    action: "updated",
    snapshot: before,
    actorId: user.id,
  });

  const [after] = await db
    .update(budgetExpenses)
    .set({
      amount: d.amount === undefined ? null : String(d.amount),
      expenseDate: d.expenseDate || null,
      financialItemId: d.financialItemId || null,
      category: d.category || null,
      supplier: d.supplier || null,
      paymentReference: d.paymentReference || null,
      notes: d.notes || null,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(budgetExpenses.id, d.expenseId))
    .returning();

  await audit({
    actorId: user.id,
    action: "budget.expense_updated",
    entityType: "budget_expense",
    entityId: before.id,
    summary: `تعديل مصروف ${after.amount ?? ""}`.trim(),
    detail: {
      before: { status: "مصروف", mapped: expenseAuditView(before) },
      after: { status: "مصروف", mapped: expenseAuditView(after) },
    },
  });
  revalidatePath("/budget");
  return { success: "عُدّل المصروف" };
}

export async function deleteIncomeAction(incomeId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetIncome).where(eq(budgetIncome.id, incomeId));
  if (!row) return { error: "الإيراد غير موجود" };
  // v2.4: لقطة كاملة قبل الحذف النهائي — الحذف يزيل الصف فعلاً ولقطة النسخ هي أثره الوحيد
  await snapshotRecord({
    entityType: "budget_income",
    entityId: incomeId,
    action: "updated",
    snapshot: row,
    reason: "لقطة قبل الحذف النهائي",
    actorId: user.id,
  });
  await db.delete(budgetIncome).where(eq(budgetIncome.id, incomeId));
  await audit({
    actorId: user.id,
    action: "budget.income_deleted",
    entityType: "budget_income",
    entityId: incomeId,
    summary: `حذف إيراد «${row.source}»`,
    detail: { before: { status: row.status, mapped: incomeAuditView(row) } },
  });
  revalidatePath("/budget");
  return { success: "حُذف الإيراد" };
}

export async function deleteExpenseAction(expenseId: string): Promise<ActionState> {
  const user = await requirePermission("budget.write");
  const [row] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  if (!row) return { error: "المصروف غير موجود" };
  // الحذف مسموح للمصروف؛ الشواهد المرتبطة تبقى في المكتبة (لا حذف تعاقبي للشواهد).
  // «المنفَق» لكل بند مجموع حيّ من المصروفات، فحذف مصروف يعيد حساب بنده فقط تلقائياً (B4).
  // v2.4: لقطة كاملة قبل الحذف النهائي
  await snapshotRecord({
    entityType: "budget_expense",
    entityId: expenseId,
    action: "updated",
    snapshot: row,
    reason: "لقطة قبل الحذف النهائي",
    actorId: user.id,
  });
  await db.delete(budgetExpenses).where(eq(budgetExpenses.id, expenseId));
  await audit({
    actorId: user.id,
    action: "budget.expense_deleted",
    entityType: "budget_expense",
    entityId: expenseId,
    summary: `حذف مصروف ${row.amount ?? ""}`.trim(),
    detail: { before: { status: "مصروف", mapped: expenseAuditView(row) } },
  });
  revalidatePath("/budget");
  return { success: "حُذف المصروف" };
}

/*
 * أُزيلت هنا إجراءات `plan_budget_items` (setBudgetItemAction / deleteBudgetItemAction).
 *
 * السبب (v2.2 §B2): بنود الصرف صارت سجلات مدرسية في `financial_items` تُدار من
 * `./finance-actions`. لم يبقَ لهذين الإجراءين أي مستدعٍ: لا واجهة ولا اختبار ولا استيراد
 * ديناميكي — وإبقاء إجراء خادم غير مستعمل يوسّع سطح الهجوم بلا فائدة.
 *
 * جدول `plan_budget_items` نفسه **باقٍ ولم يُمسّ**: يكتبه مستورد الخطة التشغيلية الرسمي
 * (`src/lib/imports/plan.ts`) وفيه صفوف إنتاجية حقيقية، ويقرؤه العرض التاريخي في
 * `src/lib/budget/service.ts` وسجلّا التنظيف والكيانات.
 */

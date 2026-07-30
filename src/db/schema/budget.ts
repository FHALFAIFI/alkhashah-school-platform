import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { planYears, programs, programActivities } from "./plan";
import { people } from "./school";

/**
 * وحدة الميزانية (§8) — متتبّع ميزانية وشواهد للمدرسة، لا نظام محاسبي كامل.
 *
 * الشواهد والإيصالات تستعمل سجل الشواهد الموحّد (`evidence_items` + `evidence_links`
 * بنوع `budget_income` / `budget_expense`) — لا مخزن رفع ثانٍ، والإيصال الواحد قد يظهر في
 * الميزانية والخطة معاً دون رفع مكرر.
 */

/**
 * بنود الصرف على مستوى المدرسة (v2.2 §B2) — «مجالات الدفع» التي تُدار مركزياً.
 *
 * تحلّ محل الارتباط التشغيلي بالبرنامج/التصنيف: الإيراد والمصروف يختاران بنداً مالياً
 * اختيارياً بدل برنامج. البنود سجلات مدرسية دائمة لا سنوية (بخلاف `plan_budget_items`
 * المرتبطة بسنة تخطيطية والمُبقاة كما هي للمرجع التاريخي).
 *
 * الاسم اختياري كبقية حقول المستخدم (القاعدة العامة §8) — لم يعد مفتاح مطابقة بعد اعتماد
 * المفتاح الأجنبي، والعرض يستعمل بديلاً عربياً. الأرشفة إخفاء غير مدمّر قابل للاستعادة.
 */
export const financialItems = pgTable(
  "financial_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nameAr: text("name_ar"),
    /** المخصص لهذا البند — اختياري؛ البند بلا مخصص يُعرض «—» لا صفر مضلِّل */
    allocatedAmount: numeric("allocated_amount"),
    /** لون العرض — من قائمة مسموحة مغلقة فقط (لا CSS حر من المستخدم) */
    color: text("color"),
    notes: text("notes"),
    /** ترتيب العرض — حقل داخلي لا يُدخله المستخدم كنص */
    sortOrder: integer("sort_order").notNull().default(0),
    /** الأرشفة/التعطيل — إخفاء غير مدمّر: العمليات المرتبطة تبقى وتُحسب تاريخياً */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("financial_items_order_idx").on(t.sortOrder)],
);

/** الإيرادات والتمويل */
export const budgetIncome = pgTable(
  "budget_income",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    source: text("source").notNull(),
    incomeDate: text("income_date"),
    // اختياري (قاعدة v2.1: كل الحقول المُدخلة من المستخدم اختيارية) — الحساب null-safe،
    // ويُعرض «—» بدل صفر مضلِّل عند غياب القيمة.
    amount: numeric("amount"),
    /** الغرض/التخصيص */
    purpose: text("purpose"),
    periodText: text("period_text"),
    /**
     * ربط تاريخي ببرنامج أو نشاط (ما قبل v2.2) — يبقى محفوظاً للمرجع التاريخي ولا يُمسح،
     * ولم يعد يُطلب ولا يُعرض في نماذج التسجيل الجديدة (المالية صارت على مستوى المدرسة §B1).
     */
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    activityId: uuid("activity_id").references(() => programActivities.id, { onDelete: "set null" }),
    /** بند الصرف المدرسي الاختياري (v2.2 §B3) — بديل ارتباط البرنامج/التصنيف */
    financialItemId: uuid("financial_item_id").references(() => financialItems.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** متوقع | مستلم | ملغى */
    status: text("status").notNull().default("مستلم"),
    /** رقم الفاتورة/السند الاختياري للإيراد (v2.3 §6 — تناظراً مع المصروف) */
    paymentReference: text("payment_reference"),
    /** الأرشفة — إخفاء غير مدمّر: السجل يبقى ويُستثنى من المجاميع الجارية */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    /** آخر من عدّل السجل (v2.3 §6 — سجل التعديل) */
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("budget_income_year_idx").on(t.planYearId),
    index("budget_income_program_idx").on(t.programId),
    index("budget_income_item_idx").on(t.financialItemId),
  ],
);

/** المصروفات */
export const budgetExpenses = pgTable(
  "budget_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    expenseDate: text("expense_date"),
    /**
     * ربط تاريخي ببرنامج أو نشاط (ما قبل v2.2) — محفوظ للمرجع التاريخي ولا يُمسح،
     * ولم يعد يُطلب ولا يُعرض في نماذج التسجيل الجديدة (§B1).
     */
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    activityId: uuid("activity_id").references(() => programActivities.id, { onDelete: "set null" }),
    category: text("category"),
    /**
     * اسم «البند» النصي القديم (v2.1 §B4) — مفتاح المطابقة السابق. يبقى محفوظاً حرفياً
     * للسجلات التاريخية؛ الحساب الجديد يعتمد `financialItemId` وحده فلا احتساب مزدوج.
     */
    items: text("items"),
    /** بند الصرف المدرسي الاختياري (v2.2 §B4) — المصدر المعتمد لنسبة المصروف للبند */
    financialItemId: uuid("financial_item_id").references(() => financialItems.id, { onDelete: "set null" }),
    supplier: text("supplier"),
    // اختياري (قاعدة v2.1) — null-safe في الحساب والتقارير والتصدير.
    amount: numeric("amount"),
    /** رقم الفاتورة الاختياري (كان «مرجع الدفع») — العمود يبقى payment_reference للتوافق */
    paymentReference: text("payment_reference"),
    /** المسؤول الاختياري من سجل المنسوبين */
    responsiblePersonId: uuid("responsible_person_id").references(() => people.id, { onDelete: "set null" }),
    notes: text("notes"),
    /**
     * «إقرار التجاوز» — مفهوم مُلغى في v2.2 §B7. تسجيل المصروف المتجاوز لم يعد يتطلب أي
     * إقرار أو مربع اختيار: يظهر تحذير عربي بمقدار التجاوز فقط ولا يُمنع الحفظ.
     *
     * الأعمدة **مُبقاة للسجلات التاريخية** التي أُقرّت قبل v2.2 ولا تُحذف ولا تُكتب بعد الآن.
     */
    overspendAcknowledged: boolean("overspend_acknowledged").notNull().default(false),
    overspendAckReason: text("overspend_ack_reason"),
    overspendAckBy: uuid("overspend_ack_by").references(() => users.id),
    overspendAckAt: timestamp("overspend_ack_at", { withTimezone: true }),
    /** الأرشفة — إخفاء غير مدمّر: السجل يبقى ويُستثنى من المجاميع الجارية */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    /** آخر من عدّل السجل (v2.3 §6 — سجل التعديل) */
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("budget_expenses_year_idx").on(t.planYearId),
    index("budget_expenses_program_idx").on(t.programId),
    index("budget_expenses_item_idx").on(t.financialItemId),
    index("budget_expenses_date_idx").on(t.expenseDate),
  ],
);

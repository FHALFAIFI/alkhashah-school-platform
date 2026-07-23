import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
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

/** الإيرادات والتمويل */
export const budgetIncome = pgTable(
  "budget_income",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    source: text("source").notNull(),
    incomeDate: text("income_date"),
    amount: numeric("amount").notNull(),
    /** الغرض/التخصيص */
    purpose: text("purpose"),
    periodText: text("period_text"),
    /** ربط اختياري ببرنامج أو نشاط */
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    activityId: uuid("activity_id").references(() => programActivities.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** متوقع | مستلم | ملغى */
    status: text("status").notNull().default("مستلم"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("budget_income_year_idx").on(t.planYearId), index("budget_income_program_idx").on(t.programId)],
);

/** المصروفات */
export const budgetExpenses = pgTable(
  "budget_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    expenseDate: text("expense_date"),
    /** ربط اختياري ببرنامج أو نشاط — المصروف غير المرتبط يظهر في «مصروفات غير مرتبطة» */
    programId: uuid("program_id").references(() => programs.id, { onDelete: "set null" }),
    activityId: uuid("activity_id").references(() => programActivities.id, { onDelete: "set null" }),
    category: text("category"),
    /** المستلزمات/البنود */
    items: text("items"),
    supplier: text("supplier"),
    amount: numeric("amount").notNull(),
    /** مرجع الدفع الاختياري */
    paymentReference: text("payment_reference"),
    /** المسؤول الاختياري من سجل المنسوبين */
    responsiblePersonId: uuid("responsible_person_id").references(() => people.id, { onDelete: "set null" }),
    notes: text("notes"),
    /**
     * تجاوز الاعتماد (§8): تسجيل المصروف مسموح دائماً، وعند التجاوز يظهر تحذير بارز
     * ويُطلب إقرار. لا تُغيَّر القيم المالية صامتاً.
     */
    overspendAcknowledged: boolean("overspend_acknowledged").notNull().default(false),
    overspendAckReason: text("overspend_ack_reason"),
    overspendAckBy: uuid("overspend_ack_by").references(() => users.id),
    overspendAckAt: timestamp("overspend_ack_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("budget_expenses_year_idx").on(t.planYearId), index("budget_expenses_program_idx").on(t.programId)],
);

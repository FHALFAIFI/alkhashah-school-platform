import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { storedFiles, documents } from "./shared";
import { people } from "./school";

/**
 * نماذج الأداء.
 * النماذج الرسمية الثمانية تدخل من ملف الوزارة (المفقود حالياً — D-006) وتوسم official=true
 * ولا تعدل أسماؤها أو مؤشراتها أو أوزانها. نماذج الموظفين تصمم عبر مصمم النماذج وتبقى
 * مسودة حتى اعتماد المدير.
 */
export const perfModels = pgTable("perf_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  audience: text("audience").notNull(), // معلم | موظف
  official: boolean("official").notNull().default(false),
  /** مسودة | معتمد | بانتظار الاعتماد الرسمي | مؤرشف */
  status: text("status").notNull().default("مسودة"),
  description: text("description"),
  /** ratings scale is fixed 1..5; weighted = (rating/5) * weight */
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const perfIndicators = pgTable(
  "perf_indicators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: uuid("model_id").notNull().references(() => perfModels.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    key: text("key"),
    nameAr: text("name_ar").notNull(),
    /** weight in percent; sum per model must equal 100 */
    weight: numeric("weight").notNull(),
    requiresEvidence: boolean("requires_evidence").notNull().default(true),
    description: text("description"),
  },
  (t) => [index("indicators_model_idx").on(t.modelId)],
);

/** دورات الأداء */
export const perfCycles = pgTable(
  "perf_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull().references(() => people.id),
    cycleType: text("cycle_type").notNull(), // معلم | موظف
    /** e.g. 1448-1449 for teachers, 2027 for staff */
    yearKey: text("year_key").notNull(),
    modelId: uuid("model_id").notNull().references(() => perfModels.id),
    /** لقطة التقويم المستخدمة عند الإنشاء — مجمدة */
    calendarSnapshot: jsonb("calendar_snapshot"),
    /** لقطة النموذج (المؤشرات والأوزان) المجمدة وقت إنشاء الدورة */
    modelSnapshot: jsonb("model_snapshot").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    /** مواعيد يضبطها المدير لدورة الموظف */
    planningDeadline: text("planning_deadline"),
    midDeadline: text("mid_deadline"),
    finalDeadline: text("final_deadline"),
    followupTarget: integer("followup_target").notNull().default(5),
    status: text("status").notNull().default("نشطة"), // نشطة | مكتملة | مقفلة
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cycles_person_idx").on(t.personId),
    uniqueIndex("cycles_person_year_unique").on(t.personId, t.yearKey),
  ],
);

/** الجلسات: تخطيط | منتصف العام | تقييم نهائي | زيارة صفية | متابعة */
export const perfSessions = pgTable(
  "perf_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id").notNull().references(() => perfCycles.id, { onDelete: "cascade" }),
    sessionType: text("session_type").notNull(), // تخطيط | منتصف | نهائي | زيارة | متابعة
    sessionDate: text("session_date"),
    status: text("status").notNull().default("مسودة"), // مسودة | بانتظار التقرير الموقع | مكتملة | مقفلة
    notes: text("notes"),
    /** تعليق المدير (اختياري) — لا يمنع الحفظ */
    principalComment: text("principal_comment"),
    /** تعليق الموظف (اختياري) — لا يمنع الحفظ */
    employeeComment: text("employee_comment"),
    strengths: text("strengths"),
    improvementAreas: text("improvement_areas"),
    /** التوصيات (اختياري) منفصلة عن إجراءات المتابعة */
    recommendations: text("recommendations"),
    actionsText: text("actions_text"),
    nextFollowupDate: text("next_followup_date"),
    /**
     * تمييز «اكتمل التقييم» عن «استُلم التقرير الموقع»:
     * evaluationCompletedAt يُضبط عند إتمام التقييم وإصدار التقرير غير الموقع،
     * والاكتمال النهائي يبقى مشروطاً برفع التقرير الموقع.
     */
    evaluationCompletedAt: timestamp("evaluation_completed_at", { withTimezone: true }),
    /** computed: sum((rating/5)*weight) over rated indicators — server-side only */
    sessionResult: numeric("session_result"),
    /** computed: rated indicators / total indicators */
    coverage: numeric("coverage"),
    reportDocId: uuid("report_doc_id").references(() => documents.id),
    /** التقرير الموقع المرفوع — شرط الاكتمال النهائي */
    signedReportFileId: uuid("signed_report_file_id").references(() => storedFiles.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    warningFlags: jsonb("warning_flags").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_cycle_idx").on(t.cycleId)],
);

/**
 * نسخ التقرير الموقع للجلسة — سجل الاستبدال.
 * استبدال التقرير الموقع لا يفقد النسخة السابقة: تُحفظ هنا كاملةً، ويبقى
 * `perf_sessions.signed_report_file_id` مشيراً إلى النسخة الحالية.
 */
export const perfSignedReportVersions = pgTable(
  "perf_signed_report_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => perfSessions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fileId: uuid("file_id").notNull().references(() => storedFiles.id),
    reason: text("reason"),
    replacedBy: uuid("replaced_by").references(() => users.id),
    replacedAt: timestamp("replaced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("perf_signed_versions_session_idx").on(t.sessionId),
    uniqueIndex("perf_signed_versions_unique").on(t.sessionId, t.version),
  ],
);

/** تقديرات المؤشرات داخل الجلسة — التقدير 1..5 فقط، والنتيجة تحسب في الخادم */
export const perfRatings = pgTable(
  "perf_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => perfSessions.id, { onDelete: "cascade" }),
    indicatorId: uuid("indicator_id").notNull().references(() => perfIndicators.id),
    rating: integer("rating"), // 1..5 or null (غير مقيم بعد)
    note: text("note"),
  },
  (t) => [uniqueIndex("ratings_session_indicator_unique").on(t.sessionId, t.indicatorId)],
);

/** خطط التحسين — قرار يدوي من المدير */
export const improvementPlans = pgTable(
  "improvement_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id").notNull().references(() => perfCycles.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => perfSessions.id),
    title: text("title").notNull(),
    goals: text("goals"),
    actions: text("actions"),
    duration: text("duration"),
    status: text("status").notNull().default("مسودة"),
    suggested: boolean("suggested").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("improvement_cycle_idx").on(t.cycleId)],
);

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
import { importBatches } from "./shared";
import { calendars } from "./school";

/** السنة التخطيطية */
export const planYears = pgTable("plan_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // 1448-1449
  nameAr: text("name_ar").notNull(),
  calendarId: uuid("calendar_id").references(() => calendars.id),
  /** لقطة التقويم المجمدة وقت إنشاء السنة */
  calendarSnapshot: jsonb("calendar_snapshot"),
  status: text("status").notNull().default("نشطة"), // نشطة | مقفلة
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** البرامج والمبادرات — القيم الرسمية تحفظ حرفياً */
export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    seq: integer("seq").notNull(),
    domain: text("domain").notNull(),
    generalGoal: text("general_goal"),
    specificGoal: text("specific_goal"),
    name: text("name").notNull(),
    rationale: text("rationale"),
    targetGroup: text("target_group"),
    mechanism: text("mechanism"),
    periodText: text("period_text"),
    ownerPosition: text("owner_position"),
    ownerPersonId: uuid("owner_person_id"),
    participants: text("participants"),
    kpiText: text("kpi_text"),
    targetText: text("target_text"),
    deliverableText: text("deliverable_text"),
    evidenceText: text("evidence_text"),
    followupText: text("followup_text"),
    externalRelation: text("external_relation"),
    expectedImpact: text("expected_impact"),
    budget: numeric("budget"),
    priority: text("priority"),
    baselineText: text("baseline_text"),
    indicatorText: text("indicator_text"),
    executionStage: text("execution_stage"),
    /** verbatim Hijri from source, e.g. 1448/3/2 و 1449/1/5 */
    hijriStart: text("hijri_start"),
    hijriEnd: text("hijri_end"),
    pausePeriods: text("pause_periods"),
    targetExplanation: text("target_explanation"),
    principalNotes: text("principal_notes"),
    /** الحالة والاعتماد */
    status: text("status").notNull().default("مسودة"), // مسودة | معتمد | مقفل
    version: integer("version").notNull().default(1),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** تقدم محسوب من المعالم الموزونة */
    progress: integer("progress").notNull().default(0),
    executionStatus: text("execution_status").notNull().default("لم يبدأ"),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    stageTargets: jsonb("stage_targets").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("programs_year_seq_unique").on(t.planYearId, t.seq),
    index("programs_year_idx").on(t.planYearId),
  ],
);

/** المعالم الموزونة — أساس حساب التقدم */
export const programMilestones = pgTable(
  "program_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull(),
    weight: integer("weight").notNull().default(0), // مجموع معالم البرنامج = 100
    dueText: text("due_text"),
    status: text("status").notNull().default("لم يبدأ"), // لم يبدأ | قيد التنفيذ | مكتمل
    progress: integer("progress").notNull().default(0), // 0..100
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [index("milestones_program_idx").on(t.programId)],
);

/** المخرجات المطلوبة وحزم الشواهد */
export const programDeliverables = pgTable(
  "program_deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
    outputType: text("output_type"),
    mainOutput: text("main_output"),
    supportOutput: text("support_output"),
    expectedExternalEvidence: text("expected_external_evidence"),
    acceptedEvidence: text("accepted_evidence"),
    requiresExternal: boolean("requires_external").notNull().default(false),
    prepOwner: text("prep_owner"),
    keepOwner: text("keep_owner"),
    dueText: text("due_text"),
    storagePlace: text("storage_place"),
    packageNumber: text("package_number"),
    minPackageRule: text("min_package_rule"),
    packageStatus: text("package_status").notNull().default("غير مكتملة"), // غير مكتملة | جاهزة للاعتماد | معتمدة
    packageDecision: text("package_decision").notNull().default("غير معتمد"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    principalNotes: text("principal_notes"),
  },
  (t) => [index("deliverables_program_idx").on(t.programId)],
);

/** مؤشرات الأداء للخطة */
export const programKpis = pgTable("program_kpis", {
  id: uuid("id").primaryKey().defaultRandom(),
  planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
  code: text("code").notNull(),
  nameAr: text("name_ar").notNull(),
  baseline: text("baseline"),
  target: text("target"),
  periodicity: text("periodicity"),
  owner: text("owner"),
  dataSource: text("data_source"),
  direction: text("direction"),
  measureDates: text("measure_dates"),
  reviewDecision: text("review_decision"),
});

/** سجل المخاطر */
export const programRisks = pgTable("program_risks", {
  id: uuid("id").primaryKey().defaultRandom(),
  planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
  code: text("code").notNull(),
  risk: text("risk").notNull(),
  likelihood: text("likelihood"),
  impact: text("impact"),
  classification: text("classification"),
  treatment: text("treatment"),
  owner: text("owner"),
});

/** بنود الميزانية */
export const planBudgetItems = pgTable("plan_budget_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
  item: text("item").notNull(),
  amount: numeric("amount"),
  ratio: numeric("ratio"),
  rule: text("rule"),
  notes: text("notes"),
});

/** خارطة التنفيذ السنوية — برنامج × فترة */
export const programRoadmapCells = pgTable(
  "program_roadmap_cells",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    periodLabel: text("period_label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    phase: text("phase"), // إعداد | تشغيل | متابعة | مراجعة | تكثيف | إغلاق | توقف
  },
  (t) => [uniqueIndex("roadmap_unique").on(t.programId, t.periodKey)],
);

/** المتابعة الأسبوعية للبرامج المعتمدة — سجل أسبوعي واحد لكل برنامج (upsert) */
export const programFollowups = pgTable(
  "program_followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
    /** أسبوع ISO مثل 2026-W29 */
    weekKey: text("week_key").notNull(),
    note: text("note").notNull(),
    /** لقطة التقدم المحسوب وقت المتابعة */
    progressSnapshot: integer("progress_snapshot").notNull().default(0),
    executionStatus: text("execution_status").notNull(), // في المسار | متأخر | متوقف مؤقتاً | مكتمل
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("followups_program_week_unique").on(t.programId, t.weekKey),
    index("followups_program_idx").on(t.programId),
  ],
);

/** طلبات تغيير البرامج المعتمدة */
export const programChangeRequests = pgTable(
  "program_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    fieldLabel: text("field_label").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("قيد الاعتماد"), // قيد الاعتماد | معتمد | مرفوض
    requestedBy: uuid("requested_by").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("change_requests_program_idx").on(t.programId)],
);

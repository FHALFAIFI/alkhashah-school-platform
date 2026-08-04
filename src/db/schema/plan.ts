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
import { calendars, people } from "./school";

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
    /** تقدم محسوب من الأنشطة الموزونة حصراً (D-020) — المعالم القديمة لا تُحتسب */
    progress: integer("progress").notNull().default(0),
    executionStatus: text("execution_status").notNull().default("لم يبدأ"),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    stageTargets: jsonb("stage_targets").$type<string[]>(),
    /** وضع الوزن: «متساوٍ» (افتراضي) أو «مخصص» (مجموع الأوزان يجب أن يساوي 100 بالضبط) */
    weightingMode: text("weighting_mode").notNull().default("متساوٍ"),
    /**
     * الاكتمال (التصحيح التشغيلي — سير عمل البرنامج ثلاثي الحالات):
     * «قيد التنفيذ» ← «مكتمل» ← «مغلق». الحالة مشتقة من العمودين الزمنيين:
     * `completedAt` غير فارغ = «مكتمل»، و`closedAt` غير فارغ = «مغلق».
     *
     * «تعليم البرنامج كمكتمل» قرار بشري مباشر لا يشترط شاهداً ولا نسبة ولا ميزانية
     * ولا أي حقل (D-024/D-025 — لا جاهزية ولا حصص). البرنامج المكتمل يبقى قابلاً
     * للتحرير وإضافة الشواهد. أعمدة override أدناه أثر تاريخي من نموذج الجاهزية
     * الملغى (D-024) — تبقى خاملة بلا مسار كتابة.
     */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    /** ملاحظة اكتمال اختيارية (القاعدة العامة: كل حقل يُدخله المستخدم اختياري) */
    completionNote: text("completion_note"),
    /** اكتمل بتجاوز: يبقى ظاهراً في التقارير التاريخية ولا تختفي النواقص */
    completionOverride: boolean("completion_override").notNull().default(false),
    overrideReason: text("override_reason"),
    overrideBy: uuid("override_by").references(() => users.id),
    overrideAt: timestamp("override_at", { withTimezone: true }),
    /** لقطة الجاهزية والنواقص لحظة التجاوز — دليل تاريخي ثابت */
    overrideReadiness: integer("override_readiness"),
    overrideMissing: jsonb("override_missing").$type<string[]>(),
    /** الأرشفة — إخفاء غير مدمّر قابل للاستعادة */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    archivedReason: text("archived_reason"),
    /**
     * الإقفال النهائي للبرنامج (v2.2 §A2) — حالة عمل مستقلة تماماً عن:
     *  - الأرشفة (`archivedAt`) = إخفاء/حذف ناعم قابل للاستعادة،
     *  - الاعتماد (`status = "معتمد"`) = اعتماد حزمة البرنامج،
     *  - إقفال السنة (`status = "مقفل"`) = إقفال السنة التخطيطية كاملة.
     *
     * الإقفال لا يشترط شاهداً ولا نشاطاً ولا معلماً ولا نسبة جاهزية ولا اكتمال ميزانية
     * ولا نتائج ولا أثراً ولا أي حقل يُدخله المستخدم. السجل كامل يُحفَظ كما هو، ويختفي
     * البرنامج من القوائم التشغيلية فقط مع بقائه في العروض التاريخية والتقارير.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    /** ملاحظة إقفال اختيارية (القاعدة العامة: كل حقل يُدخله المستخدم اختياري) */
    closureNote: text("closure_note"),
    /** آخر إعادة فتح — التاريخ الكامل محفوظ في `program_closure_history` ولا يُكتب فوقه */
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedBy: uuid("reopened_by").references(() => users.id),
    /**
     * مُنشئ البرنامج (v2.2 §A1) — قابل للفراغ: البرامج المستوردة تاريخياً بلا منشئ مسجَّل،
     * ولا تُكتب لها قيمة بأثر رجعي. يُستعمل للتدقيق ولمنع الإنشاء المكرر من نقر متتابع.
     */
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("programs_year_seq_unique").on(t.planYearId, t.seq),
    index("programs_year_idx").on(t.planYearId),
  ],
);

/**
 * الأنشطة — وحدة التنفيذ والوزن الوحيدة في الخطة التشغيلية (D-020).
 *
 * الهرم المعتمد: الخطة التشغيلية ← البرنامج ← الأنشطة ← المخرجات والمتطلبات والشواهد.
 * لا برامج متداخلة ولا برنامج داخل نشاط.
 *
 * الأنشطة تستوعب `program_milestones` وظيفياً: تقدم البرنامج يُحسب من الأنشطة حصراً،
 * والجدول القديم يبقى فيزيائياً للقراءة فقط كمصدر تراجع ومطابقة، ويُزال لاحقاً بهجرة
 * تنظيف منفصلة معتمدة. `migratedFromMilestoneId` مرجع فريد يثبت أن كل معلم قديم
 * انتقل إلى نشاط واحد بالضبط — وهو أيضاً ما يجعل إعادة تشغيل النقل آمنة (لا تكرار).
 */
export const programActivities = pgTable(
  "program_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // restrict: لا حذف تعاقبي لسجل تنفيذ — حذف البرنامج يمر بطبقة الحذف الآمن
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "restrict" }),
    /** مرجع المعلم القديم — فريد ويقبل الفراغ (الأنشطة الجديدة بلا أصل قديم) */
    migratedFromMilestoneId: uuid("migrated_from_milestone_id"),
    name: text("name").notNull(),
    description: text("description"),
    /** المسؤول من سجل المنسوبين المعتمد — مصدر واحد للموظفين */
    ownerPersonId: uuid("owner_person_id").references(() => people.id, { onDelete: "restrict" }),
    /** التواريخ المخططة والفعلية — نصية لأن المصدر الرسمي هجري حرفي */
    plannedStart: text("planned_start"),
    plannedEnd: text("planned_end"),
    actualStart: text("actual_start"),
    actualEnd: text("actual_end"),
    /** مسودة | لم يبدأ | قيد التنفيذ | مكتمل | أعيد فتحه | ملغى | مؤرشف */
    status: text("status").notNull().default("لم يبدأ"),
    /** 0..100 — لا قيمة افتراضية مخترعة عند «قيد التنفيذ» */
    progress: integer("progress").notNull().default(0),
    /** وزن مخصص اختياري؛ يُستعمل فقط في وضع الوزن المخصص للبرنامج */
    weight: integer("weight"),
    /** نشاط إلزامي لاكتمال البرنامج */
    requiredForCompletion: boolean("required_for_completion").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** الإلغاء يتطلب سبباً مدققاً وإعادة تحقق من الأوزان */
    cancelReason: text("cancel_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    archivedReason: text("archived_reason"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_program_idx").on(t.programId),
    index("activities_owner_idx").on(t.ownerPersonId),
    // يمنع ازدواج النقل: كل معلم قديم ينتقل إلى نشاط واحد بالضبط
    uniqueIndex("activities_migrated_milestone_unique").on(t.migratedFromMilestoneId),
  ],
);

/**
 * سجل حالات النشاط — تاريخ قابل للاستعلام للاكتمال والتجاوز وإعادة الفتح والإلغاء،
 * بالمستخدم والوقت والسبب والقيمة السابقة. سجل التدقيق العام يبقى، لكن هذا الجدول
 * يجعل تاريخ النشاط قابلاً للعرض والتقرير مباشرةً دون تنقيب في `audit_log`.
 */
export const activityStateHistory = pgTable(
  "activity_state_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => programActivities.id, { onDelete: "cascade" }),
    /** status_changed | progress_changed | completed | reopened | cancelled | archived | restored */
    event: text("event").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    fromProgress: integer("from_progress"),
    toProgress: integer("to_progress"),
    reason: text("reason"),
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_history_activity_idx").on(t.activityId)],
);

/** مخرجات النشاط — ما يجب إنتاجه فعلياً ليُعدّ النشاط مكتملاً */
export const activityDeliverables = pgTable(
  "activity_deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => programActivities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    required: boolean("required").notNull().default(true),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("activity_deliverables_activity_idx").on(t.activityId)],
);

/**
 * متطلبات الشواهد للنشاط — تصف الشاهد المطلوب لا الملف نفسه.
 * الملفات تبقى في سجل الشواهد الموحد (`evidence_items` + `evidence_links`) — لا مخزن رفع ثانٍ.
 * التحقق من الاستيفاء يتم بعدّ الروابط من نوع `activity` بمفتاح فرعي = معرّف المتطلب.
 */
export const activityEvidenceRequirements = pgTable(
  "activity_evidence_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => programActivities.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** التصنيف المطلوب: شاهد تنفيذ | شاهد مخرج | شاهد أثر | شاهد خارجي (أو فارغ = أي تصنيف) */
    requiredRole: text("required_role"),
    minCount: integer("min_count").notNull().default(1),
    required: boolean("required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("activity_evidence_req_activity_idx").on(t.activityId)],
);

/** المعالم الموزونة — مُستوعَبة في الأنشطة (D-020). للقراءة فقط: مصدر تراجع ومطابقة لا غير. */
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

/**
 * التحليل الرباعي (SWOT) — ورقة «التحليل الرباعي» في مصنف الخطة التشغيلية الرسمي.
 *
 * البيانات رسمية وتُحفظ حرفياً كبقية أوراق المصنف (المخاطر والمؤشرات والميزانية): النوع
 * والرمز ونص العنصر والدلالة الاستراتيجية كما وردت، بلا إعادة صياغة ولا اشتقاق.
 *
 * لماذا جدول مستقل لا حقل JSON: العناصر تُستعلم وتُرشَّح وتُصدَّر كصفوف في مركز التقارير
 * تماماً كسجل المخاطر، ويجب أن تُستبعد الصفوف الاصطناعية بمعرّفها كبقية الكيانات.
 */
export const planSwotItems = pgTable(
  "plan_swot_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    /** قوة | ضعف | فرصة | تهديد — القيمة الرسمية كما وردت في المصدر */
    category: text("category").notNull(),
    /** الرمز الرسمي مثل «قوة-01» */
    code: text("code").notNull(),
    /** نص العنصر */
    item: text("item").notNull(),
    /** الدلالة الاستراتيجية */
    implication: text("implication"),
    sortOrder: integer("sort_order").notNull().default(0),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("plan_swot_year_idx").on(t.planYearId),
    // الرمز فريد داخل السنة — إعادة الاستيراد لا تُنشئ نسخاً مكررة
    uniqueIndex("plan_swot_year_code_unique").on(t.planYearId, t.code),
  ],
);

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

/**
 * سجل تحولات حالة البرنامج (v2.2 §A2 + التصحيح التشغيلي) — سجل تاريخي **يُضاف إليه فقط**.
 *
 * لا يُحدَّث صف سابق ولا يُحذف أبداً: كل اكتمال وكل إقفال وكل إعادة فتح وكل إعادة للتنفيذ
 * يُضيف صفاً جديداً، فيبقى التسلسل التاريخي كاملاً حتى بعد دورات متكررة. أعمدة
 * `programs.completed_at` و`closed_at` وأخواتها تمثّل الحالة الراهنة فقط، وهذا الجدول
 * هو المرجع التاريخي.
 */
export const programClosureHistory = pgTable(
  "program_closure_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
    /** «اكتمال» | «إقفال» | «إعادة فتح» | «إعادة للتنفيذ» */
    action: text("action").notNull(),
    /**
     * الحالة قبل التحول وبعده («قيد التنفيذ» | «مكتمل» | «مغلق») — فارغتان في الصفوف
     * التاريخية المسجلة قبل إضافة العمودين؛ لا تُملآن بأثر رجعي (السجل لا يُعدَّل).
     */
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    /** ملاحظة اختيارية يُدخلها المستخدم */
    note: text("note"),
    actorId: uuid("actor_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("program_closure_history_program_idx").on(t.programId, t.at)],
);

/**
 * سجل تعديلات البرنامج على مستوى الحقل (v2.4.1 §1.6) — **إلحاقي فقط**.
 *
 * التعديل مسموح في كل حالات دورة الحياة (مسودة/بانتظار الاعتماد/معتمد/قيد التنفيذ/مكتمل/
 * مغلق) ولا يُغيّر الحالة ولا يُلغي الاعتماد ولا يُعيد الفتح. ما يجعل ذلك آمناً هو هذا
 * السجل: لكل حقل تغيّر صفٌّ يحمل الفاعل ووقته وحالة البرنامج لحظة التعديل والقيمة
 * السابقة والجديدة وسبب التغيير.
 *
 * وجود صف واحد على الأقل بحالة اعتماد («معتمد») أو دورة حياة غير «قيد التنفيذ» هو مصدر
 * علامة «تم تعديل البرنامج بعد الاعتماد» — لا عمود حالة إضافي على `programs` يمكن أن
 * يتعارض مع السجل.
 */
export const programEditHistory = pgTable(
  "program_edit_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    /** الحقل التقني ومسماه العربي المعروض */
    field: text("field").notNull(),
    fieldLabel: text("field_label").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    /** حالة الاعتماد لحظة التعديل: مسودة | معتمد | مقفل */
    approvalStatusAtEdit: text("approval_status_at_edit").notNull(),
    /** حالة دورة الحياة لحظة التعديل: قيد التنفيذ | مكتمل | مغلق */
    lifecycleAtEdit: text("lifecycle_at_edit").notNull(),
    /** سبب التغيير — إلزامي بعد الاعتماد أو الاكتمال أو الإقفال، اختياري للمسودة */
    reason: text("reason"),
    actorId: uuid("actor_id").references(() => users.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("program_edit_history_program_idx").on(t.programId, t.at)],
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

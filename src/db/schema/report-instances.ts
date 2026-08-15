import { pgTable, uuid, text, jsonb, timestamp, integer, boolean, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./core";
import { storedFiles } from "./shared";

/**
 * التقارير المحفوظة (v2.6 §A/§B — D-055).
 *
 * ── ماذا يضيف هذا الجدول على ما قبله ─────────────────────────────────────────
 * المنصة تعرف حتى v2.5.0 ثلاثة أشياء: «قالب محفوظ» (وصفة، `report_templates`)، و«وثيقة
 * صادرة» (لقطة HTML مجمّدة، `documents`)، و«تعريف تقرير» (سجل `lib/reports/catalog`).
 * هذا الجدول هو الشيء الرابع الذي تحتفظ به المدرسة فعلاً: **تقرير يُبنى في المنشئ ويُحفظ
 * مسودةً ثم يُعتمد نهائياً برقم لا يتكرر ولقطة لا تتغير، ويُؤرشف ويُبحث فيه بعد سنوات.**
 *
 * ── دورة الحياة ──────────────────────────────────────────────────────────────
 * «مسودة» → «نهائي» → «مؤرشف». المسودة وحدها تُعدَّل وتُحذف. الاعتماد النهائي يكتب
 * `snapshot` مرة واحدة داخل معاملة واحدة ويمنح `report_number` من عدّاد مقفول
 * (`report_counters`) — لا من عدّ الصفوف، فذلك سباق موثَّق. النسخة الجديدة من تقرير نهائي
 * تقرير جديد برقم جديد يشير إلى أصله عبر `version_of_id`.
 *
 * ── الثبات مفروض في القاعدة لا في الخدمة وحدها ───────────────────────────────
 * الهجرة 0035 تنصّب قادحاً يرفض تعديل أي عمود محتوى وحذف أي صف ليس «مسودة» — فلا شيفرة
 * تطبيق ولا مهمة خلفية ولا تتالي حذف ولا هجرة لاحقة يبدّل لقطةً اعتُمدت. المسموح بعد
 * الاعتماد ثلاثة فقط: تحويل الأرشفة، ومرجع النسخة الموقّعة، وبيانات المحدِّث.
 */
export const reportInstances = pgTable(
  "report_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** الاسم الكامل للتقرير — يظهر في الأرشيف وفي اسم الملف المولَّد (§G) */
    title: text("title").notNull(),
    /** نوع التقرير في سجل الأنواع (`lib/reports/instances/types`) — مفرد أو مركّب */
    typeKey: text("type_key").notNull(),
    /** «مسودة» | «نهائي» | «مؤرشف» */
    status: text("status").notNull().default("مسودة"),
    /** رقم التقرير — يُمنح عند الاعتماد النهائي فقط ولا يتكرر أبداً */
    reportNumber: text("report_number"),
    /** أصل هذا التقرير إن كان نسخة جديدة من تقرير نهائي سابق */
    versionOfId: uuid("version_of_id").references((): AnyPgColumn => reportInstances.id),
    /**
     * وصفة المسودة: المرشّحات بشكل `StoredFilters` (خرائط إلى مصفوفات — تُطهَّر
     * بـ`parseReportFilters` عند كل قراءة، فالصفّ المخزَّن ليس مصدر ثقة)
     */
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * خيارات البناء: ترتيب الأقسام وإخفاؤها، إظهار الحقول الفارغة، الغلاف والفهرس،
     * مفتاح القالب، تجاوزات الهوية، مرشّحات الأقسام — كلها قوائم بيضاء عند القراءة
     */
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    /** فترة التقرير للعرض والبحث في الأرشيف — ISO، اختيارية كسائر حقول الإدخال */
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    /**
     * اللقطة المجمّدة (`SnapshotDoc`، D-060) — تُكتب مرة واحدة داخل معاملة الاعتماد
     * وتبقى فارغة (NULL) طوال حياة المسودة: المسودة تقرأ البيانات الحية دائماً
     */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    /** التقرير يحمل بيانات أداء فردية (D-013) — يُقيَّد عرضه وتصديره بالصلاحية الفردية */
    sensitive: boolean("sensitive").notNull().default(false),
    /** النسخة الموقّعة المرفوعة بعد التوقيع الخارجي (§B) — تُضاف بعد الاعتماد */
    signedCopyFileId: uuid("signed_copy_file_id").references(() => storedFiles.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by").references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("report_instances_number_unique").on(t.reportNumber),
    index("report_instances_status_idx").on(t.status),
    index("report_instances_type_idx").on(t.typeKey),
    index("report_instances_created_idx").on(t.createdAt),
  ],
);

/**
 * مخرجات التقرير المحفوظة — ملف واحد لكل (تقرير، صيغة).
 *
 * PDF وWord وExcel تُجمَّد مع الاعتماد؛ ZIP وحدها تُعاد تجميعاً من الأجزاء المحفوظة
 * (D-060) لأن النسخة الموقّعة تصل بعد الاعتماد ويجب أن تدخل الحزمة. القيد الفريد هو ما
 * يجعل إعادة المحاولة بعد انقطاع آمنة: التوليد يستبدل صفّه ولا يكرّره.
 */
export const reportOutputs = pgTable(
  "report_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => reportInstances.id, { onDelete: "cascade" }),
    /** pdf | docx | xlsx | zip */
    format: text("format").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id),
    /** sha256 للملف وقت توليده — فحص سلامة مستقل عن جدول الملفات */
    checksum: text("checksum"),
    size: integer("size"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("report_outputs_instance_format_unique").on(t.instanceId, t.format)],
);

/**
 * مهام توليد المخرجات في الخلفية (D-059) — الجدول هو الحقيقة، و`after()` هو المنفّذ.
 *
 * «قيد الانتظار» | «قيد التنفيذ» | «مكتمل» | «فشل». مهمة نشطة واحدة لكل تقرير (فهرس
 * جزئي في الهجرة 0034)، والمهمة العالقة تُعرف من `heartbeat_at` القديم وتُعاد بمهمة
 * جديدة — لا يُعدَّل تاريخ مهمة ماتت.
 */
export const reportJobs = pgTable(
  "report_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => reportInstances.id, { onDelete: "cascade" }),
    /** الصيغ المطلوبة: ["pdf","docx",…] */
    formats: jsonb("formats").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("قيد الانتظار"),
    attempt: integer("attempt").notNull().default(1),
    /** سبب الفشل بالعربية — يُعرض للمستخدم مع زر «إعادة المحاولة» (§I) */
    error: text("error"),
    requestedBy: uuid("requested_by").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_jobs_instance_idx").on(t.instanceId), index("report_jobs_status_idx").on(t.status)],
);

/**
 * عدّاد أرقام التقارير لكل سنة — يُقرأ بقفل صفّ (`FOR UPDATE`) داخل معاملة الاعتماد،
 * فلا يتصادم رقمان ولو تزامن اعتمادان. البادئة من إعداد `reports.number_prefix`.
 */
export const reportCounters = pgTable("report_counters", {
  yearKey: text("year_key").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

/**
 * القوالب المخصصة المنسوخة من القوالب الأساسية الخمسة (D-058).
 *
 * القوالب الأساسية سجلّ نقي في الشيفرة (`lib/reports/instances/base-templates`) فلا
 * تُحذف ولا تُعدَّل بالبناء. النسخة المخصصة صفّ يحمل مفتاح أصله وفرقاً مُقيَّداً بقائمة
 * بيضاء (ألوان، نصوص ترويسة وتذييل، غلاف وفهرس، مفاتيح هوية) — ليس مصمم قوالب حراً.
 */
export const reportStyleTemplates = pgTable(
  "report_style_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** مفتاح القالب الأساسي المنسوخ منه — يُتحقق منه عند القراءة لا عند الحفظ فقط */
    baseKey: text("base_key").notNull(),
    /** فرق التخصيص — يُطهَّر بمخطط zod الصارم عند كل قراءة */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_style_templates_base_idx").on(t.baseKey)],
);

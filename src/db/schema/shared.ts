import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./core";

/** الملفات المخزنة — خارج المجلد العام، تنزيل عبر مسارات مصادق عليها فقط */
export const storedFiles = pgTable("stored_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  /** relative path under STORAGE_DIR — always server-generated, never client-supplied */
  storagePath: text("storage_path").notNull().unique(),
  scope: text("scope").notNull().default("attachments"), // attachments | branding | backgrounds | reports
  sensitive: boolean("sensitive").notNull().default(false),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  /**
   * قبول الملف (D-032): يُحدَّد على الخادم من دور المستخدم المصادَق حصراً — لا من المتصفح.
   * «مقبول» فوراً لرفع المدير (وضع «قبول تلقائي بواسطة المدير»)، و«قيد الاعتماد» لغيره حتى
   * يعتمده المدير («اعتماد يدوي بواسطة المدير»). NULL = ملف سابق للخاصية، يُعامل مقبولاً —
   * فلا يُعاد كتابة أي سجل تاريخي.
   */
  acceptanceStatus: text("acceptance_status"), // مقبول | قيد الاعتماد
  acceptanceMode: text("acceptance_mode"), // قبول تلقائي بواسطة المدير | اعتماد يدوي بواسطة المدير
  acceptedBy: uuid("accepted_by").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** الشواهد — سجل موحد يعاد استخدامه عبر جميع الوحدات */
export const evidenceItems = pgTable("evidence_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // file | link | text
  fileId: uuid("file_id").references(() => storedFiles.id),
  url: text("url"),
  textContent: text("text_content"),
  description: text("description"),
  /** القوائم المرجعية من سجل الشواهد */
  source: text("source"), // المدرسة | جهة خارجية ...
  role: text("role"), // خط أساس | تنفيذ | مخرج | أثر | خارجي
  evidenceType: text("evidence_type"),
  origin: text("origin"), // ورقي | رقمي
  issuer: text("issuer"),
  evidenceDate: text("evidence_date"),
  reviewStatus: text("review_status").notNull().default("لم يراجع"),
  reviewNote: text("review_note"),
  /** رقم النسخة الحالية — يزداد عند كل استبدال للملف مع الحفاظ على كل الروابط */
  version: integer("version").notNull().default(1),
  /** الأرشفة: إخفاء غير مدمّر مع سبب عربي وقابلية الاستعادة الكاملة (لا يحذف أي رابط) */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedReason: text("archived_reason"),
  archivedBy: uuid("archived_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * نسخ الشواهد — سجل الاستبدال. استبدال ملف الشاهد لا يحذف الشاهد ولا يكسر روابطه:
 * تُحفَظ النسخة السابقة هنا كاملةً ويبقى `evidence_items.id` ثابتاً، فتظل كل السجلات
 * المرتبطة (برنامج، نشاط، اجتماع، لجنة، مصروف، غرفة، أصل…) مشيرة إلى الشاهد نفسه.
 */
export const evidenceVersions = pgTable(
  "evidence_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id").notNull().references(() => evidenceItems.id, { onDelete: "cascade" }),
    /** رقم النسخة المحفوظة (النسخة التي استُبدلت) */
    version: integer("version").notNull(),
    /** لقطة محتوى النسخة السابقة */
    kind: text("kind").notNull(),
    fileId: uuid("file_id").references(() => storedFiles.id),
    url: text("url"),
    textContent: text("text_content"),
    title: text("title"),
    /** سبب الاستبدال (عربي، إلزامي) */
    reason: text("reason").notNull(),
    replacedBy: uuid("replaced_by").references(() => users.id),
    replacedAt: timestamp("replaced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("evidence_versions_evidence_idx").on(t.evidenceId),
    uniqueIndex("evidence_versions_unique").on(t.evidenceId, t.version),
  ],
);

/** روابط الشواهد — شاهد واحد يرتبط بعدة سجلات */
export const evidenceLinks = pgTable(
  "evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id").notNull().references(() => evidenceItems.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // program | deliverable | meeting | perf_session | perf_rating | room | inspection | maintenance ...
    entityId: uuid("entity_id").notNull(),
    /** لسجلات الأداء: ربط بمؤشر محدد — سلسلة فارغة تعني بلا مفتاح فرعي (لتفعيل قيد التفرد) */
    subKey: text("sub_key").notNull().default(""),
    linkedBy: uuid("linked_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("evidence_links_entity_idx").on(t.entityType, t.entityId),
    index("evidence_links_evidence_idx").on(t.evidenceId),
    uniqueIndex("evidence_links_unique").on(t.evidenceId, t.entityType, t.entityId, t.subKey),
  ],
);

/** المهام والإجراءات — سجل موحد لجميع الوحدات */
export const actionTasks = pgTable(
  "action_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    ownerPersonId: uuid("owner_person_id"),
    ownerText: text("owner_text"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    priority: text("priority").notNull().default("متوسطة"), // عالية | متوسطة | منخفضة
    status: text("status").notNull().default("جديدة"), // جديدة | قيد التنفيذ | مكتملة | ملغاة
    progress: integer("progress").notNull().default(0),
    /** إجراء إلزامي (ناتج عن قرار لجنة) لا يمكن حذفه */
    mandatory: boolean("mandatory").notNull().default(false),
    sourceType: text("source_type"), // meeting_outcome | program | perf_session | inspection | maintenance | manual ...
    sourceId: uuid("source_id"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_source_idx").on(t.sourceType, t.sourceId), index("tasks_status_idx").on(t.status)],
);

/** الوثائق الصادرة — رقم فريد ورمز تحقق ولقطة ثابتة */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  docNumber: text("doc_number").notNull().unique(),
  verificationCode: text("verification_code").notNull().unique(),
  docType: text("doc_type").notNull(), // performance_report | meeting_minutes | program_report | executive_report ...
  title: text("title").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  /** HTML snapshot rendered at issue time — frozen */
  htmlSnapshot: text("html_snapshot"),
  /**
   * نسخة القالب التي أنتجت هذه الوثيقة (v2.2 §E5) — أثر تدقيقي فقط.
   *
   * اللقطة أعلاه هي ما يُعرض دائماً؛ هذا العمود يجيب «بأي نسخة قالب صدرت؟» ويمنع حذف
   * نسخة ما زالت وثيقة صادرة تشير إليها. قابل للفراغ: الوثائق الصادرة قبل v2.2 بلا نسخة.
   */
  templateVersionId: uuid("template_version_id"),
  pdfFileId: uuid("pdf_file_id").references(() => storedFiles.id),
  withSignature: boolean("with_signature").notNull().default(false),
  withStamp: boolean("with_stamp").notNull().default(false),
  issuedBy: uuid("issued_by").references(() => users.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});

/** دفعات الاستيراد */
export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  importType: text("import_type").notNull(), // people | operational_plan | calendar | assets
  sourceFileName: text("source_file_name").notNull(),
  sourceFileId: uuid("source_file_id").references(() => storedFiles.id),
  status: text("status").notNull().default("معاينة"), // معاينة | جاهزة | منفذة | متراجع عنها | ملغاة
  columnMapping: jsonb("column_mapping"),
  options: jsonb("options"),
  summary: jsonb("summary"),
  errorLog: jsonb("error_log"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  committedBy: uuid("committed_by").references(() => users.id),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
});

/**
 * دفعات الأرشفة — أرشفة السجلات الاصطناعية (تجريبية) أرشفةً غير متلفة وقابلة للتراجع الكامل.
 * الأرشفة لا تحذف أي صف فعلياً؛ تُلتقط لقطة كاملة لكل سجل مؤرشف في archived_records
 * ويُخفى السجل من كل الواجهات عبر مرشّح الاستبعاد المركزي. التراجع يعيد الإظهار فوراً.
 */
export const archiveBatches = pgTable(
  "archive_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** سبب الأرشفة (عربي، إلزامي) */
    reason: text("reason").notNull(),
    /** نص التأكيد الصريح الذي كتبه المدير حرفياً قبل التنفيذ */
    confirmationText: text("confirmation_text").notNull(),
    status: text("status").notNull().default("مؤرشف"), // مؤرشف | مُسترجع
    /** عدد السجلات المؤرشفة حسب النوع وقت التنفيذ (لقطة ثابتة) */
    counts: jsonb("counts").$type<Record<string, number>>(),
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    unarchivedAt: timestamp("unarchived_at", { withTimezone: true }),
    unarchivedBy: uuid("unarchived_by").references(() => users.id),
  },
  (t) => [index("archive_batches_status_idx").on(t.status)],
);

/**
 * السجلات المؤرشفة — لقطة JSON كاملة لكل سجل مؤرشف + نوعه ومعرّفه.
 * ما دام السجل مُدرجاً هنا ضمن دفعة حالتها «مؤرشف» فهو مخفيّ من كل الواجهات.
 * التراجع يحوّل حالة الدفعة إلى «مُسترجع» فيعود السجل للظهور دون فقد أي بيان.
 */
export const archivedRecords = pgTable(
  "archived_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => archiveBatches.id, { onDelete: "cascade" }),
    /** نوع الكيان بمصطلحات المصنّف (person | program | milestone …) */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** سبب بنيوي عربي يُظهِر لماذا صُنّف السجل اصطناعياً */
    reason: text("reason"),
    /** لقطة كاملة للصف وقت الأرشفة — أساس التراجع والتدقيق */
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("archived_records_batch_idx").on(t.batchId),
    index("archived_records_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** صفوف الاستيراد */
export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    raw: jsonb("raw").notNull(),
    mapped: jsonb("mapped"),
    corrections: jsonb("corrections"),
    validation: jsonb("validation"),
    // سجل قرارات المدير على الصف — كل قرار يحفظ لقطة الحالة السابقة ليكون التراجع كاملاً
    decisionHistory: jsonb("decision_history"),
    status: text("status").notNull().default("جاهز"), // جاهز | يحتاج مراجعة | مؤجل | مستبعد | منفذ
    createdEntityType: text("created_entity_type"),
    createdEntityId: uuid("created_entity_id"),
  },
  (t) => [index("import_rows_batch_idx").on(t.batchId)],
);

/**
 * تعريفات القوالب (v2.2 §E1) — قالب واحد لكل نوع وثيقة/تقرير، وقد يوجد أكثر من قالب
 * للنوع نفسه مع واحد افتراضي.
 *
 * الإعداد نفسه لا يُخزَّن هنا: يعيش في `template_versions` غير القابلة للتعديل، وهذا الجدول
 * يحمل الهوية والحالة ومؤشر النسخة المنشورة الحالية.
 */
export const templateDefinitions = pgTable(
  "template_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** نوع الوثيقة من القائمة المغلقة في `src/lib/templates/schema.ts` */
    docType: text("doc_type").notNull(),
    /** الاسم والوصف اختياريان (القاعدة العامة §8) — يُعرض بديل عربي عند الفراغ */
    nameAr: text("name_ar"),
    description: text("description"),
    /** القالب الافتراضي لنوعه — واحد فقط لكل نوع (يُضمن بفهرس جزئي فريد) */
    isDefault: boolean("is_default").notNull().default(false),
    /** النسخة المنشورة المستعملة في التصيير؛ فارغة تعني «مسودة فقط، لم يُنشر بعد» */
    currentVersionId: uuid("current_version_id"),
    /** الأرشفة — إخفاء غير مدمّر: النسخ واللقطات تبقى سليمة */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("template_definitions_type_idx").on(t.docType),
    // قالب افتراضي واحد لكل نوع بين القوالب غير المؤرشفة — يُفرض في قاعدة البيانات
    // لا في الشيفرة وحدها، فلا ينتج افتراضيان من طلبين متزامنين.
    uniqueIndex("template_default_per_type_unique")
      .on(t.docType)
      .where(sql`${t.isDefault} = true and ${t.archivedAt} is null`),
  ],
);

/**
 * نسخ القوالب (v2.2 §E5) — **غير قابلة للتعديل بعد النشر**.
 *
 * تحرير قالب منشور لا يعدّل نسخته: يُنشئ نسخة جديدة برقم أعلى. النسخة المنشورة سابقاً تبقى
 * كما هي إلى الأبد لأن وثائق صادرة قد تشير إليها. هذا شرط «التاريخ المجمَّد» صراحةً.
 */
export const templateVersions = pgTable(
  "template_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").notNull().references(() => templateDefinitions.id, { onDelete: "cascade" }),
    /** رقم تسلسلي داخل القالب — فريد، ولا يُعاد استعماله */
    versionNumber: integer("version_number").notNull(),
    /** إعداد القالب المُتحقَّق منه بمخطط القائمة البيضاء — لا HTML ولا CSS حر */
    config: jsonb("config").notNull(),
    /** مسودة | منشورة | مؤرشفة */
    status: text("status").notNull().default("مسودة"),
    changeNote: text("change_note"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_version_unique").on(t.templateId, t.versionNumber),
    index("template_versions_template_idx").on(t.templateId),
  ],
);

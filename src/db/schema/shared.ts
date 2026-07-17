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
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

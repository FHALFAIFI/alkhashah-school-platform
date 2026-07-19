import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./core";
import { storedFiles } from "./shared";

/**
 * ملاحظات التشغيل التجريبي — قناة داخلية ليبلغ المدير عن أي مشكلة أو اقتراح من أي صفحة
 * دون مغادرة المنصة. القناة محلية بالكامل ولا ترسل أي بيان لأي جهة خارجية.
 *
 * الخصوصية: لا يُلتقط تلقائياً أي محتوى صفحة (HTML) أو كوكيز أو رموز أو كلمات مرور أو
 * محتوى نماذج أو بيانات منسوبين أو حالة تطبيق خفية. تُلتقط فقط: مسار الصفحة، الوحدة،
 * مقاس نافذة العرض، معلومات المتصفح الآمنة العامة، ونسخة التطبيق.
 *
 * الرقم المرجعي (FB-0001) يولَّد من تسلسل قاعدة بيانات (feedback_ref_seq) عبر قيمة
 * افتراضية على مستوى العمود — آمن ضد التسابق ولا يعتمد على عدّ صفوف من التطبيق.
 * الأرشفة لا تحذف أبداً؛ تسجّل سبباً وتاريخاً وتبقي السجل قائماً.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** رقم مرجعي بشري فريد مثل FB-0001 — قيمته الافتراضية من تسلسل قاعدة البيانات */
    ref: text("ref")
      .notNull()
      .unique()
      .default(sql`'FB-' || lpad(nextval('feedback_ref_seq')::text, 4, '0')`),
    createdBy: uuid("created_by").references(() => users.id),
    /** مسار الصفحة الحالية وقت الإرسال (يُتحقق منه في الخادم كمسار داخلي فقط) */
    pagePath: text("page_path").notNull(),
    /** الوحدة (عربية) — لوحة القيادة | الخطة | اللجان … */
    module: text("module").notNull(),
    /** الفئة (عربية) — من قائمة ثابتة */
    category: text("category").notNull(),
    /** الأهمية (عربية) — من قائمة ثابتة */
    severity: text("severity").notNull(),
    /** عنوان مختصر */
    title: text("title").notNull(),
    /** ما الذي كان المدير يحاول عمله */
    attempted: text("attempted"),
    /** ما الذي حدث فعلاً */
    happened: text("happened"),
    /** ما الذي كان متوقعاً */
    expected: text("expected"),
    /** هل يعيق العمل */
    blocked: boolean("blocked").notNull().default(false),
    /** مرفق خاص اختياري (لقطة شاشة أو مستند) — ملف حساس في التخزين الخاص */
    attachmentFileId: uuid("attachment_file_id").references(() => storedFiles.id),
    /** فئة الجهاز (عربية) — جوال | لوحي | سطح مكتب */
    deviceClass: text("device_class"),
    /** مقاس نافذة العرض مثل 390×844 (المصدر الوحيد المسموح من العميل) */
    viewport: text("viewport"),
    /** عائلة المتصفح العامة الآمنة — تُشتق في الخادم من ترويسة الطلب، لا بصمة دقيقة */
    browser: text("browser"),
    /** نسخة/إصدار التطبيق وقت الإرسال — تُلتقط في الخادم */
    appVersion: text("app_version"),
    /** الحالة (عربية) — جديدة | قيد المراجعة | مخطط لمعالجتها | تم الحل | لن تُنفذ */
    status: text("status").notNull().default("جديدة"),
    /** ملاحظة مراجعة داخلية */
    reviewNote: text("review_note"),
    /** ملاحظة الحل ونصها */
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** الأرشفة غير المتلفة — سبب إلزامي، ولا حذف نهائي مطلقاً */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveReason: text("archive_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feedback_status_idx").on(t.status),
    index("feedback_module_idx").on(t.module),
    index("feedback_created_idx").on(t.createdAt),
  ],
);

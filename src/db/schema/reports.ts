import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * قوالب التقارير المحفوظة (v2.5.0 §4.5).
 *
 * ── ما هو القالب وما ليس هو ─────────────────────────────────────────────────
 * القالب **إعداد تقرير محفوظ باسمه**: مصدر البيانات ومرشّحاته وأعمدته وترتيبها وتجميعها
 * ونمط عرضها وصيغة إخراجها المفضّلة. وهو ليس تقريراً ولا وثيقة:
 *
 *   • **قالب تقرير محفوظ** (هذا الجدول) — وصفة تُشغَّل متى شاء المدير فتقرأ البيانات
 *     الحالية. حذفه لا يمسّ أي بيانات ولا أي وثيقة صدرت منه (§4.5).
 *   • **تقرير صادر** (`documents`) — وثيقة مرقّمة بلقطة مجمّدة لحظة إصدارها، لا تتغيّر
 *     بتغيّر البيانات ولا بتعديل القالب.
 *   • **تعريف تقرير** (`lib/reports/catalog`) — تقرير جاهز مبني في المنصة، لا يملكه أحد
 *     ولا يُحذف.
 *   • **عرض مرشَّح على الشاشة** — حالة عابرة في عنوان URL، تُحفظ للجلسة لا في القاعدة.
 *
 * ── الملكية والظهور ─────────────────────────────────────────────────────────
 * `visibility` قيمتها إحدى ثلاث: «خاص» لصاحبه وحده، «مشترك» لكل من يملك صلاحية التقرير
 * الأصلي، «عام» يديره المدير أو مسؤول النظام. الصلاحية تُفحص دائماً على **التقرير
 * المصدر** أيضاً: قالب مشترك لتقرير أداء فردي لا يفتح لأحد ما أغلقته صلاحية التقرير.
 */
export const reportTemplates = pgTable(
  "report_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    /** مفتاح التقرير في سجل `lib/reports/catalog` — يُتحقق منه عند التشغيل لا عند القراءة */
    reportKey: text("report_key").notNull(),
    /** المرشّحات المحفوظة بشكل `ReportFilters` — تُطهَّر بالمحلّل نفسه عند التشغيل */
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    /** الأعمدة المختارة وترتيبها — الفراغ يعني كل أعمدة التقرير */
    columns: jsonb("columns").$type<string[]>().notNull().default([]),
    sortKey: text("sort_key"),
    sortDir: text("sort_dir"),
    groupKey: text("group_key"),
    mode: text("mode"),
    /** صيغة الإخراج المفضّلة: pdf | docx | xlsx | csv — تلميح لا قيد */
    outputFormat: text("output_format"),
    /** خاص | مشترك | عام */
    visibility: text("visibility").notNull().default("خاص"),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("report_templates_owner_idx").on(t.ownerUserId),
    index("report_templates_visibility_idx").on(t.visibility),
  ],
);

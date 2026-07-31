/**
 * جداول المساعد الذكي — خاملة منذ v2.3 (D-035): أُزيل كل مسار التشغيل، وتبقى
 * الجداول وتعريفاتها كما هي حفاظاً على البيانات القائمة ولأن حذفها ترحيل مدمّر.
 * لا شيء في التطبيق يقرؤها أو يكتبها.
 */
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./core";

/** محادثات مساعد المدير الذكي — لكل مستخدم محادثاته الخاصة، وتحذف وفق سياسة الاحتفاظ */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull().default("محادثة جديدة"),
    /** سياق الصفحة التي بدأت منها المحادثة (نوع الكيان ومعرفه) */
    contextType: text("context_type"),
    contextId: uuid("context_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.userId, t.lastMessageAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | tool | error
    content: text("content").notNull(),
    /** المزود والنموذج المستخدمان فعلياً في هذا الرد */
    provider: text("provider"),
    model: text("model"),
    local: boolean("local"),
    /** المصادر الداخلية المستشهد بها: [{title, href}] */
    sources: jsonb("sources").$type<{ title: string; href: string }[]>(),
    /** أسماء الأدوات التي استُخدمت لإنتاج الرد */
    toolsUsed: jsonb("tools_used").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * مقترحات الإجراءات الكتابية — كل إجراء كتابي يمر بمعاينة مفصلة ثم تأكيد صريح من المستخدم،
 * مع مفتاح تفرد يمنع التنفيذ المكرر، وإعادة فحص الصلاحية لحظة التنفيذ لا لحظة الاقتراح فقط.
 */
export const aiActionProposals = pgTable(
  "ai_action_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => aiConversations.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    toolName: text("tool_name").notNull(),
    args: jsonb("args").notNull(),
    /** معاينة مفصلة بنداً بنداً تُعرض قبل التأكيد */
    preview: jsonb("preview").$type<{ label: string; value: string }[]>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("بانتظار التأكيد"), // بانتظار التأكيد | منفذ | ملغي | فشل
    result: jsonb("result").$type<{ message: string; links: { title: string; href: string }[] } | { error: string }>(),
    provider: text("provider"),
    model: text("model"),
    /** نص طلب المستخدم الذي ولد هذا الاقتراح — للتدقيق */
    promptText: text("prompt_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ai_proposals_idempotency_unique").on(t.idempotencyKey),
    index("ai_proposals_user_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * مسودات المساعد — نصوص مقترحة (محاضر، جداول أعمال، تقارير، ملخصات…) يراجعها المدير
 * وينقلها يدوياً إلى السجلات الرسمية. المساعد لا يمس السجل الرسمي إطلاقاً.
 */
export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(), // جدول أعمال | محضر اجتماع | قرارات وتوصيات | تحديث برنامج | وصف شاهد | ملخص أداء | خطة تحسين | تقرير تنفيذي | ملخص فحص | بلاغ صيانة | مسودة بريد | أخرى
    title: text("title").notNull(),
    content: text("content").notNull(),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_drafts_user_idx").on(t.userId, t.createdAt)],
);

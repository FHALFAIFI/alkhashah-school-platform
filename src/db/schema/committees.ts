import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { storedFiles, documents } from "./shared";
import { people } from "./school";
import { planYears } from "./plan";

/** قوالب اللجان والفرق ومجتمعات التعلم — من ملف 1447 (بدون أعضاء) */
export const committeeTemplates = pgTable("committee_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  nameAr: text("name_ar").notNull(),
  kind: text("kind").notNull(), // لجنة | فريق | مجتمع تعلم
  goal: text("goal"),
  duties: jsonb("duties").$type<string[]>(),
  /** مقاعد القالب: مسميات وظيفية وأدوار فقط */
  seats: jsonb("seats").$type<{ position: string; role: string }[]>(),
  /** weekly | monthly | term | on_demand | none */
  recurrence: text("recurrence").notNull().default("none"),
  recurrenceNote: text("recurrence_note"),
  linkedToKey: text("linked_to_key"),
  meetingRules: text("meeting_rules"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** التشكيلات السنوية */
export const committees = pgTable(
  "committees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").references(() => committeeTemplates.id),
    planYearId: uuid("plan_year_id").notNull().references(() => planYears.id),
    nameAr: text("name_ar").notNull(),
    kind: text("kind").notNull(),
    goal: text("goal"),
    duties: jsonb("duties").$type<string[]>(),
    recurrence: text("recurrence").notNull().default("none"),
    /** مجتمعات التعلم: أهداف ومخرجات */
    objectives: text("objectives"),
    outputs: text("outputs"),
    status: text("status").notNull().default("مسودة"), // مسودة | معتمدة | مقفلة
    version: integer("version").notNull().default(1),
    formationDocId: uuid("formation_doc_id").references(() => documents.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("committees_year_idx").on(t.planYearId)],
);

/** أعضاء التشكيل — تسجيل عند التشكيل فقط، لا حضور ولا غياب */
export const committeeMembers = pgTable(
  "committee_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    committeeId: uuid("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => people.id),
    position: text("position"),
    role: text("role").notNull().default("عضو"), // رئيس | نائب | مقرر | عضو | قائد
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("committee_members_committee_idx").on(t.committeeId)],
);

/** الاجتماعات */
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    committeeId: uuid("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull().default(1),
    title: text("title"),
    meetingDate: timestamp("meeting_date", { withTimezone: true }),
    location: text("location"),
    agenda: jsonb("agenda").$type<string[]>(),
    discussion: text("discussion"),
    status: text("status").notNull().default("مسودة"), // مسودة | بانتظار التوقيع | مكتمل
    minutesDocId: uuid("minutes_doc_id").references(() => documents.id),
    /** المحضر الموقع (الرئيس والمقرر فقط) — شرط الاكتمال */
    signedMinutesFileId: uuid("signed_minutes_file_id").references(() => storedFiles.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meetings_committee_idx").on(t.committeeId)],
);

/** نتائج الاجتماع: قرار (إجراء إلزامي) | توصية (إجراء اختياري) | ملاحظة */
export const meetingOutcomes = pgTable(
  "meeting_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    outcomeType: text("outcome_type").notNull(), // قرار | توصية | ملاحظة
    text: text("text").notNull(),
    taskId: uuid("task_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outcomes_meeting_idx").on(t.meetingId)],
);

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
import { importBatches } from "./shared";

/** المدرسة — مجمع واحد */
export const school = pgTable("school", {
  id: uuid("id").primaryKey().defaultRandom(),
  nameAr: text("name_ar").notNull(),
  region: text("region"),
  office: text("office"),
  lat: text("lat"),
  lng: text("lng"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** المراحل الدراسية */
export const stages = pgTable("stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // primary | middle | secondary
  nameAr: text("name_ar").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** سجل الأشخاص — معلم / موظف */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    /**
     * التصنيف المصدري كما ورد في الاستيراد الرسمي: معلم | موظف.
     * لا تُعاد كتابة قيمه — دفعة فارس في «معاينة» معبَّر عنها بهذه الرموز.
     */
    category: text("category").notNull(), // معلم | موظف
    /**
     * نوع الموظف المعتمد في نطاق المنتج: «معلم» | «موظف إداري».
     * عمود إضافي (D-019): يُشتق من `category` عند القراءة إن كان فارغاً، فلا يُعدَّل أي صف قائم.
     */
    employeeType: text("employee_type"),
    jobTitle: text("job_title"),
    cadre: text("cadre"),
    employmentStatus: text("employment_status"),
    jobNumber: text("job_number"),
    orgUnit: text("org_unit"),
    email: text("email"),
    active: boolean("active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivateReason: text("deactivate_reason"),
    suggestedModelKey: text("suggested_model_key"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("people_category_idx").on(t.category), index("people_batch_idx").on(t.importBatchId)],
);

/** ربط الأشخاص بالمراحل (شخص قد يخدم أكثر من مرحلة) */
export const personStages = pgTable(
  "person_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").notNull().references(() => stages.id, { onDelete: "cascade" }),
  },
  (t) => [index("person_stages_person_idx").on(t.personId)],
);

/** التقاويم — الدراسي (هجري) والميلادي */
export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // academic-1448-1449 | gregorian-2026
  nameAr: text("name_ar").notNull(),
  calendarType: text("calendar_type").notNull(), // academic | gregorian
  status: text("status").notNull().default("مسودة"), // مسودة | معتمد | مؤرشف
  importBatchId: uuid("import_batch_id").references(() => importBatches.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** أحداث التقويم — النص الهجري الرسمي يحفظ حرفياً */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    calendarId: uuid("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    nameAr: text("name_ar").notNull(),
    dayText: text("day_text"),
    /** verbatim official Hijri strings, e.g. 1448/3/10 */
    hijriFrom: text("hijri_from"),
    hijriTo: text("hijri_to"),
    /** verbatim official Gregorian text from source */
    gregorianText: text("gregorian_text"),
    /** parsed ISO dates for computation (nullable when source says يُعتمد هجرياً) */
    gregFrom: text("greg_from"),
    gregTo: text("greg_to"),
    impact: text("impact"),
    schoolAction: text("school_action"),
    isHoliday: boolean("is_holiday").notNull().default(false),
    /** anchor keys: teacher_return | admin_return | students_start | plan_end ... */
    anchorKey: text("anchor_key"),
  },
  (t) => [index("calendar_events_cal_idx").on(t.calendarId)],
);

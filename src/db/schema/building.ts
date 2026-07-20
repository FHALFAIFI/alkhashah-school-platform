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
import { storedFiles } from "./shared";

/**
 * مناطق الموقع: مجمع البنين (managed) ومجمع البنات (context — سياق جغرافي فقط،
 * يحرم على مستوى الخادم إنشاء غرف/أصول/سجلات فيه).
 */
export const siteZones = pgTable("site_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // boys | girls
  nameAr: text("name_ar").notNull(),
  zoneType: text("zone_type").notNull(), // managed | context
  /** boundary polygon in site meters coordinate system */
  boundary: jsonb("boundary").$type<{ x: number; y: number }[]>(),
});

/** الطوابق + الموقع الخارجي (level = -1 للموقع الخارجي) */
export const floors = pgTable("floors", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // site | ground | first | second | third
  nameAr: text("name_ar").notNull(),
  level: integer("level").notNull(),
  zoneKey: text("zone_key").notNull().default("boys"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * نسخ الهندسة — التاريخ الكامل. geometry: { rooms: [{key,name,type,points[],doors[]}], walls: [...] }
 * بوحدة المتر. النشر لا يعدل النسخ السابقة.
 */
export const floorGeometryVersions = pgTable(
  "floor_geometry_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorId: uuid("floor_id").notNull().references(() => floors.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    geometry: jsonb("geometry").notNull(),
    status: text("status").notNull().default("مسودة"), // مسودة | منشورة | مؤرشفة
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("geometry_floor_version_unique").on(t.floorId, t.version)],
);

/** خلفيات المخطط (صور مصدرية/جوية) — تحويلها لا يمس الهندسة المتجهة */
export const floorBackgrounds = pgTable("floor_backgrounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  floorId: uuid("floor_id").notNull().references(() => floors.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").notNull().references(() => storedFiles.id),
  /** {x, y, scale, rotation, opacity, visible} */
  transform: jsonb("transform").notNull(),
  active: boolean("active").notNull().default(true),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** الغرف والمرافق — سجل تشغيلي مرتبط بمفتاح الغرفة داخل الهندسة */
export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorId: uuid("floor_id").notNull().references(() => floors.id),
    /** stable key matching geometry room key */
    geomKey: text("geom_key").notNull(),
    code: text("code").notNull().unique(), // KHS-RM-0001
    nameAr: text("name_ar").notNull(),
    roomType: text("room_type").notNull(), // فصل | معمل | مكتب | مستودع | دورة مياه | ملعب | ساحة | بوابة | مخرج طوارئ | مرفق
    lengthM: numeric("length_m"),
    widthM: numeric("width_m"),
    areaM2: numeric("area_m2"),
    perimeterM: numeric("perimeter_m"),
    capacity: integer("capacity"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rooms_floor_geomkey_unique").on(t.floorId, t.geomKey)],
);

/** الأصول والعهدة */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(), // KHS-AST-0001 (prefix configurable)
    nameAr: text("name_ar").notNull(),
    category: text("category"),
    roomId: uuid("room_id").references(() => rooms.id),
    /** أصل مهم = سجل فردي؛ الأثاث المتكرر يخزن بالكمية */
    important: boolean("important").notNull().default(false),
    serialNumber: text("serial_number"),
    quantity: integer("quantity").notNull().default(1),
    condition: text("condition").notNull().default("جيدة"), // ممتازة | جيدة | تحتاج صيانة | خارج الخدمة
    notes: text("notes"),
    importBatchId: uuid("import_batch_id"),
    active: boolean("active").notNull().default(true),
    /** دورة حياة الأصل: الأرشفة إخفاء غير مدمّر مع سبب عربي وقابلية الاستعادة.
     *  active=false مع archivedAt مضبوط = مؤرشف؛ الحذف النهائي مشروط ومحظور عند وجود تبعيات. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedReason: text("archived_reason"),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_room_idx").on(t.roomId)],
);

export const assetHistory = pgTable(
  "asset_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    detail: text("detail"),
    actorId: uuid("actor_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_history_asset_idx").on(t.assetId)],
);

/**
 * قوالب الفحص — عائلة إصدارات (code ثابت + rootId + version تصاعدي).
 * status: مسودة | معتمد (=مُفعّل/قابل للاستخدام) | معطّل. `sections` هي المصدر الغني للتحرير
 * والمعاينة والتجميد؛ `items` قائمة مسطّحة مشتقة للتوافق مع الفحص/الجاهزية/عدم الاتصال.
 */
export const inspectionTemplates = pgTable("inspection_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code"), // KHS-TPL-0001 — ثابت عبر إصدارات العائلة
  rootId: uuid("root_id"), // معرّف أول إصدار في العائلة (self لأول إصدار)
  version: integer("version").notNull().default(1),
  nameAr: text("name_ar").notNull(),
  roomType: text("room_type"),
  purpose: text("purpose"),
  instructions: text("instructions"),
  items: jsonb("items").$type<{ key: string; label: string; required: boolean }[]>().notNull(),
  sections: jsonb("sections").$type<unknown[]>(),
  assignment: jsonb("assignment").$type<Record<string, unknown>>(),
  isSystem: boolean("is_system").notNull().default(false),
  status: text("status").notNull().default("مسودة"), // مسودة | معتمد | معطّل
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** عمليات الفحص — تدعم الالتقاط دون اتصال (clientOpId يمنع التكرار عند المزامنة) */
export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOpId: text("client_op_id").unique(),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    templateId: uuid("template_id").references(() => inspectionTemplates.id),
    inspectionDate: timestamp("inspection_date", { withTimezone: true }).notNull().defaultNow(),
    results: jsonb("results").$type<{ key: string; ok: boolean; note?: string }[]>(),
    photos: jsonb("photos").$type<string[]>(), // stored file ids
    /** تجميد تاريخي: نسخة القالب المستخدَمة وقت الفحص — لا تغيّرها تعديلات القالب اللاحقة. */
    templateSnapshot: jsonb("template_snapshot").$type<unknown>(),
    templateVersion: integer("template_version"),
    status: text("status").notNull().default("مكتمل"),
    scheduled: boolean("scheduled").notNull().default(false),
    inspectorId: uuid("inspector_id").references(() => users.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inspections_room_idx").on(t.roomId)],
);

/** جدولة الفحص الدوري */
export const inspectionSchedules = pgTable("inspection_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => inspectionTemplates.id),
  roomType: text("room_type"),
  recurrence: text("recurrence").notNull(), // weekly | monthly | term
  nextDue: text("next_due"),
  active: boolean("active").notNull().default(true),
});

/** بلاغات الصيانة — سير عمل بسيط */
export const maintenanceIssues = pgTable(
  "maintenance_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOpId: text("client_op_id").unique(),
    code: text("code").notNull().unique(), // KHS-MNT-0001
    title: text("title").notNull(),
    description: text("description"),
    roomId: uuid("room_id").references(() => rooms.id),
    assetId: uuid("asset_id").references(() => assets.id),
    priority: text("priority").notNull().default("متوسطة"),
    status: text("status").notNull().default("مفتوح"), // مفتوح | قيد الإصلاح | تم الإصلاح | مغلق ومتحقق
    photos: jsonb("photos").$type<string[]>(),
    ownerPersonId: uuid("owner_person_id"),
    repairNote: text("repair_note"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    reportedBy: uuid("reported_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("maintenance_room_idx").on(t.roomId), index("maintenance_status_idx").on(t.status)],
);

/** تجاوز الجاهزية — بسبب مسجل إلزامي */
export const readinessOverrides = pgTable("readiness_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  overrideValue: integer("override_value").notNull(),
  reason: text("reason").notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

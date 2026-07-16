/**
 * البذرة الإنتاجية النظيفة — idempotent: يعاد تشغيلها بأمان دون تكرار.
 * البيانات التجريبية توضع في seed-demo.ts منفصلة.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import {
  users, roles, permissions, rolePermissions, userRoles, settings,
  school, stages, calendars, calendarEvents,
  committeeTemplates, storedFiles, siteZones, floors, inspectionTemplates,
} from "./schema";
import { permissionsSeed, rolesSeed } from "./seed-data/permissions";
import { committeeTemplatesSeed } from "./seed-data/committee-templates";
import { calendar1448Seed } from "./seed-data/calendar-1448-1449";
import { seedOfficialPerfModels } from "./seed-official-models";

const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function seedRbac() {
  for (const p of permissionsSeed) {
    await db.insert(permissions).values(p).onConflictDoNothing({ target: permissions.key });
  }
  const allPerms = await db.select().from(permissions);
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  for (const r of rolesSeed) {
    await db
      .insert(roles)
      .values({ key: r.key, nameAr: r.nameAr, system: r.system })
      .onConflictDoNothing({ target: roles.key });
    const [role] = await db.select().from(roles).where(eq(roles.key, r.key));
    for (const pk of r.permissions) {
      const pid = permByKey.get(pk);
      if (!pid) continue;
      await db.insert(rolePermissions).values({ roleId: role.id, permissionId: pid }).onConflictDoNothing();
    }
  }
}

async function seedUsers(): Promise<string[]> {
  const lines: string[] = [];
  const defs = [
    { username: "principal", displayName: "مدير المدرسة", roleKey: "principal" },
    { username: "admin", displayName: "مسؤول النظام", roleKey: "sysadmin" },
  ];
  for (const d of defs) {
    const existing = await db.select().from(users).where(eq(users.username, d.username));
    if (existing.length > 0) continue;
    const password = randomBytes(9).toString("base64url");
    const passwordHash = await hash(password, ARGON_OPTS);
    const [u] = await db
      .insert(users)
      .values({ username: d.username, displayName: d.displayName, passwordHash })
      .returning();
    const [role] = await db.select().from(roles).where(eq(roles.key, d.roleKey));
    await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
    lines.push(`${d.displayName} — اسم المستخدم: ${d.username} — كلمة المرور المؤقتة: ${password}`);
  }
  return lines;
}

async function seedSchool() {
  const existing = await db.select().from(school);
  if (existing.length === 0) {
    await db.insert(school).values({
      nameAr: "مجمع الخشعة التعليمي للبنين",
      region: "إدارة التعليم في محافظة صبيا",
      office: "مكتب تعليم العيدابي",
      lat: "17.2484051",
      lng: "43.0609594",
    });
  }
  const stageDefs = [
    { key: "primary", nameAr: "المرحلة الابتدائية", sortOrder: 1 },
    { key: "middle", nameAr: "المرحلة المتوسطة", sortOrder: 2 },
    { key: "secondary", nameAr: "المرحلة الثانوية", sortOrder: 3 },
  ];
  for (const s of stageDefs) {
    await db.insert(stages).values(s).onConflictDoNothing({ target: stages.key });
  }
}

async function seedCalendar() {
  const existing = await db.select().from(calendars).where(eq(calendars.key, calendar1448Seed.key));
  if (existing.length > 0) return;
  const [cal] = await db
    .insert(calendars)
    .values({
      key: calendar1448Seed.key,
      nameAr: calendar1448Seed.nameAr,
      calendarType: "academic",
      status: "معتمد",
    })
    .returning();
  let i = 0;
  for (const ev of calendar1448Seed.events) {
    await db.insert(calendarEvents).values({ calendarId: cal.id, sortOrder: i++, ...ev });
  }
}

async function seedCommitteeTemplates() {
  for (const t of committeeTemplatesSeed) {
    await db
      .insert(committeeTemplates)
      .values({
        key: t.key,
        nameAr: t.nameAr,
        kind: t.kind,
        goal: t.goal,
        duties: t.duties,
        seats: t.seats,
        recurrence: t.recurrence,
        recurrenceNote: t.recurrenceNote,
        linkedToKey: t.linkedToKey ?? null,
        meetingRules: t.meetingRules,
      })
      .onConflictDoNothing({ target: committeeTemplates.key });
  }
}

async function seedZonesAndFloors() {
  const zones = [
    { key: "boys", nameAr: "مجمع البنين", zoneType: "managed" },
    { key: "girls", nameAr: "مجمع البنات (سياق جغرافي فقط)", zoneType: "context" },
  ];
  for (const z of zones) await db.insert(siteZones).values(z).onConflictDoNothing({ target: siteZones.key });
  const floorDefs = [
    { key: "site", nameAr: "الموقع الخارجي", level: -1, sortOrder: 0 },
    { key: "ground", nameAr: "الدور الأرضي", level: 0, sortOrder: 1 },
    { key: "first", nameAr: "الدور الأول", level: 1, sortOrder: 2 },
    { key: "second", nameAr: "الدور الثاني", level: 2, sortOrder: 3 },
    { key: "third", nameAr: "الدور الثالث", level: 3, sortOrder: 4 },
  ];
  for (const f of floorDefs) await db.insert(floors).values(f).onConflictDoNothing({ target: floors.key });
}

async function seedSettings() {
  const defaults: Record<string, unknown> = {
    "app.name": "منصة الإدارة المدرسية المتكاملة",
    "assets.code_prefix": "KHS-AST-",
    "rooms.code_prefix": "KHS-RM-",
    "maintenance.code_prefix": "KHS-MNT-",
    "documents.number_prefix": "KHS-DOC-",
    "performance.followup_target": 5,
    "branding.signature_default": false,
    "branding.stamp_default": false,
    "ai.enabled": false,
    "ai.provider": "ollama",
    "m365.enabled": false,
    "backup.daily_retention": 14,
    "backup.weekly_retention": 8,
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing({ target: settings.key });
  }
}

/** استيراد التوقيع والختم من الملفات المرجعية إلى التخزين الخاص — خارج Git دائماً */
async function seedBranding() {
  const refDir = path.resolve("reference_files");
  const brandingDir = path.join(STORAGE_DIR, "private", "branding");
  mkdirSync(brandingDir, { recursive: true });
  const items = [
    { src: "WhatsApp Image 2026-07-15 at 9.23.26 PM.jpeg", dest: "signature.jpeg", label: "توقيع المدير", key: "branding.signature_file" },
    { src: "WhatsApp Image 2026-07-15 at 9.23.25 PM.jpeg", dest: "stamp.jpeg", label: "ختم المدرسة", key: "branding.stamp_file" },
  ];
  for (const item of items) {
    const srcPath = path.join(refDir, item.src);
    const destPath = path.join(brandingDir, item.dest);
    if (!existsSync(srcPath)) {
      console.warn(`تنبيه: الملف المرجعي غير موجود: ${item.src} — يمكن رفعه لاحقاً من الإعدادات.`);
      continue;
    }
    if (!existsSync(destPath)) copyFileSync(srcPath, destPath);
    const relPath = path.join("private", "branding", item.dest);
    const existing = await db.select().from(storedFiles).where(eq(storedFiles.storagePath, relPath));
    if (existing.length === 0) {
      const { createHash } = await import("node:crypto");
      const { readFileSync, statSync } = await import("node:fs");
      const buf = readFileSync(destPath);
      const [f] = await db
        .insert(storedFiles)
        .values({
          originalName: item.dest,
          mime: "image/jpeg",
          size: statSync(destPath).size,
          sha256: createHash("sha256").update(buf).digest("hex"),
          storagePath: relPath,
          scope: "branding",
          sensitive: true,
        })
        .returning();
      await db
        .insert(settings)
        .values({ key: item.key, value: f.id })
        .onConflictDoUpdate({ target: settings.key, set: { value: f.id } });
    }
  }
}

/** قوالب فحص أولية حسب نوع الغرفة — تبقى مسودات حتى اعتماد المدير */
async function seedInspectionTemplates() {
  const existing = await db.select().from(inspectionTemplates);
  if (existing.length > 0) return;
  const t = (key: string, label: string, required = true) => ({ key, label, required });
  const defs: { nameAr: string; roomType: string | null; items: { key: string; label: string; required: boolean }[] }[] = [
    {
      nameAr: "فحص الفصل الدراسي",
      roomType: "فصل دراسي",
      items: [
        t("lighting", "الإضاءة تعمل بالكامل"),
        t("ac", "التكييف يعمل"),
        t("board", "السبورة سليمة"),
        t("seats", "المقاعد والطاولات كافية وسليمة"),
        t("windows", "النوافذ والأبواب سليمة"),
        t("cleanliness", "النظافة العامة مقبولة"),
        t("electrical", "الأفياش والتمديدات الكهربائية آمنة"),
      ],
    },
    {
      nameAr: "فحص المعمل",
      roomType: "معمل",
      items: [
        t("devices", "الأجهزة تعمل"),
        t("safety", "أدوات السلامة متوفرة (طفاية، إسعافات)"),
        t("network", "الشبكة/الإنترنت تعمل", false),
        t("ventilation", "التهوية سليمة"),
        t("storage", "تخزين المواد آمن"),
        t("electrical", "التمديدات الكهربائية آمنة"),
      ],
    },
    {
      nameAr: "فحص دورات المياه",
      roomType: "دورة مياه",
      items: [
        t("water", "المياه متوفرة"),
        t("drainage", "التصريف سليم"),
        t("doors", "الأبواب والأقفال سليمة"),
        t("cleanliness", "النظافة مقبولة"),
        t("ventilation", "التهوية سليمة"),
      ],
    },
    {
      nameAr: "فحص الملعب والساحات",
      roomType: "ملعب",
      items: [
        t("surface", "أرضية الملعب سليمة وخالية من المخاطر"),
        t("goals", "المرامي/التجهيزات مثبتة بأمان"),
        t("shade", "المظلات سليمة", false),
        t("fencing", "الأسوار سليمة"),
      ],
    },
    {
      nameAr: "فحص السلامة العام",
      roomType: null,
      items: [
        t("extinguisher", "طفايات الحريق متوفرة وصالحة"),
        t("exit", "مخارج الطوارئ سالكة ومعلمة"),
        t("alarm", "جهاز الإنذار يعمل", false),
        t("firstaid", "حقيبة الإسعافات متوفرة"),
        t("hazards", "لا مخاطر ظاهرة (تمديدات، زجاج مكسور، تسريبات)"),
      ],
    },
  ];
  for (const d of defs) {
    await db.insert(inspectionTemplates).values({ nameAr: d.nameAr, roomType: d.roomType, items: d.items, status: "مسودة" });
  }
}

async function main() {
  await seedRbac();
  const credLines = await seedUsers();
  await seedSchool();
  await seedCalendar();
  await seedOfficialPerfModels();
  await seedCommitteeTemplates();
  await seedZonesAndFloors();
  await seedSettings();
  await seedInspectionTemplates();
  await seedBranding();

  if (credLines.length > 0) {
    const credDir = path.join(STORAGE_DIR, "private");
    mkdirSync(credDir, { recursive: true });
    const credFile = path.join(credDir, "initial-credentials.txt");
    writeFileSync(credFile, credLines.join("\n") + "\n", { mode: 0o600 });
    console.log("تم إنشاء الحسابات الأولية. كلمات المرور المؤقتة محفوظة في:", credFile);
    for (const l of credLines) console.log("  ", l);
  }
  console.log("اكتملت البذرة الإنتاجية.");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

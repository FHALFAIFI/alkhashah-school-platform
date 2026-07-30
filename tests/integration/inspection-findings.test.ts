import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.3 §16-17 — التسجيل الموحّد للفحص:
 *  - لقطة القالب تُجمَّد في المسارين (المتصل وغير المتصل) — كانت المزامنة تُسقطها.
 *  - البنود الفاشلة تنشئ «ملاحظات فحص» بخطورتها من القالب (حرج ⇒ critical).
 *  - إعادة الإرسال بنفس clientOpId لا تكرر الفحص ولا الملاحظات.
 *  - مطابقة قالب ↔ غرفة عبر سجل الأنواع تحل «مختبر» على «معمل» (D-037).
 */

let pool: Pool;
let testUserId = "";
let roomId = "";
let templateId = "";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const SECTIONS = [
  {
    key: "safety",
    title: "السلامة",
    items: [
      { key: "exit", label: "مخرج الطوارئ سالك", required: true, responseType: "yes_no", severityOnFail: "حرج" },
      { key: "light", label: "الإضاءة تعمل", required: true, responseType: "yes_no", severityOnFail: "متوسط" },
      { key: "clean", label: "النظافة مقبولة", required: false, responseType: "yes_no" },
    ],
  },
];

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, siteZones, floors, rooms, inspectionTemplates } = await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: "t-insp", displayName: "فاحص", passwordHash: "x" }).returning();
  testUserId = u.id;
  const { ensureSystemRoomTypes } = await import("@/lib/building/room-types-seed");
  await ensureSystemRoomTypes();
  await db.insert(siteZones).values({ key: "boys", nameAr: "مجمع البنين", zoneType: "managed" }).onConflictDoNothing();
  const [floor] = await db.insert(floors).values({ key: "g", nameAr: "الأرضي", level: 0, zoneKey: "boys", sortOrder: 0 }).returning();
  const [room] = await db
    .insert(rooms)
    .values({ floorId: floor.id, geomKey: "r1", code: "KHS-RM-0001", nameAr: "معمل العلوم", roomType: "معمل" })
    .returning();
  roomId = room.id;

  const flat = SECTIONS[0].items.map((i) => ({ key: i.key, label: i.label, required: i.required }));
  const [tpl] = await db
    .insert(inspectionTemplates)
    .values({
      nameAr: "قالب المختبر",
      roomType: "مختبر علوم",
      items: flat,
      sections: SECTIONS,
      status: "معتمد",
      version: 3,
    })
    .returning();
  templateId = tpl.id;
});

afterAll(async () => {
  await pool.end();
});

describe("recordInspection", () => {
  it("يجمّد اللقطة وينشئ ملاحظات للبنود الفاشلة بخطورتها — والحرج critical", async () => {
    const { db } = await import("@/db");
    const { inspections, inspectionFindings, inspectionTemplates } = await import("@/db/schema");
    const { recordInspection } = await import("@/lib/building/inspection-recording");

    const [template] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
    const { inspectionId } = await recordInspection({
      roomId,
      template,
      results: [
        { key: "exit", ok: false, note: "الباب مقفول بسلسلة" },
        { key: "light", ok: false },
        { key: "clean", ok: true },
      ],
      inspectorId: testUserId,
    });
    expect(inspectionId).not.toBeNull();

    const [ins] = await db.select().from(inspections).where(eq(inspections.id, inspectionId!));
    expect(ins.templateVersion).toBe(3);
    expect(Array.isArray(ins.templateSnapshot)).toBe(true);

    const findings = await db
      .select()
      .from(inspectionFindings)
      .where(eq(inspectionFindings.inspectionId, inspectionId!));
    expect(findings).toHaveLength(2);
    const exit = findings.find((f) => f.itemKey === "exit")!;
    expect(exit.severity).toBe("حرج");
    expect(exit.critical).toBe(true);
    expect(exit.label).toBe("مخرج الطوارئ سالك");
    expect(exit.note).toBe("الباب مقفول بسلسلة");
    const light = findings.find((f) => f.itemKey === "light")!;
    expect(light.severity).toBe("متوسط");
    expect(light.critical).toBe(false);
  });

  it("إعادة الإرسال بنفس clientOpId لا تكرر الفحص ولا الملاحظات (idempotent)", async () => {
    const { db } = await import("@/db");
    const { inspectionFindings, inspectionTemplates } = await import("@/db/schema");
    const { recordInspection } = await import("@/lib/building/inspection-recording");

    const [template] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
    const opId = `test-op-${Math.random().toString(36).slice(2, 10)}`;
    const first = await recordInspection({
      roomId,
      template,
      results: [{ key: "exit", ok: false }],
      inspectorId: testUserId,
      clientOpId: opId,
    });
    expect(first.inspectionId).not.toBeNull();

    const second = await recordInspection({
      roomId,
      template,
      results: [{ key: "exit", ok: false }],
      inspectorId: testUserId,
      clientOpId: opId,
    });
    expect(second.inspectionId).toBeNull();

    const findings = await db
      .select()
      .from(inspectionFindings)
      .where(eq(inspectionFindings.inspectionId, first.inspectionId!));
    expect(findings).toHaveLength(1);
  });
});

describe("مطابقة الأنواع عبر السجل (D-037)", () => {
  it("«مختبر علوم» في القالب يطابق «معمل» في الغرفة عبر الأسماء التاريخية", async () => {
    const { db } = await import("@/db");
    const { roomTypes } = await import("@/db/schema");
    const { templateAppliesToRoom } = await import("@/lib/building/room-types");

    const registry = (await db.select().from(roomTypes)).map((t) => ({
      key: t.key,
      labelAr: t.labelAr,
      aliases: t.aliases,
      active: t.active,
    }));
    expect(registry.length).toBeGreaterThanOrEqual(24);

    expect(templateAppliesToRoom("مختبر علوم", "معمل", registry)).toBe(true);
    expect(templateAppliesToRoom("مختبر", "معمل", registry)).toBe(true);
    expect(templateAppliesToRoom("مختبر حاسب", "معمل", registry)).toBe(false);
    expect(templateAppliesToRoom("دورات المياه", "دورة مياه", registry)).toBe(false); // نص غير معروف لا يُختلق له حل
    expect(templateAppliesToRoom("دورة مياه", "دورات مياه", registry)).toBe(true); // الاسم التاريخي في aliases
    expect(templateAppliesToRoom(null, "أي نوع", registry)).toBe(true); // قالب عام
    expect(templateAppliesToRoom("فصل دراسي", "فصل دراسي", registry)).toBe(true);
  });
});

describe("ترحيل حالات البلاغات (D-036)", () => {
  it("لا تبقى أي حالة قديمة بعد الترحيل — والمفردات الجديدة فقط", async () => {
    const { db } = await import("@/db");
    const { maintenanceIssues } = await import("@/db/schema");
    const rows = await db.select({ status: maintenanceIssues.status }).from(maintenanceIssues);
    const legacy = ["مفتوح", "قيد الإصلاح", "مغلق ومتحقق"];
    for (const r of rows) {
      expect(legacy).not.toContain(r.status);
    }
  });
});

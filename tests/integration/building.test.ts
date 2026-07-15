import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

const fakeUser = () => ({
  id: testUserId,
  username: "t",
  displayName: "اختبار",
  personId: null,
  permissions: new Set([
    "building.read", "building.write", "building.publish",
    "assets.read", "assets.write", "inspections.read", "inspections.write",
    "maintenance.read", "maintenance.write",
  ]),
  csrfToken: "csrf-test-token",
  sessionId: "x",
});

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => fakeUser()),
  requireUser: vi.fn(async () => fakeUser()),
  getCurrentUser: vi.fn(async () => fakeUser()),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, siteZones, floors } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-bld", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
  await db.insert(siteZones).values([
    { key: "boys", nameAr: "مجمع البنين", zoneType: "managed" },
    { key: "girls", nameAr: "مجمع البنات", zoneType: "context" },
  ]);
  await db.insert(floors).values([
    { key: "ground", nameAr: "الدور الأرضي", level: 0, zoneKey: "boys", sortOrder: 1 },
    { key: "girls-area", nameAr: "منطقة البنات", level: 0, zoneKey: "girls", sortOrder: 9 },
  ]);
});

afterAll(async () => {
  await pool.end();
});

const sampleGeometry = (name = "غرفة الاختبار", w = 5, h = 7) => ({
  unit: "m",
  rooms: [{ key: "r1", name, type: "فصل دراسي", x: 0, y: 0, w, h }],
});

describe("التوأم الرقمي (A11, A12, A14)", () => {
  it("A11: تعديل الاسم والأبعاد يحفظ في نسخة هندسة جديدة ويزامن سجل الغرف عند النشر", async () => {
    const { db } = await import("@/db");
    const { floors, floorGeometryVersions, rooms } = await import("@/db/schema");
    const { saveGeometryDraftAction, publishGeometryAction } = await import("@/app/(app)/building/actions");
    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));

    // نسخة 1
    const r1 = await saveGeometryDraftAction(ground.id, JSON.stringify(sampleGeometry("فصل أ", 5, 7)));
    expect(r1?.error).toBeUndefined();
    // نسخة 2: تغيير الاسم والبعد (المسار نفسه سواء عدل الحقل أو سحب الرسم — ثنائي الاتجاه)
    const r2 = await saveGeometryDraftAction(ground.id, JSON.stringify(sampleGeometry("فصل أ المعدل", 6.5, 7)));
    expect(r2?.error).toBeUndefined();

    const versions = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    expect(versions.length).toBe(2);
    expect(Math.max(...versions.map((v) => v.version))).toBe(2);

    // النشر يزامن سجل الغرف بالاسم والأبعاد والمساحة والمحيط
    const latest = versions.find((v) => v.version === 2)!;
    const pub = await publishGeometryAction(latest.id);
    expect(pub?.error).toBeUndefined();
    const [room] = await db.select().from(rooms).where(and(eq(rooms.floorId, ground.id), eq(rooms.geomKey, "r1")));
    expect(room.nameAr).toBe("فصل أ المعدل");
    expect(Number(room.lengthM)).toBe(6.5);
    expect(Number(room.widthM)).toBe(7);
    expect(Number(room.areaM2)).toBe(45.5);
    expect(Number(room.perimeterM)).toBe(27);
    expect(room.code).toMatch(/^KHS-RM-\d{4}$/);

    // النسخة الأولى تؤرشف والثانية منشورة — التاريخ محفوظ
    const after = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    expect(after.find((v) => v.version === 2)?.status).toBe("منشورة");
  });

  it("A12: استبدال الخلفية وتحويلها لا يغيران الهندسة المتجهة", async () => {
    const { db } = await import("@/db");
    const { floors, floorGeometryVersions, floorBackgrounds, storedFiles } = await import("@/db/schema");
    const { updateBackgroundTransformAction, replaceBackgroundAction } = await import("@/app/(app)/building/actions");
    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));

    const before = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    const beforeJson = JSON.stringify(before.map((v) => ({ v: v.version, g: v.geometry })).sort((a, b) => a.v - b.v));

    // خلفية أولية
    const [f] = await db
      .insert(storedFiles)
      .values({ originalName: "bg.png", mime: "image/png", size: 10, sha256: "x", storagePath: `backgrounds/t-${Math.random()}.png` })
      .returning();
    const [bg] = await db
      .insert(floorBackgrounds)
      .values({ floorId: ground.id, fileId: f.id, transform: { x: 0, y: 0, scale: 0.05, rotation: 0, opacity: 0.6, visible: true } })
      .returning();

    // تحويل الخلفية
    await updateBackgroundTransformAction(bg.id, JSON.stringify({ x: 5, y: 3, scale: 0.08, rotation: 15, opacity: 0.4, visible: true }));

    // استبدال الخلفية بملف جديد
    const fd = new FormData();
    const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");
    fd.set("file", new File([pngBytes], "aerial-new.png", { type: "image/png" }));
    const res = await replaceBackgroundAction(ground.id, null, fd);
    expect(res?.error).toBeUndefined();

    // الهندسة المتجهة لم تتغير بتاتاً
    const after = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    const afterJson = JSON.stringify(after.map((v) => ({ v: v.version, g: v.geometry })).sort((a, b) => a.v - b.v));
    expect(afterJson).toBe(beforeJson);

    // الخلفية القديمة عطلت والجديدة نشطة
    const bgs = await db.select().from(floorBackgrounds).where(eq(floorBackgrounds.floorId, ground.id));
    expect(bgs.filter((b) => b.active).length).toBe(1);
    expect(bgs.find((b) => b.active)?.label).toBe("aerial-new.png");
  });

  it("A14: منطقة مجمع البنات (سياق) ترفض الهندسة والأصول والسجلات", async () => {
    const { db } = await import("@/db");
    const { floors, rooms } = await import("@/db/schema");
    const { saveGeometryDraftAction, createAssetAction, submitInspectionAction } = await import("@/app/(app)/building/actions");
    const [girlsFloor] = await db.select().from(floors).where(eq(floors.key, "girls-area"));

    // هندسة في منطقة السياق ترفض
    const geo = await saveGeometryDraftAction(girlsFloor.id, JSON.stringify(sampleGeometry()));
    expect(geo?.error).toContain("سياق جغرافي فقط");

    // غرفة أدخلت قسرياً في منطقة السياق — الأصل يرفض
    const [forcedRoom] = await db
      .insert(rooms)
      .values({ floorId: girlsFloor.id, geomKey: "x1", code: `KHS-RM-X${Math.floor(Math.random() * 1000)}`, nameAr: "غرفة سياق", roomType: "فصل دراسي" })
      .returning();
    const fd = new FormData();
    fd.set("nameAr", "أصل ممنوع");
    fd.set("roomId", forcedRoom.id);
    fd.set("quantity", "1");
    fd.set("condition", "جيدة");
    const asset = await createAssetAction(null, fd);
    expect(asset?.error).toContain("سياق جغرافي فقط");

    // والفحص يرفض كذلك
    const insFd = new FormData();
    insFd.set("roomId", forcedRoom.id);
    insFd.set("templateId", "123e4567-e89b-42d3-a456-426614174000");
    const ins = await submitInspectionAction(null, insFd);
    expect(ins?.error).toBeDefined();
  });

  it("حساب الجاهزية والتجاوز بسبب إلزامي", async () => {
    const { computeRoomReadiness } = await import("@/lib/building/readiness");
    const full = computeRoomReadiness({
      latestInspection: { results: [{ key: "a", ok: true }, { key: "b", ok: true }] },
      assets: [{ condition: "جيدة", important: true }],
      openIssues: 0,
    });
    expect(full.readiness).toBe(100);
    const damaged = computeRoomReadiness({
      latestInspection: { results: [{ key: "a", ok: true }, { key: "b", ok: false }] },
      assets: [{ condition: "خارج الخدمة", important: true }],
      openIssues: 2,
    });
    expect(damaged.readiness).toBeLessThan(50);
    const overridden = computeRoomReadiness({
      latestInspection: null,
      assets: [],
      openIssues: 5,
      override: { value: 90 },
    });
    expect(overridden.readiness).toBe(90);
    expect(overridden.source).toBe("تجاوز يدوي");
  });
});

describe("مزامنة الفحص دون اتصال (A13)", () => {
  it("إعادة إرسال الدفعة نفسها لا تنشئ سجلات مكررة", async () => {
    const { db } = await import("@/db");
    const { floors, rooms, inspectionTemplates, inspections } = await import("@/db/schema");
    const { POST } = await import("@/app/api/sync/inspections/route");
    const { NextRequest } = await import("next/server");

    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));
    const [room] = await db
      .insert(rooms)
      .values({ floorId: ground.id, geomKey: `sync-${Math.random()}`, code: `KHS-RM-S${Math.floor(Math.random() * 10000)}`, nameAr: "غرفة مزامنة", roomType: "فصل دراسي" })
      .returning();
    const [template] = await db
      .insert(inspectionTemplates)
      .values({ nameAr: "قالب مزامنة", roomType: null, items: [{ key: "a", label: "بند", required: true }], status: "معتمد" })
      .returning();

    const ops = [
      {
        clientOpId: `op-${Math.random().toString(36).slice(2)}-1`,
        roomId: room.id,
        templateId: template.id,
        inspectedAt: new Date().toISOString(),
        results: [{ key: "a", ok: true }],
        notes: "فحص دون اتصال",
      },
    ];
    const makeReq = () =>
      new NextRequest("http://localhost/api/sync/inspections", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" },
        body: JSON.stringify({ ops }),
      });

    const res1 = await POST(makeReq());
    const json1 = await res1.json();
    expect(json1.applied.length).toBe(1);
    expect(json1.skipped.length).toBe(0);

    // إعادة الإرسال (انقطاع اتصال ثم إعادة محاولة) — لا تكرار
    const res2 = await POST(makeReq());
    const json2 = await res2.json();
    expect(json2.applied.length).toBe(0);
    expect(json2.skipped.length).toBe(1);

    const stored = await db.select().from(inspections).where(eq(inspections.roomId, room.id));
    expect(stored.length).toBe(1);
  });

  it("المزامنة ترفض دون رمز الحماية أو في منطقة السياق", async () => {
    const { db } = await import("@/db");
    const { floors, rooms, inspectionTemplates } = await import("@/db/schema");
    const { POST } = await import("@/app/api/sync/inspections/route");
    const { NextRequest } = await import("next/server");

    // بلا رمز حماية
    const badCsrf = new NextRequest("http://localhost/api/sync/inspections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: [] }),
    });
    expect((await POST(badCsrf)).status).toBe(403);

    // غرفة في منطقة السياق
    const [girlsFloor] = await db.select().from(floors).where(eq(floors.key, "girls-area"));
    const [ctxRoom] = await db
      .insert(rooms)
      .values({ floorId: girlsFloor.id, geomKey: `g-${Math.random()}`, code: `KHS-RM-G${Math.floor(Math.random() * 10000)}`, nameAr: "سياق", roomType: "فصل دراسي" })
      .returning();
    const [template] = await db
      .insert(inspectionTemplates)
      .values({ nameAr: "قالب", roomType: null, items: [{ key: "a", label: "بند", required: true }], status: "معتمد" })
      .returning();
    const req = new NextRequest("http://localhost/api/sync/inspections", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" },
      body: JSON.stringify({
        ops: [{
          clientOpId: `ctx-${Math.random().toString(36).slice(2)}`,
          roomId: ctxRoom.id,
          templateId: template.id,
          inspectedAt: new Date().toISOString(),
          results: [{ key: "a", ok: true }],
        }],
      }),
    });
    const json = await (await POST(req)).json();
    expect(json.failed.length).toBe(1);
    expect(json.failed[0].error).toContain("سياق");
  });
});

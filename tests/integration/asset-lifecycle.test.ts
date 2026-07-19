import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Phase 2 — دورة حياة الأصل: أرشفة/استعادة غير مدمّرة + حذف نهائي محروس بالتبعيات.
 */

let pool: Pool;
let testUserId = "";
let roomId = "";

const fakeUser = () => ({
  id: testUserId,
  username: "t",
  displayName: "اختبار",
  personId: null,
  permissions: new Set(["assets.read", "assets.write", "assets.delete"]),
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
});
afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, siteZones, floors, rooms } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-ast", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
  await db.insert(siteZones).values({ key: "boys", nameAr: "مجمع البنين", zoneType: "managed" });
  const [floor] = await db
    .insert(floors)
    .values({ key: "ground", nameAr: "الدور الأرضي", level: 0, zoneKey: "boys", sortOrder: 1 })
    .returning();
  const [room] = await db
    .insert(rooms)
    .values({ code: "KHS-RM-0001", geomKey: "r1", nameAr: "غرفة", roomType: "فصل دراسي", floorId: floor.id })
    .returning();
  roomId = room.id;
});

async function newAsset(nameAr = "طاولة") {
  const { createAssetAction } = await import("@/app/(app)/building/actions");
  const fd = new FormData();
  fd.set("nameAr", nameAr);
  fd.set("roomId", roomId);
  fd.set("condition", "جيدة");
  fd.set("quantity", "1");
  const res = await createAssetAction(null, fd);
  expect(res?.success).toBeTruthy();
  const { db } = await import("@/db");
  const { assets } = await import("@/db/schema");
  const [a] = await db.select().from(assets).where(eq(assets.nameAr, nameAr));
  return a;
}

describe("دورة حياة الأصل — الأرشفة والاستعادة", () => {
  it("الأرشفة غير مدمّرة: تخفي الأصل وتحفظ السبب والسجل، والاستعادة تعكسها", async () => {
    const { db } = await import("@/db");
    const { assets, assetHistory } = await import("@/db/schema");
    const { archiveAssetAction, restoreAssetAction } = await import("@/app/(app)/building/actions");

    const a = await newAsset("خزانة");

    // أرشفة بسبب إلزامي
    const bad = await archiveAssetAction(a.id, null, new FormData());
    expect(bad?.error).toMatch(/سبب/);

    const fd = new FormData();
    fd.set("reason", "خرجت من الخدمة نهائياً");
    const ok = await archiveAssetAction(a.id, null, fd);
    expect(ok?.success).toBeTruthy();

    const [archived] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(archived.active).toBe(false);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.archivedReason).toBe("خرجت من الخدمة نهائياً");
    expect(archived.archivedBy).toBe(testUserId);

    // الأصل ما زال موجوداً (غير محذوف) وله حدث أرشفة في سجله
    const hist = await db.select().from(assetHistory).where(eq(assetHistory.assetId, a.id));
    expect(hist.some((h) => h.event === "أرشفة")).toBe(true);

    // الاستعادة تعيده نشطاً وتمسح بيانات الأرشفة
    const restored = await restoreAssetAction(a.id, null, new FormData());
    expect(restored?.success).toBeTruthy();
    const [back] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(back.active).toBe(true);
    expect(back.archivedAt).toBeNull();
    expect(back.archivedReason).toBeNull();
  });
});

describe("دورة حياة الأصل — الحذف النهائي المحروس", () => {
  it("يُحظر الحذف عند وجود بلاغ صيانة مرتبط، ويُبيّن التبعية بالعربية", async () => {
    const { db } = await import("@/db");
    const { assets, maintenanceIssues } = await import("@/db/schema");
    const { deleteAssetAction } = await import("@/app/(app)/building/actions");
    const { getAssetDependencies, assetIsDeletable } = await import("@/lib/building/asset-lifecycle");

    const a = await newAsset("مكيّف");
    await db.insert(maintenanceIssues).values({
      code: "KHS-MNT-0001",
      title: "عطل تبريد",
      roomId,
      assetId: a.id,
    });

    const deps = await getAssetDependencies(a.id);
    expect(deps.some((d) => d.type === "maintenance" && d.count === 1)).toBe(true);
    expect(await assetIsDeletable(a.id)).toBe(false);

    const fd = new FormData();
    fd.set("createdByMistake", "on");
    fd.set("confirm", "حذف الأصل نهائياً");
    const res = await deleteAssetAction(a.id, null, fd);
    expect(res?.error).toMatch(/بلاغات صيانة/);

    // لم يُحذف الأصل ولا بلاغ الصيانة (لا حذف بالسلسلة)
    const [still] = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(still).toBeTruthy();
    const mnt = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.assetId, a.id));
    expect(mnt.length).toBe(1);
  });

  it("يتطلب إقرار «أُنشئ بالخطأ» وعبارة التأكيد الحرفية، ثم يحذف الأصل بلا تبعيات", async () => {
    const { db } = await import("@/db");
    const { assets } = await import("@/db/schema");
    const { deleteAssetAction } = await import("@/app/(app)/building/actions");

    const a = await newAsset("كرسي بالخطأ");

    // بلا الإقرار → يُرفض
    const noMistake = new FormData();
    noMistake.set("confirm", "حذف الأصل نهائياً");
    expect((await deleteAssetAction(a.id, null, noMistake))?.error).toMatch(/بالخطأ/);

    // عبارة تأكيد خاطئة → يُرفض
    const wrong = new FormData();
    wrong.set("createdByMistake", "on");
    wrong.set("confirm", "احذف");
    expect((await deleteAssetAction(a.id, null, wrong))?.error).toMatch(/عبارة التأكيد/);

    // صحيح → يُحذف
    const good = new FormData();
    good.set("createdByMistake", "on");
    good.set("confirm", "حذف الأصل نهائياً");
    const ok = await deleteAssetAction(a.id, null, good);
    expect(ok?.success).toBeTruthy();
    const rows = await db.select().from(assets).where(eq(assets.id, a.id));
    expect(rows.length).toBe(0);
  });
});

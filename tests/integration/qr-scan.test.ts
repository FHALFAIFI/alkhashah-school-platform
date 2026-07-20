import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/** Phase 5 — حل رمز QR إلى غرفة/أصل مع أذونات وحالة الأرشفة. قراءة فقط. */

let pool: Pool;
let userId = "";
let roomId = "";
let roomCode = "KHS-RM-0001";

const perms = new Set(["building.read", "inspections.write", "maintenance.write", "assets.write"]);
const fakeUser = () => ({ id: userId, username: "t", displayName: "اختبار", personId: null, permissions: perms, csrfToken: "x", sessionId: "x" });
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
  const [u] = await db.insert(users).values({ username: "t-qr", displayName: "اختبار", passwordHash: "x" }).returning();
  userId = u.id;
  await db.insert(siteZones).values({ key: "boys", nameAr: "مجمع البنين", zoneType: "managed" });
  const [f] = await db.insert(floors).values({ key: "ground", nameAr: "الأرضي", level: 0, zoneKey: "boys", sortOrder: 1 }).returning();
  const [r] = await db.insert(rooms).values({ code: roomCode, geomKey: "r1", nameAr: "مختبر", roomType: "مختبر", floorId: f.id }).returning();
  roomId = r.id;
});

describe("resolveScanAction", () => {
  it("رابط غرفة (uuid) يحل إلى الغرفة مع أذونات الفحص/الصيانة", async () => {
    const { resolveScanAction } = await import("@/app/(app)/building/scan-actions");
    const res = await resolveScanAction(`https://x.ts.net/building/rooms/${roomId}`);
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === "room") {
      expect(res.id).toBe(roomId);
      expect(res.canInspect).toBe(true);
      expect(res.canMaintain).toBe(true);
    }
  });

  it("رمز غرفة خام يدوي يحل إلى الغرفة", async () => {
    const { resolveScanAction } = await import("@/app/(app)/building/scan-actions");
    const res = await resolveScanAction(roomCode);
    expect(res.ok && res.kind === "room").toBe(true);
  });

  it("رمز أصل يحل إلى الأصل ويكشف حالة الأرشفة", async () => {
    const { db } = await import("@/db");
    const { assets } = await import("@/db/schema");
    const { resolveScanAction } = await import("@/app/(app)/building/scan-actions");
    await db.insert(assets).values({ code: "KHS-AST-0001", nameAr: "جهاز", roomId, active: false, archivedAt: new Date(), archivedReason: "x" });
    const res = await resolveScanAction("KHS-AST-0001");
    expect(res.ok).toBe(true);
    if (res.ok && res.kind === "asset") expect(res.archived).toBe(true);
  });

  it("غرفة مؤرشفة → رسالة خطأ عربية (لا إجراء)", async () => {
    const { db } = await import("@/db");
    const { rooms } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(rooms).set({ active: false }).where(eq(rooms.id, roomId));
    const { resolveScanAction } = await import("@/app/(app)/building/scan-actions");
    const res = await resolveScanAction(roomCode);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/مؤرشفة/);
  });

  it("رمز مجهول → خطأ عربي واضح", async () => {
    const { resolveScanAction } = await import("@/app/(app)/building/scan-actions");
    const res = await resolveScanAction("KHS-RM-9999");
    expect(res.ok).toBe(false);
  });
});

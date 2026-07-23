import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["building.read", "building.write"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "fac", passwordHash: "x", displayName: "فاعل" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

async function seedRoom(code: string) {
  const { db } = await import("@/db");
  const { floors, rooms } = await import("@/db/schema");
  const [floor] = await db.insert(floors).values({ key: `f-${code}`, nameAr: "دور", level: 0 }).returning();
  const [room] = await db
    .insert(rooms)
    .values({ floorId: floor.id, geomKey: `g-${code}`, code, nameAr: "غرفة", roomType: "معمل" })
    .returning();
  return room;
}

describe("قائمة المرافق (§7)", () => {
  it("ربط غرفة بمرفق يعلّمه «موجود» ويرفع الكمية المتوفرة", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const [u] = await db.insert(users).values({ username: "fac2", passwordHash: "x", displayName: "ف" }).returning();
    testUserId = u.id;

    const { facilityChecklist, facilityRoomLinks } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { linkFacilityRoomAction } = await import("@/app/(app)/building/facilities/actions");

    const [fac] = await db
      .insert(facilityChecklist)
      .values({ facilityType: "مختبر علوم", kind: "معياري", status: "غير موجود", requiredQty: 2 })
      .returning();
    const room = await seedRoom("KHS-RM-9001");

    const fd = new FormData();
    fd.set("roomId", room.id);
    const res = await linkFacilityRoomAction(fac.id, null, fd);
    expect(res?.success).toBeTruthy();

    const [updated] = await db.select().from(facilityChecklist).where(eq(facilityChecklist.id, fac.id));
    expect(updated.status).toBe("موجود");
    const links = await db.select().from(facilityRoomLinks).where(eq(facilityRoomLinks.facilityId, fac.id));
    expect(links.length).toBe(1);
  });

  it("حذف بند المرفق يزيل روابط الغرف فقط ولا يمس الغرف نفسها", async () => {
    const { db } = await import("@/db");
    const { facilityChecklist, facilityRoomLinks, rooms } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { deleteFacilityAction } = await import("@/app/(app)/building/facilities/actions");

    const [fac] = await db.select().from(facilityChecklist).limit(1);
    const beforeRooms = await db.select().from(rooms);

    await deleteFacilityAction(fac.id);

    expect((await db.select().from(facilityChecklist).where(eq(facilityChecklist.id, fac.id))).length).toBe(0);
    expect((await db.select().from(facilityRoomLinks).where(eq(facilityRoomLinks.facilityId, fac.id))).length).toBe(0);
    // الغرف لم تُحذف
    expect((await db.select().from(rooms)).length).toBe(beforeRooms.length);
  });

  it("بذر القائمة المعيارية idempotent — لا تكرار", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { users, facilityChecklist } = await import("@/db/schema");
    const [u] = await db.insert(users).values({ username: "fac3", passwordHash: "x", displayName: "ف" }).returning();
    testUserId = u.id;
    const { seedStandardFacilitiesAction, STANDARD_FACILITIES } = await import("@/app/(app)/building/facilities/actions");

    await seedStandardFacilitiesAction();
    const first = await db.select().from(facilityChecklist);
    expect(first.length).toBe(STANDARD_FACILITIES.length);

    await seedStandardFacilitiesAction();
    const second = await db.select().from(facilityChecklist);
    expect(second.length).toBe(STANDARD_FACILITIES.length);
  });
});

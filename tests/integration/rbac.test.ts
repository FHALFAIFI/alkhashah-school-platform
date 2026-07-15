import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

async function permissionsForUser(userId: string): Promise<Set<string>> {
  const { db } = await import("@/db");
  const { userRoles, rolePermissions, permissions } = await import("@/db/schema");
  const roleIds = (await db.select().from(userRoles).where(eq(userRoles.userId, userId))).map((r) => r.roleId);
  if (roleIds.length === 0) return new Set();
  const keys = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, roleIds));
  return new Set(keys.map((k) => k.key));
}

describe("الصلاحيات المرنة (A2)", () => {
  it("دور مستقبلي (معلم) لا يرى تفاصيل الأداء الفردي دون منح صريح", async () => {
    const { db } = await import("@/db");
    const { users, roles, permissions, rolePermissions, userRoles } = await import("@/db/schema");
    const { permissionsSeed, rolesSeed } = await import("@/db/seed-data/permissions");

    for (const p of permissionsSeed) await db.insert(permissions).values(p).onConflictDoNothing();
    const allPerms = await db.select().from(permissions);
    const byKey = new Map(allPerms.map((p) => [p.key, p.id]));

    // إنشاء الأدوار الأساسية من البذرة
    for (const r of rolesSeed) {
      const [role] = await db.insert(roles).values({ key: r.key, nameAr: r.nameAr, system: r.system }).returning();
      for (const pk of r.permissions) {
        await db.insert(rolePermissions).values({ roleId: role.id, permissionId: byKey.get(pk)! }).onConflictDoNothing();
      }
    }

    // دور مستقبلي: معلم — يمنح قراءة أداءه العام فقط (وليس التفاصيل الفردية)
    const [teacherRole] = await db.insert(roles).values({ key: "future-teacher", nameAr: "معلم (مستقبلي)" }).returning();
    await db.insert(rolePermissions).values({ roleId: teacherRole.id, permissionId: byKey.get("performance.read")! });

    const [teacherUser] = await db.insert(users).values({ username: "t-teacher", displayName: "معلم", passwordHash: "x" }).returning();
    await db.insert(userRoles).values({ userId: teacherUser.id, roleId: teacherRole.id });

    const [principalRole] = await db.select().from(roles).where(eq(roles.key, "principal"));
    const [principalUser] = await db.insert(users).values({ username: "t-principal", displayName: "مدير", passwordHash: "x" }).returning();
    await db.insert(userRoles).values({ userId: principalUser.id, roleId: principalRole.id });

    const teacherPerms = await permissionsForUser(teacherUser.id);
    const principalPerms = await permissionsForUser(principalUser.id);

    expect(teacherPerms.has("performance.read")).toBe(true);
    expect(teacherPerms.has("performance.individual.read")).toBe(false);
    expect(principalPerms.has("performance.individual.read")).toBe(true);
    expect(principalPerms.has("branding.use")).toBe(true);
  });

  it("مسؤول النظام يرى النظام دون تفاصيل الأداء الفردي ودون استخدام التوقيع", async () => {
    const { db } = await import("@/db");
    const { users, roles, userRoles } = await import("@/db/schema");
    const [adminRole] = await db.select().from(roles).where(eq(roles.key, "sysadmin"));
    const [adminUser] = await db.insert(users).values({ username: "t-admin", displayName: "مسؤول", passwordHash: "x" }).returning();
    await db.insert(userRoles).values({ userId: adminUser.id, roleId: adminRole.id });

    const perms = await permissionsForUser(adminUser.id);
    expect(perms.has("admin.users")).toBe(true);
    expect(perms.has("plan.read")).toBe(true);
    expect(perms.has("performance.individual.read")).toBe(false);
    expect(perms.has("branding.use")).toBe(false);
  });
});

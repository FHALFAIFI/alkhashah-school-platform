/** إدراج أذونات الذكاء الاصطناعي وربطها بالأدوار — آمن لإعادة التشغيل */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { permissions, roles, rolePermissions } from "../src/db/schema";

const AI_PERMS = [
  { key: "ai.use", nameAr: "استخدام مساعد المدير الذكي", module: "ai" },
  { key: "ai.manage", nameAr: "إدارة إعدادات الذكاء الاصطناعي", module: "ai" },
];

async function main() {
  for (const p of AI_PERMS) {
    await db.insert(permissions).values(p).onConflictDoNothing({ target: permissions.key });
  }
  const allRoles = await db.select().from(roles);
  for (const roleKey of ["principal", "sysadmin"]) {
    const role = allRoles.find((r) => r.key === roleKey);
    if (!role) continue;
    for (const p of AI_PERMS) {
      const [perm] = await db.select().from(permissions).where(eq(permissions.key, p.key));
      await db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id }).onConflictDoNothing();
    }
  }
  console.log("أذونات الذكاء الاصطناعي جاهزة");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
  const { pool: appPool } = await import("@/db");
  await appPool.end();
});

async function seedBatch(status: string, fileName = "الخطة.xlsx", importType = "operational_plan") {
  const { db } = await import("@/db");
  const { importBatches } = await import("@/db/schema");
  const [b] = await db
    .insert(importBatches)
    .values({ importType, sourceFileName: fileName, status, createdBy: null })
    .returning();
  return b;
}

describe("منع تكرار الاستيراد وإلغاء دفعة المعاينة (البند الراسب: استيراد الخطة)", () => {
  it("findLiveBatchesForFile يرصد دفعات المعاينة/المنفذة فقط لا الملغاة/المتراجع عنها", async () => {
    const { findLiveBatchesForFile } = await import("@/lib/imports/framework");
    await truncateAll(pool);
    await seedBatch("ملغاة");
    await seedBatch("متراجع عنها");
    expect(await findLiveBatchesForFile("operational_plan", "الخطة.xlsx")).toHaveLength(0);

    await seedBatch("معاينة");
    const live = await findLiveBatchesForFile("operational_plan", "الخطة.xlsx");
    expect(live).toHaveLength(1);
    expect(live[0].status).toBe("معاينة");

    // ملف آخر أو نوع آخر لا يُحسب
    expect(await findLiveBatchesForFile("operational_plan", "ملف-آخر.xlsx")).toHaveLength(0);
    expect(await findLiveBatchesForFile("people", "الخطة.xlsx")).toHaveLength(0);
  });

  it("cancelBatch يحوّل المعاينة إلى «ملغاة» ويحرّر الملف لرفع جديد", async () => {
    const { cancelBatch, findLiveBatchesForFile } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { importBatches, users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await truncateAll(pool);
    const [u] = await db.insert(users).values({ username: "t-cancel", displayName: "مدير", passwordHash: "x" }).returning();
    const b = await seedBatch("معاينة", "خطة-للإلغاء.xlsx");

    await cancelBatch(b.id, u.id);
    const [after] = await db.select().from(importBatches).where(eq(importBatches.id, b.id));
    expect(after.status).toBe("ملغاة");
    // بعد الإلغاء لم تعد تُحسب دفعة حية → الرفع الجديد مسموح
    expect(await findLiveBatchesForFile("operational_plan", "خطة-للإلغاء.xlsx")).toHaveLength(0);
  });

  it("cancelBatch يرفض إلغاء دفعة منفذة", async () => {
    const { cancelBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    await truncateAll(pool);
    const [u] = await db.insert(users).values({ username: "t-cancel2", displayName: "مدير", passwordHash: "x" }).returning();
    const b = await seedBatch("منفذة", "خطة-منفذة.xlsx");
    await expect(cancelBatch(b.id, u.id)).rejects.toThrow(/منفذة/);
  });
});

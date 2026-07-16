import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";
import { syntheticPeopleWorkbook } from "../helpers/fixtures";

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

describe("استيراد الأشخاص الآمن (A8, A10)", () => {
  it("المعاينة لا تتضمن رقم الهوية ولا الميلاد ولا الجوال ولا هوية المدير افتراضياً", async () => {
    const { parsePeopleWorkbook } = await import("@/lib/imports/people");
    const buf = await syntheticPeopleWorkbook();
    const { rows, detectedColumns } = await parsePeopleWorkbook(buf);

    expect(rows.length).toBe(6);
    // الأعمدة الحساسة مكتشفة وموسومة لكنها غير مستوردة
    const sensitive = detectedColumns.filter((c) => c.sensitive);
    expect(sensitive.length).toBe(4);

    for (const row of rows) {
      const all = JSON.stringify(row.raw) + JSON.stringify(row.mapped);
      expect(all).not.toContain("100000000"); // أرقام الهوية الاصطناعية
      expect(all).not.toContain("05000000"); // أرقام الجوال الاصطناعية
      expect(all).not.toContain("1099999999"); // هوية المدير
      expect(Object.keys(row.mapped)).not.toContain("nationalId");
      expect(Object.keys(row.mapped)).not.toContain("birthDate");
      expect(Object.keys(row.mapped)).not.toContain("mobile");
      expect(Object.keys(row.mapped)).not.toContain("managerNationalId");
    }
  });

  it("يصنف المعلم والموظف ويكتشف رقم الوظيفة المكرر", async () => {
    const { parsePeopleWorkbook } = await import("@/lib/imports/people");
    const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
    expect(rows[0].mapped.category).toBe("معلم");
    expect(rows[3].mapped.category).toBe("موظف");
    const dupRow = rows[5];
    expect(dupRow.status).toBe("يحتاج مراجعة");
    expect(dupRow.validation.errors.join()).toContain("مكرر");
  });

  it("لا ينفذ قبل تصحيح صفوف المراجعة، ثم ينفذ ويتراجع بالكامل (A10)", async () => {
    const { parsePeopleWorkbook, commitPeopleRows, rollbackPeopleBatch } = await import("@/lib/imports/people");
    const { createBatch, commitBatch, rollbackBatch, updateRowCorrection, getBatchWithRows } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, people } = await import("@/db/schema");

    const [u] = await db.insert(users).values({ username: "t-user", displayName: "مستخدم اختبار", passwordHash: "x" }).returning();

    const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
    const batch = await createBatch({
      importType: "people",
      sourceFileName: "fixture.xlsx",
      rows,
      createdBy: u.id,
    });

    // التنفيذ يرفض مع وجود صفوف تحتاج مراجعة
    await expect(
      commitBatch(batch.id, u.id, (tx, ready) => commitPeopleRows(tx, ready, batch.id, u.id)),
    ).rejects.toThrow(/يحتاج مراجعة/);

    // تصحيح/استبعاد صفوف المراجعة ثم التنفيذ
    const withRows = await getBatchWithRows(batch.id);
    for (const r of withRows!.rows.filter((x) => x.status === "يحتاج مراجعة")) {
      const hasErrors = (r.validation as { errors: string[] }).errors.length > 0;
      await updateRowCorrection(r.id, {}, hasErrors ? "مستبعد" : "جاهز");
    }
    await commitBatch(batch.id, u.id, (tx, ready) => commitPeopleRows(tx, ready, batch.id, u.id));

    const imported = await db.select().from(people);
    expect(imported.length).toBe(5); // استبعد المكرر
    expect(imported.every((p) => p.importBatchId === batch.id)).toBe(true);

    // التراجع الكامل
    await rollbackBatch(batch.id, u.id, (tx) => rollbackPeopleBatch(tx, batch.id));
    const after = await db.select().from(people);
    expect(after.length).toBe(0);
    const batchAfter = await getBatchWithRows(batch.id);
    expect(batchAfter!.batch.status).toBe("متراجع عنها");
  });

  it("التنفيذ المتزامن من نافذتين: واحد فقط ينجح والأشخاص يدرجون مرة واحدة بالضبط", async () => {
    const { parsePeopleWorkbook, commitPeopleRows } = await import("@/lib/imports/people");
    const { createBatch, commitBatch, updateRowCorrection, getBatchWithRows } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, people, importBatches } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [u] = await db.insert(users).values({ username: "t-user-race", displayName: "مستخدم اختبار السباق", passwordHash: "x" }).returning();

    // دفعة اصطناعية خاصة بهذا الاختبار — لا تلمس أي دفعة أخرى
    const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
    const batch = await createBatch({ importType: "people", sourceFileName: "race-fixture.xlsx", rows, createdBy: u.id });
    const withRows = await getBatchWithRows(batch.id);
    for (const r of withRows!.rows.filter((x) => x.status === "يحتاج مراجعة")) {
      const hasErrors = (r.validation as { errors: string[] }).errors.length > 0;
      await updateRowCorrection(r.id, {}, hasErrors ? "مستبعد" : "جاهز");
    }

    // تنفيذ مزدوج متزامن (يحاكي نافذتين) — الادعاء الذري داخل المعاملة يسمح لواحد فقط
    const results = await Promise.allSettled([
      commitBatch(batch.id, u.id, (tx, ready) => commitPeopleRows(tx, ready, batch.id, u.id)),
      commitBatch(batch.id, u.id, (tx, ready) => commitPeopleRows(tx, ready, batch.id, u.id)),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    // الرفض برسالة عربية (حسب توقيت السباق: الادعاء الذري، الفحص المسبق، أو صفوف نفذت بالفعل)
    expect(String(rejected[0].reason)).toMatch(/الدفعة ليست في حالة معاينة|الدفعة منفذة مسبقاً|لا توجد صفوف جاهزة للتنفيذ/);

    // الأشخاص أدرجوا مرة واحدة بالضبط (5 صفوف جاهزة بعد استبعاد المكرر)
    const imported = await db.select().from(people).where(eq(people.importBatchId, batch.id));
    expect(imported.length).toBe(5);

    const after = await getBatchWithRows(batch.id);
    expect(after!.batch.status).toBe("منفذة");

    // تنظيف الدفعة التي أنشأها هذا الاختبار فقط
    await db.delete(people).where(eq(people.importBatchId, batch.id));
    await db.delete(importBatches).where(eq(importBatches.id, batch.id));
  });

  it("بعد التنفيذ: كل صف منفذ يحمل createdEntityId يشير إلى شخص حقيقي", async () => {
    const { parsePeopleWorkbook, commitPeopleRows } = await import("@/lib/imports/people");
    const { createBatch, commitBatch, updateRowCorrection, getBatchWithRows } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, people, importBatches } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [u] = await db.insert(users).values({ username: "t-user-links", displayName: "مستخدم اختبار الروابط", passwordHash: "x" }).returning();

    const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
    const batch = await createBatch({ importType: "people", sourceFileName: "links-fixture.xlsx", rows, createdBy: u.id });
    const withRows = await getBatchWithRows(batch.id);
    for (const r of withRows!.rows.filter((x) => x.status === "يحتاج مراجعة")) {
      const hasErrors = (r.validation as { errors: string[] }).errors.length > 0;
      await updateRowCorrection(r.id, {}, hasErrors ? "مستبعد" : "جاهز");
    }
    await commitBatch(batch.id, u.id, (tx, ready) => commitPeopleRows(tx, ready, batch.id, u.id));

    const after = await getBatchWithRows(batch.id);
    const committed = after!.rows.filter((r) => r.status === "منفذ");
    expect(committed.length).toBe(5);
    for (const r of committed) {
      expect(r.createdEntityType).toBe("person");
      expect(r.createdEntityId).toBeTruthy();
      const [person] = await db.select().from(people).where(eq(people.id, r.createdEntityId!));
      expect(person).toBeDefined();
      expect(person.importBatchId).toBe(batch.id);
    }

    // تنظيف الدفعة التي أنشأها هذا الاختبار فقط
    await db.delete(people).where(eq(people.importBatchId, batch.id));
    await db.delete(importBatches).where(eq(importBatches.id, batch.id));
  });

  it("التراجع عن دفعة غير منفذة يرفض برسالة عربية", async () => {
    const { parsePeopleWorkbook, rollbackPeopleBatch } = await import("@/lib/imports/people");
    const { createBatch, rollbackBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, importBatches } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [u] = await db.insert(users).values({ username: "t-user-rb", displayName: "مستخدم اختبار التراجع", passwordHash: "x" }).returning();

    const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
    const batch = await createBatch({ importType: "people", sourceFileName: "rb-fixture.xlsx", rows, createdBy: u.id });

    // الدفعة ما زالت «معاينة» — التراجع مرفوض
    await expect(
      rollbackBatch(batch.id, u.id, (tx) => rollbackPeopleBatch(tx, batch.id)),
    ).rejects.toThrow("التراجع ممكن فقط عن دفعة منفذة");

    // تنظيف الدفعة التي أنشأها هذا الاختبار فقط
    await db.delete(importBatches).where(eq(importBatches.id, batch.id));
  });
});

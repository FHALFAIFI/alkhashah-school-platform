import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
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

/** ينشئ دفعة أشخاص، يحسم صفوف المراجعة، ثم ينفذها فيُنشئ الأشخاص. يعيد معرّف الدفعة وقائمة الأشخاص. */
async function commitSyntheticPeopleBatch(fileName: string) {
  const { parsePeopleWorkbook, commitPeopleRows } = await import("@/lib/imports/people");
  const { createBatch, commitBatch, updateRowCorrection, getBatchWithRows } = await import("@/lib/imports/framework");
  const { db } = await import("@/db");
  const { users, people } = await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: `rb-${fileName}`, displayName: "مستخدم اختبار التراجع", passwordHash: "x" }).returning();
  const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
  const batch = await createBatch({ importType: "people", sourceFileName: fileName, rows, createdBy: u.id });
  const withRows = await getBatchWithRows(batch.id);
  for (const r of withRows!.rows.filter((x) => x.status === "يحتاج مراجعة")) {
    const hasErrors = (r.validation as { errors: string[] }).errors.length > 0;
    await updateRowCorrection(r.id, {}, hasErrors ? "مستبعد" : "جاهز");
  }
  await commitBatch(batch.id, u.id, (tx, ready) => commitPeopleRows(tx, ready, batch.id, u.id));
  const imported = await db.select().from(people).where(eq(people.importBatchId, batch.id));
  return { userId: u.id, batchId: batch.id, importedPeople: imported };
}

describe("تدقيق التراجع الكامل عن دفعة الأشخاص (تقوية الأمان)", () => {
  it("بلا تبعيات: التدقيق يسمح والتراجع الكامل ينجح ويحذف الأشخاص", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { rollbackPeopleBatch } = await import("@/lib/imports/people");
    const { rollbackBatch, getBatchWithRows } = await import("@/lib/imports/framework");
    const { peopleBatchDependencies } = await import("@/lib/imports/people-dependencies");

    const { userId, batchId, importedPeople } = await commitSyntheticPeopleBatch("rb-clean.xlsx");
    expect(importedPeople.length).toBe(5);

    // التدقيق: لا تبعيات → غير محظور
    const pre = await peopleBatchDependencies(db, batchId);
    expect(pre.importedCount).toBe(5);
    expect(pre.blocked).toBe(false);
    expect(pre.dependencies).toEqual([]);

    // التراجع الكامل ينجح
    await rollbackBatch(batchId, userId, (tx) => rollbackPeopleBatch(tx, batchId));
    const after = await db.select().from(people).where(eq(people.importBatchId, batchId));
    expect(after.length).toBe(0);
    const batchAfter = await getBatchWithRows(batchId);
    expect(batchAfter!.batch.status).toBe("متراجع عنها");
    // الصفوف عادت إلى «جاهز» (قابلة لإعادة التنفيذ)
    expect(batchAfter!.rows.filter((r) => r.status === "جاهز").length).toBe(5);
  });

  it("بوجود تبعيات (لجنة + مهمة + دورة أداء): التدقيق يحظر والتراجع مرفوض وكل السجلات تبقى سليمة", async () => {
    const { db } = await import("@/db");
    const { people, committees, committeeMembers, actionTasks, perfCycles, perfModels, planYears, importBatches } = await import("@/db/schema");
    const { rollbackPeopleBatch } = await import("@/lib/imports/people");
    const { rollbackBatch, getBatchWithRows } = await import("@/lib/imports/framework");
    const { peopleBatchDependencies } = await import("@/lib/imports/people-dependencies");

    const { userId, batchId, importedPeople } = await commitSyntheticPeopleBatch("rb-linked.xlsx");
    expect(importedPeople.length).toBe(5);

    // ربط ثلاثة أشخاص من الدفعة بسجلات عمل لاحقة
    const [year] = await db.insert(planYears).values({ key: "rb-year", nameAr: "سنة اختبار التراجع" }).returning();
    const [committee] = await db.insert(committees).values({ planYearId: year.id, nameAr: "لجنة اختبار", kind: "لجنة" }).returning();
    await db.insert(committeeMembers).values({ committeeId: committee.id, personId: importedPeople[0].id });

    const [task] = await db.insert(actionTasks).values({ title: "مهمة مسندة لموظف مستورد", ownerPersonId: importedPeople[1].id }).returning();

    const [model] = await db.insert(perfModels).values({ key: "rb-model", nameAr: "نموذج اختبار", audience: "معلم" }).returning();
    const [cycle] = await db
      .insert(perfCycles)
      .values({ personId: importedPeople[2].id, cycleType: "معلم", yearKey: "1448-1449", modelId: model.id, modelSnapshot: { indicators: [] } })
      .returning();

    // التدقيق: محظور، ويسرد الأنواع الثلاثة بأعدادها
    const pre = await peopleBatchDependencies(db, batchId);
    expect(pre.blocked).toBe(true);
    const byType = new Map(pre.dependencies.map((d) => [d.type, d.count]));
    expect(byType.get("committee_members")).toBe(1);
    expect(byType.get("action_tasks")).toBe(1);
    expect(byType.get("perf_cycles")).toBe(1);

    // التراجع الكامل مرفوض من الخادم برسالة عربية — لا حذف تعاقبي
    await expect(
      rollbackBatch(batchId, userId, (tx) => rollbackPeopleBatch(tx, batchId)),
    ).rejects.toThrow(/لا يمكن التراجع الكامل/);

    // كل شيء سليم: الأشخاص الخمسة باقون، والدفعة ما زالت «منفذة»
    const peopleAfter = await db.select().from(people).where(eq(people.importBatchId, batchId));
    expect(peopleAfter.length).toBe(5);
    const batchAfter = await getBatchWithRows(batchId);
    expect(batchAfter!.batch.status).toBe("منفذة");

    // سجلات العمل المرتبطة لم تُحذف ولم تُعدّل
    expect((await db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, committee.id))).length).toBe(1);
    expect((await db.select().from(actionTasks).where(eq(actionTasks.id, task.id))).length).toBe(1);
    expect((await db.select().from(perfCycles).where(eq(perfCycles.id, cycle.id))).length).toBe(1);
    // الأشخاص المرتبطون تحديداً ما زالوا موجودين
    for (const idx of [0, 1, 2]) {
      expect((await db.select().from(people).where(eq(people.id, importedPeople[idx].id))).length).toBe(1);
    }

    // تنظيف: أزل التبعيات ثم الأشخاص والدفعة (بترتيب المفاتيح)
    await db.delete(committeeMembers).where(eq(committeeMembers.committeeId, committee.id));
    await db.delete(perfCycles).where(eq(perfCycles.id, cycle.id));
    await db.delete(actionTasks).where(eq(actionTasks.id, task.id));
    await db.delete(people).where(eq(people.importBatchId, batchId));
    await db.delete(importBatches).where(eq(importBatches.id, batchId));
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";
import { synthetic52PeopleWorkbook } from "../helpers/fixtures";

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

/** ينشئ دفعة أشخاص من 52 صفاً جاهزاً (بلا مراجعة) — لا يُنفّذها. */
async function make52ReadyBatch(fileName: string) {
  const { parsePeopleWorkbook } = await import("@/lib/imports/people");
  const { createBatch, getBatchWithRows } = await import("@/lib/imports/framework");
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: `ch-${fileName}`, displayName: "مستخدم اختبار التقوية", passwordHash: "x" }).returning();
  const { rows } = await parsePeopleWorkbook(await synthetic52PeopleWorkbook());
  const batch = await createBatch({ importType: "people", sourceFileName: fileName, rows, createdBy: u.id });
  const withRows = await getBatchWithRows(batch.id);
  const ready = withRows!.rows.filter((r) => r.status === "جاهز").length;
  return { userId: u.id, batchId: batch.id, readyCount: ready };
}

describe("تقوية تنفيذ دفعة الاستيراد (قفل الصف + عدم التكرار + كل شيء أو لا شيء)", () => {
  it("52 صفاً جاهزاً تُنشئ 52 شخصاً بالضبط وحدث تنفيذ واحد", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { commitPeopleRows } = await import("@/lib/imports/people");
    const { commitBatch, getBatchWithRows } = await import("@/lib/imports/framework");

    const { userId, batchId, readyCount } = await make52ReadyBatch("ch-52.xlsx");
    expect(readyCount).toBe(52);

    await commitBatch(batchId, userId, (tx, ready) => commitPeopleRows(tx, ready, batchId, userId), { correlationId: "corr-52" });

    const created = await db.select().from(people).where(eq(people.importBatchId, batchId));
    expect(created.length).toBe(52);
    const batchAfter = await getBatchWithRows(batchId);
    expect(batchAfter!.batch.status).toBe("منفذة");

    // حدث تنفيذ واحد بالضبط لهذه الدفعة
    const { rows: audits } = await pool.query(
      "SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action='import.batch_committed'",
      [batchId],
    );
    expect(audits[0].c).toBe(1);

    await db.delete(people).where(eq(people.importBatchId, batchId));
  });

  it("محاولة ثانية بعد نجاح التنفيذ (نقرة مزدوجة/إعادة تحميل) تُرفض ولا تُنشئ مكرراً", async () => {
    const { db } = await import("@/db");
    const { people, importBatches } = await import("@/db/schema");
    const { commitPeopleRows } = await import("@/lib/imports/people");
    const { commitBatch } = await import("@/lib/imports/framework");

    const { userId, batchId } = await make52ReadyBatch("ch-repeat.xlsx");
    await commitBatch(batchId, userId, (tx, ready) => commitPeopleRows(tx, ready, batchId, userId));
    expect((await db.select().from(people).where(eq(people.importBatchId, batchId))).length).toBe(52);

    // محاولة ثانية → ترفض «منفذة مسبقاً» ولا تضاعف الأشخاص
    await expect(
      commitBatch(batchId, userId, (tx, ready) => commitPeopleRows(tx, ready, batchId, userId)),
    ).rejects.toThrow("الدفعة منفذة مسبقاً");
    expect((await db.select().from(people).where(eq(people.importBatchId, batchId))).length).toBe(52);

    await db.delete(people).where(eq(people.importBatchId, batchId));
    await db.delete(importBatches).where(eq(importBatches.id, batchId));
  });

  it("تنفيذان متزامنان (نافذتان): واحد فقط ينجح والأشخاص 52 بالضبط", async () => {
    const { db } = await import("@/db");
    const { people, importBatches } = await import("@/db/schema");
    const { commitPeopleRows } = await import("@/lib/imports/people");
    const { commitBatch } = await import("@/lib/imports/framework");

    const { userId, batchId } = await make52ReadyBatch("ch-concurrent.xlsx");
    const results = await Promise.allSettled([
      commitBatch(batchId, userId, (tx, ready) => commitPeopleRows(tx, ready, batchId, userId)),
      commitBatch(batchId, userId, (tx, ready) => commitPeopleRows(tx, ready, batchId, userId)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
    // الأشخاص أُدرجوا مرة واحدة بالضبط — قفل الصف منع الازدواج
    expect((await db.select().from(people).where(eq(people.importBatchId, batchId))).length).toBe(52);

    await db.delete(people).where(eq(people.importBatchId, batchId));
    await db.delete(importBatches).where(eq(importBatches.id, batchId));
  });

  it("فشل داخل المعاملة يترك 0 أشخاص والدفعة «معاينة» (كل شيء أو لا شيء)", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { commitBatch, getBatchWithRows } = await import("@/lib/imports/framework");

    const { userId, batchId } = await make52ReadyBatch("ch-fail.xlsx");
    // مُنفّذ يرمي خطأً بعد أن تكون المعاملة قد قلبت الحالة إلى «منفذة» داخلياً
    await expect(
      commitBatch(batchId, userId, async () => {
        throw new Error("فشل اصطناعي أثناء الإدراج");
      }),
    ).rejects.toThrow("فشل اصطناعي");

    // تراجعت المعاملة بالكامل: لا أشخاص، والدفعة ما زالت «معاينة»
    expect((await db.select().from(people).where(eq(people.importBatchId, batchId))).length).toBe(0);
    const batchAfter = await getBatchWithRows(batchId);
    expect(batchAfter!.batch.status).toBe("معاينة");
    expect(batchAfter!.batch.committedAt).toBeNull();
  });
});

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

async function makeBatch() {
  const { parsePeopleWorkbook } = await import("@/lib/imports/people");
  const { createBatch, getBatchWithRows } = await import("@/lib/imports/framework");
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db
    .insert(users)
    .values({ username: `t-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, displayName: "مدير اختبار", passwordHash: "x" })
    .returning();
  const { rows } = await parsePeopleWorkbook(await syntheticPeopleWorkbook());
  const batch = await createBatch({ importType: "people", sourceFileName: "fixture.xlsx", rows, createdBy: u.id });
  const data = await getBatchWithRows(batch.id);
  return { u, batch, rows: data!.rows };
}

describe("قرارات صفوف الاستيراد القابلة للتراجع الكامل (بنود القبول الراسبة 2026-07-17)", () => {
  it("كل قرار يسجل لقطة كاملة، والتراجع يستعيد الحالة والقيم والتصحيحات", async () => {
    const { applyRowDecision, undoLastRowDecision, getBatchWithRows } = await import("@/lib/imports/framework");
    const { u, batch, rows } = await makeBatch();
    const review = rows.find((r) => r.status === "يحتاج مراجعة")!;
    const originalTitle = (review.mapped as { jobTitle: string }).jobTitle;

    // تأكيد كجاهز
    let row = await applyRowDecision({ rowId: review.id, action: "تأكيد كجاهز", actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("جاهز");
    let history = row.decisionHistory as { action: string; from: { status: string } }[];
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("تأكيد كجاهز");
    expect(history[0].from.status).toBe("يحتاج مراجعة");

    // تصحيح يغير القيم
    row = await applyRowDecision({
      rowId: review.id,
      action: "تصحيح",
      corrections: { jobTitle: "مسمى معدل للاختبار" },
      actorId: u.id,
      actorName: u.displayName,
    });
    expect((row.mapped as { jobTitle: string }).jobTitle).toBe("مسمى معدل للاختبار");
    expect(row.decisionHistory as unknown[]).toHaveLength(2);

    // تأجيل ثم إعادة إلى المراجعة
    row = await applyRowDecision({ rowId: review.id, action: "تأجيل", actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("مؤجل");
    row = await applyRowDecision({ rowId: review.id, action: "إعادة إلى المراجعة", actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("يحتاج مراجعة");
    expect(row.decisionHistory as unknown[]).toHaveLength(4);

    // التراجع أربع مرات يعيد الصف تماماً لحالته الأولى (بما فيها القيم)
    row = await undoLastRowDecision({ rowId: review.id, actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("مؤجل");
    row = await undoLastRowDecision({ rowId: review.id, actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("جاهز");
    expect((row.mapped as { jobTitle: string }).jobTitle).toBe("مسمى معدل للاختبار");
    row = await undoLastRowDecision({ rowId: review.id, actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("جاهز");
    expect((row.mapped as { jobTitle: string }).jobTitle).toBe(originalTitle); // قيم التصحيح استعيدت
    row = await undoLastRowDecision({ rowId: review.id, actorId: u.id, actorName: u.displayName });
    expect(row.status).toBe("يحتاج مراجعة");
    expect(row.decisionHistory as unknown[]).toHaveLength(0);

    // لا قرار متبقياً للتراجع عنه
    await expect(undoLastRowDecision({ rowId: review.id, actorId: u.id, actorName: u.displayName })).rejects.toThrow(
      /لا يوجد قرار/,
    );

    // الصف عاد كما كان في قاعدة البيانات
    const fresh = (await getBatchWithRows(batch.id))!.rows.find((r) => r.id === review.id)!;
    expect(fresh.status).toBe("يحتاج مراجعة");
    expect((fresh.mapped as { jobTitle: string }).jobTitle).toBe(originalTitle);
  });

  it("الصف المؤجل يمنع التنفيذ حتى يحسم", async () => {
    const { applyRowDecision, commitBatch } = await import("@/lib/imports/framework");
    const { commitPeopleRows } = await import("@/lib/imports/people");
    const { u, batch, rows } = await makeBatch();

    // حسم صف المراجعة (استبعاد بسبب الخطأ) وتأجيل صف جاهز
    const review = rows.find((r) => r.status === "يحتاج مراجعة")!;
    await applyRowDecision({ rowId: review.id, action: "استبعاد", actorId: u.id, actorName: u.displayName });
    const ready = rows.find((r) => r.status === "جاهز")!;
    await applyRowDecision({ rowId: ready.id, action: "تأجيل", actorId: u.id, actorName: u.displayName });

    await expect(
      commitBatch(batch.id, u.id, (tx, r) => commitPeopleRows(tx, r, batch.id, u.id)),
    ).rejects.toThrow(/مؤجل/);

    // حسم الصف المؤجل ثم التنفيذ ينجح
    await applyRowDecision({ rowId: ready.id, action: "تأكيد كجاهز", actorId: u.id, actorName: u.displayName });
    await expect(
      commitBatch(batch.id, u.id, (tx, r) => commitPeopleRows(tx, r, batch.id, u.id)),
    ).resolves.toBeTruthy();
  });

  it("قرار على صف منفذ مرفوض", async () => {
    const { applyRowDecision, undoLastRowDecision, commitBatch, getBatchWithRows } = await import("@/lib/imports/framework");
    const { commitPeopleRows } = await import("@/lib/imports/people");
    const { u, batch, rows } = await makeBatch();
    const review = rows.find((r) => r.status === "يحتاج مراجعة")!;
    await applyRowDecision({ rowId: review.id, action: "استبعاد", actorId: u.id, actorName: u.displayName });
    await commitBatch(batch.id, u.id, (tx, r) => commitPeopleRows(tx, r, batch.id, u.id));
    const committed = (await getBatchWithRows(batch.id))!.rows.find((r) => r.status === "منفذ")!;
    await expect(
      applyRowDecision({ rowId: committed.id, action: "استبعاد", actorId: u.id, actorName: u.displayName }),
    ).rejects.toThrow(/منفذ/);
    await expect(undoLastRowDecision({ rowId: committed.id, actorId: u.id, actorName: u.displayName })).rejects.toThrow(/منفذ/);
  });

  it("القرار من «يحتاج مراجعة» يحفظ التحذيرات المحسومة في سجله", async () => {
    const { applyRowDecision } = await import("@/lib/imports/framework");
    const { u, rows } = await makeBatch();
    // صف المراجعة في المصنف الاصطناعي يحمل خطأ رقم الوظيفة المكرر (تحذيراته قد تكون فارغة)،
    // لذلك نتحقق من الحقل عند وجود تحذيرات فقط ومن غيابه عند عدمها
    const review = rows.find((r) => r.status === "يحتاج مراجعة")!;
    const warnings = (review.validation as { warnings: string[] }).warnings;
    const row = await applyRowDecision({ rowId: review.id, action: "تأكيد كجاهز", actorId: u.id, actorName: u.displayName });
    const entry = (row.decisionHistory as { resolvedWarnings?: string[] }[])[0];
    if (warnings.length > 0) {
      expect(entry.resolvedWarnings).toEqual(warnings);
    } else {
      expect(entry.resolvedWarnings).toBeUndefined();
    }
  });
});

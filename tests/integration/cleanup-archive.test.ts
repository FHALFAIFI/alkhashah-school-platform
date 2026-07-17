import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * سير عمل التنظيف الآمن: معاينة → تأكيد عربي صريح → أرشفة معاملاتية غير متلفة →
 * حدث تدقيق → تراجع/استرجاع كامل. يثبت أن:
 *  - نص التأكيد الخاطئ يرفض التنفيذ (fail-closed).
 *  - الأرشفة لا تحذف أي صف (السجلات تبقى في جداولها الأصلية).
 *  - المؤرشف يُخفى عبر getArchivedIdSets حتى مع MADRASA_INCLUDE_SYNTHETIC=1.
 *  - كل أرشفة/استرجاع يكتب حدث تدقيق.
 *  - سجلات «الاسم وحده» لا تؤرشَف إلا باختيار يدوي صالح.
 */

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
});

async function seed() {
  const { db } = await import("@/db");
  const { users, importBatches, people, programs, planYears } = await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: "t-arch", displayName: "مدير الاختبار", passwordHash: "x" }).returning();
  const [realYear] = await db.insert(planYears).values({ key: "1448-1449", nameAr: "العام 1448/1449هـ" }).returning();
  const [synthBatch] = await db.insert(importBatches).values({ importType: "people", sourceFileName: "موظفون تجريبي آلي.xlsx", status: "منفذة" }).returning();

  const [synthPerson] = await db.insert(people).values({ fullName: "شخص تجريبي", category: "معلم", importBatchId: synthBatch.id }).returning();
  const [synthProg] = await db.insert(programs).values({ planYearId: realYear.id, seq: 2, domain: "مجال تجريبي", name: "برنامج تجريبي آلي", importBatchId: synthBatch.id }).returning();
  const [officialProg] = await db.insert(programs).values({ planYearId: realYear.id, seq: 1, domain: "القيادة", name: "برنامج رسمي", importBatchId: null }).returning();
  // مسمّى «تجريبي» بلا مرسى بنيوي → مشتبَه به بالاسم فقط
  const [nameOnly] = await db.insert(programs).values({ planYearId: realYear.id, seq: 3, domain: "مجال", name: "برنامج تجريبي يدوي", importBatchId: null }).returning();

  return { u, synthPerson, synthProg, officialProg, nameOnly };
}

describe("archiveSynthetic — سير عمل آمن غير متلف", () => {
  it("يرفض التنفيذ عند عدم مطابقة نص التأكيد", async () => {
    const f = await seed();
    const { archiveSynthetic } = await import("@/lib/cleanup-archive");
    await expect(
      archiveSynthetic({ actorId: f.u.id, reason: "تنظيف", confirmationText: "عبارة خاطئة" }),
    ).rejects.toThrow(/التأكيد/);
  });

  it("يرفض التنفيذ عند غياب سبب الأرشفة", async () => {
    const f = await seed();
    const { archiveSynthetic, ARCHIVE_CONFIRMATION_PHRASE } = await import("@/lib/cleanup-archive");
    await expect(
      archiveSynthetic({ actorId: f.u.id, reason: "", confirmationText: ARCHIVE_CONFIRMATION_PHRASE }),
    ).rejects.toThrow(/سبب/);
  });

  it("يؤرشف بنجاح دون حذف أي صف، ويكتب لقطات وحدث تدقيق، ويُخفي عبر getArchivedIdSets", async () => {
    const f = await seed();
    const { db } = await import("@/db");
    const { programs, people, archiveBatches, archivedRecords, auditLog } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { archiveSynthetic, ARCHIVE_CONFIRMATION_PHRASE } = await import("@/lib/cleanup-archive");
    const { getArchivedIdSets } = await import("@/lib/synthetic");

    const res = await archiveSynthetic({ actorId: f.u.id, reason: "أرشفة بيانات السيناريو", confirmationText: ARCHIVE_CONFIRMATION_PHRASE });
    expect(res.totalArchived).toBeGreaterThan(0);
    expect(res.counts.program).toBe(1);
    expect(res.counts.person).toBe(1);

    // غير متلف: البرنامج الاصطناعي ما زال في جدوله، والرسمي أيضاً
    const remaining = await db.select({ id: programs.id }).from(programs);
    expect(remaining.map((r) => r.id)).toContain(f.synthProg.id);
    expect(remaining.map((r) => r.id)).toContain(f.officialProg.id);
    const remainingPeople = await db.select({ id: people.id }).from(people);
    expect(remainingPeople.map((r) => r.id)).toContain(f.synthPerson.id);

    // دفعة أرشفة واحدة بحالة «مؤرشف» + لقطات
    const batches = await db.select().from(archiveBatches);
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe("مؤرشف");
    const recs = await db.select().from(archivedRecords).where(eq(archivedRecords.batchId, res.batchId));
    expect(recs.length).toBe(res.totalArchived);
    // اللقطة كاملة (تحوي الاسم الأصلي)
    const progSnap = recs.find((r) => r.entityType === "program" && r.entityId === f.synthProg.id);
    expect(progSnap).toBeDefined();
    expect((progSnap!.snapshot as { name: string }).name).toBe("برنامج تجريبي آلي");

    // حدث تدقيق
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "cleanup.archive"));
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(res.batchId);

    // مخفي عبر getArchivedIdSets (دائم — مستقل عن مفتاح التضمين)
    const prev = process.env.MADRASA_INCLUDE_SYNTHETIC;
    process.env.MADRASA_INCLUDE_SYNTHETIC = "1";
    const archived = await getArchivedIdSets();
    expect(archived.programs.has(f.synthProg.id)).toBe(true);
    expect(archived.programs.has(f.officialProg.id)).toBe(false);
    if (prev === undefined) delete process.env.MADRASA_INCLUDE_SYNTHETIC;
    else process.env.MADRASA_INCLUDE_SYNTHETIC = prev;
  });

  it("الاسترجاع (التراجع) يعيد كل السجلات للظهور ويكتب حدث تدقيق", async () => {
    const f = await seed();
    const { db } = await import("@/db");
    const { archiveBatches, auditLog } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { archiveSynthetic, unarchiveBatch, ARCHIVE_CONFIRMATION_PHRASE } = await import("@/lib/cleanup-archive");
    const { getArchivedIdSets } = await import("@/lib/synthetic");

    const res = await archiveSynthetic({ actorId: f.u.id, reason: "أرشفة", confirmationText: ARCHIVE_CONFIRMATION_PHRASE });
    const un = await unarchiveBatch({ batchId: res.batchId, actorId: f.u.id });
    expect(un.restored).toBe(res.totalArchived);

    const [batch] = await db.select().from(archiveBatches).where(eq(archiveBatches.id, res.batchId));
    expect(batch.status).toBe("مُسترجع");

    // بعد الاسترجاع لا يعود مخفياً عبر الأرشيف
    const archived = await getArchivedIdSets();
    expect(archived.programs.has(f.synthProg.id)).toBe(false);

    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "cleanup.unarchive"));
    expect(audits).toHaveLength(1);
  });

  it("سجلات «الاسم وحده» لا تؤرشَف إلا باختيار يدوي صالح", async () => {
    const f = await seed();
    const { db } = await import("@/db");
    const { archivedRecords } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { archiveSynthetic, ARCHIVE_CONFIRMATION_PHRASE } = await import("@/lib/cleanup-archive");

    // بلا اختيار يدوي: المسمّى-فقط لا يؤرشَف
    const res1 = await archiveSynthetic({ actorId: f.u.id, reason: "أرشفة", confirmationText: ARCHIVE_CONFIRMATION_PHRASE });
    const recs1 = await db.select().from(archivedRecords).where(eq(archivedRecords.batchId, res1.batchId));
    expect(recs1.find((r) => r.entityId === f.nameOnly.id)).toBeUndefined();

    // اختيار يدوي غير صالح (ليس ضمن المشتبَه بهم) يُرفض
    await truncateAll(pool);
    const g = await seed();
    await expect(
      archiveSynthetic({
        actorId: g.u.id,
        reason: "أرشفة",
        confirmationText: ARCHIVE_CONFIRMATION_PHRASE,
        manualSelections: [{ entityType: "program", id: g.officialProg.id }],
      }),
    ).rejects.toThrow(/يدوي/);

    // اختيار يدوي صالح للمسمّى-فقط يؤرشفه
    await truncateAll(pool);
    const h = await seed();
    const res2 = await archiveSynthetic({
      actorId: h.u.id,
      reason: "أرشفة",
      confirmationText: ARCHIVE_CONFIRMATION_PHRASE,
      manualSelections: [{ entityType: "program", id: h.nameOnly.id }],
    });
    const recs2 = await db.select().from(archivedRecords).where(eq(archivedRecords.batchId, res2.batchId));
    expect(recs2.find((r) => r.entityId === h.nameOnly.id)).toBeDefined();
  });
});

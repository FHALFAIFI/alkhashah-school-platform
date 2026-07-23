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
});

describe("قواعد الشواهد (A7)", () => {
  /**
   * نطاق المنتج v2 شدّد القاعدة: الحذف النهائي متاح فقط لشاهد غير مستخدم في أي سجل.
   * سابقاً كان الشاهد المرتبط بمسودة يُحذف — الآن أي ارتباط يمنع الحذف ويوجّه للأرشفة،
   * فلا يُحذف رابط بالسلسلة ولا يُكسر سجل قائم.
   */
  it("لا يحذف شاهد مستخدم في أي سجل — مسودةً كان أم معتمداً — ويحذف بعد فك كل الروابط", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks, planYears, programs } = await import("@/db/schema");
    const { canDeleteEvidence, linkEvidence } = await import("@/lib/evidence");
    const { eq } = await import("drizzle-orm");

    const [year] = await db.insert(planYears).values({ key: "ev-yr", nameAr: "سنة" }).returning();
    const [draftProgram] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: 1, domain: "مجال", name: "برنامج مسودة" })
      .returning();
    const [approvedProgram] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: 2, domain: "مجال", name: "برنامج معتمد", status: "معتمد" })
      .returning();

    const [ev1] = await db.insert(evidenceItems).values({ title: "شاهد 1", kind: "text", textContent: "نص" }).returning();
    const [ev2] = await db.insert(evidenceItems).values({ title: "شاهد 2", kind: "text", textContent: "نص" }).returning();

    // شاهد غير مرتبط: يحذف
    expect((await canDeleteEvidence(ev1.id)).allowed).toBe(true);

    // مرتبط بمسودة: يُمنع الآن ويُشرح البديل بالعربية
    await linkEvidence({ evidenceId: ev1.id, entityType: "program", entityId: draftProgram.id });
    const draftCheck = await canDeleteEvidence(ev1.id);
    expect(draftCheck.allowed).toBe(false);
    expect(draftCheck.reason).toContain("أرشف");

    // مرتبط بمعتمد: يمنع
    await linkEvidence({ evidenceId: ev2.id, entityType: "program", entityId: approvedProgram.id });
    const check = await canDeleteEvidence(ev2.id);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("برنامج");

    // بعد فك كل الروابط يعود الحذف متاحاً
    await db.delete(evidenceLinks).where(eq(evidenceLinks.evidenceId, ev1.id));
    expect((await canDeleteEvidence(ev1.id)).allowed).toBe(true);
  });

  it("fail-closed: نوع ارتباط غير مسجَّل يمنع الحذف بدل أن يمر بصمت", async () => {
    const { db } = await import("@/db");
    const { evidenceItems } = await import("@/db/schema");
    const { canDeleteEvidence, linkEvidence } = await import("@/lib/evidence");

    const [ev] = await db.insert(evidenceItems).values({ title: "شاهد نوع مجهول", kind: "text", textContent: "ن" }).returning();
    await linkEvidence({
      evidenceId: ev.id,
      entityType: "وحدة_لم_تسجَّل_بعد",
      entityId: "00000000-0000-0000-0000-0000000000ff",
    });

    const check = await canDeleteEvidence(ev.id);
    expect(check.allowed).toBe(false);
    expect(check.assessment.dependencies.length).toBeGreaterThan(0);
  });

  it("شاهد واحد يرتبط بعدة سجلات دون تكرار", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks, planYears, programs } = await import("@/db/schema");
    const { linkEvidence, evidenceForEntity } = await import("@/lib/evidence");
    const { eq } = await import("drizzle-orm");

    const [year] = await db.insert(planYears).values({ key: "ev-yr2", nameAr: "سنة" }).returning();
    const [p1] = await db.insert(programs).values({ planYearId: year.id, seq: 11, domain: "م", name: "ب1" }).returning();
    const [p2] = await db.insert(programs).values({ planYearId: year.id, seq: 12, domain: "م", name: "ب2" }).returning();
    const [ev] = await db.insert(evidenceItems).values({ title: "مشترك", kind: "text", textContent: "ن" }).returning();

    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: p1.id });
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: p2.id });
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: p1.id }); // مكرر — يتجاهل

    const links = await db.select().from(evidenceLinks).where(eq(evidenceLinks.evidenceId, ev.id));
    expect(links.length).toBe(2);
    expect((await evidenceForEntity("program", p1.id)).length).toBe(1);
  });
});

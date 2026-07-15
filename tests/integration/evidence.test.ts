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
  it("لا يحذف شاهد مرتبط ببرنامج معتمد، ويحذف عند فك الارتباط أو كون السجل مسودة", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, planYears, programs } = await import("@/db/schema");
    const { canDeleteEvidence, linkEvidence } = await import("@/lib/evidence");

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

    // مرتبط بمسودة: يحذف
    await linkEvidence({ evidenceId: ev1.id, entityType: "program", entityId: draftProgram.id });
    expect((await canDeleteEvidence(ev1.id)).allowed).toBe(true);

    // مرتبط بمعتمد: يمنع
    await linkEvidence({ evidenceId: ev2.id, entityType: "program", entityId: approvedProgram.id });
    const check = await canDeleteEvidence(ev2.id);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("معتمد");
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

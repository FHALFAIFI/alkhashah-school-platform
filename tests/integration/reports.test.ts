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

describe("التقارير الرسمية العربية (A17)", () => {
  it("يصدر تقرير برنامج PDF عربي بلقطة ثابتة ورقم وثيقة ورمز تحقق", async () => {
    const { db } = await import("@/db");
    const { users, planYears, programs, programMilestones, documents, evidenceItems } = await import("@/db/schema");
    const { linkEvidence } = await import("@/lib/evidence");
    const { generateProgramReport } = await import("@/lib/reports/program-report");
    const { eq } = await import("drizzle-orm");

    const [u] = await db.insert(users).values({ username: "t-report", displayName: "اختبار", passwordHash: "x" }).returning();
    const [year] = await db.insert(planYears).values({ key: "rpt-yr", nameAr: "سنة تقرير" }).returning();
    const [program] = await db
      .insert(programs)
      .values({
        planYearId: year.id,
        seq: 1,
        domain: "مجال تجريبي",
        name: "برنامج تقرير تجريبي",
        hijriEnd: "1449/1/5",
        progress: 40,
      })
      .returning();
    await db.insert(programMilestones).values({ programId: program.id, title: "معلم تجريبي", weight: 100, progress: 40 });
    const [ev] = await db
      .insert(evidenceItems)
      .values({ title: "شاهد نصي تجريبي", kind: "text", textContent: "مضمون الشاهد النصي للاختبار", role: "تنفيذ" })
      .returning();
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: program.id });

    const result = await generateProgramReport({
      programId: program.id,
      withSignature: false,
      withStamp: false,
      issuedBy: u.id,
    });

    expect(result.docNumber).toMatch(/^KHS-DOC-\d{5}$/);

    const [doc] = await db.select().from(documents).where(eq(documents.id, result.docId));
    expect(doc.verificationCode).toHaveLength(8);
    // اللقطة تتضمن المحتوى العربي ومضمون الشاهد لا اسم ملف فقط
    expect(doc.htmlSnapshot).toContain("برنامج تقرير تجريبي");
    expect(doc.htmlSnapshot).toContain("مضمون الشاهد النصي للاختبار");
    expect(doc.htmlSnapshot).toContain("1449/1/5");
    expect(doc.htmlSnapshot).toContain('dir="rtl"');

    // ملف PDF فعلي
    const { readStoredFile } = await import("@/lib/storage");
    const pdf = await readStoredFile(result.pdfFileId);
    expect(pdf).not.toBeNull();
    expect(pdf!.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf!.data.length).toBeGreaterThan(10_000);
  }, 60_000);
});

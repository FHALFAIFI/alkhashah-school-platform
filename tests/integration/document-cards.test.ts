import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.3 §18/§20 — بطاقة تكليف المنفذ وخطاب بلاغ الصيانة:
 * إصدار حقيقي عبر خط الوثائق (رقم + رمز تحقق + لقطة مجمّدة + PDF)، الإصدار
 * الجديد لا يمس السابق، وخطاب المسودة يُرفض قبل الاعتماد.
 */

let pool: Pool;
let userId = "";
let programId = "";
let issueId = "";

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears, programs, maintenanceIssues } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-cards", displayName: "مصدر الوثائق", passwordHash: "x" }).returning();
  userId = u.id;
  const [year] = await db.insert(planYears).values({ key: "cards-1448", nameAr: "سنة البطاقات", status: "نشطة" }).returning();
  const [program] = await db
    .insert(programs)
    .values({
      planYearId: year.id,
      seq: 7,
      domain: "التحصيل الدراسي",
      name: "برنامج تحسين القراءة",
      targetGroup: "طلاب الصف الرابع",
      mechanism: "حصص إثرائية أسبوعية",
      deliverableText: "تقرير قياس قبلي وبعدي",
      evidenceText: "صور الحصص ونتائج القياس",
      followupText: "متابعة أسبوعية من الوكيل",
      principalNotes: "التركيز على الطلاب المتعثرين",
      hijriStart: "1448/3/20",
      hijriEnd: "1448/5/10",
    })
    .returning();
  programId = program.id;
  const [issue] = await db
    .insert(maintenanceIssues)
    .values({
      code: "KHS-MNT-9001",
      title: "تسرب مياه في دورة المياه",
      description: "تسرب من الخزان العلوي",
      priority: "عالية",
      status: "معتمد",
      sentTo: "شركة الصيانة المتحدة",
      sentAt: "2026-08-02",
      reportedBy: userId,
    })
    .returning();
  issueId = issue.id;
});

afterAll(async () => {
  await pool.end();
});

describe("بطاقة تكليف المنفذ (§20)", () => {
  it("تُصدر وثيقة مرقّمة بلقطة مجمّدة وPDF — والإصدار الجديد لا يمس السابق", async () => {
    const { generateProgramCard } = await import("@/lib/reports/program-card");
    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");

    const first = await generateProgramCard({ programId, issuedBy: userId });
    expect(first.docNumber).toMatch(/KHS-DOC-/);

    const [doc] = await db.select().from(documents).where(eq(documents.id, first.documentId));
    expect(doc.docType).toBe("program_card");
    expect(doc.htmlSnapshot).toContain("برنامج تحسين القراءة");
    expect(doc.htmlSnapshot).toContain("بطاقة تكليف");
    expect(doc.htmlSnapshot).toContain("إقرار المكلف بالتنفيذ");
    expect(doc.htmlSnapshot).toContain("1448/3/20هـ"); // الهجري الرسمي حرفياً
    expect(doc.htmlSnapshot).toContain("data:image/png;base64"); // رمز QR محلي
    expect(doc.pdfFileId).toBeTruthy();

    const firstSnapshot = doc.htmlSnapshot;
    const second = await generateProgramCard({ programId, issuedBy: userId });
    expect(second.documentId).not.toBe(first.documentId);
    const [firstAfter] = await db.select().from(documents).where(eq(documents.id, first.documentId));
    expect(firstAfter.htmlSnapshot).toBe(firstSnapshot); // لا كتابة فوق وثيقة صادرة
  }, 120_000);
});

describe("خطاب بلاغ الصيانة (§18)", () => {
  it("يُصدر الخطاب ويربطه بالبلاغ — والمسودة تُرفض", async () => {
    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    const { db } = await import("@/db");
    const { documents, maintenanceIssues } = await import("@/db/schema");

    const result = await generateMaintenanceLetter({ issueId, issuedBy: userId });
    const [doc] = await db.select().from(documents).where(eq(documents.id, result.documentId));
    expect(doc.docType).toBe("maintenance_letter");
    expect(doc.htmlSnapshot).toContain("KHS-MNT-9001");
    expect(doc.htmlSnapshot).toContain("شركة الصيانة المتحدة");
    expect(doc.htmlSnapshot).toContain("النتيجة النهائية");

    const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issueId));
    expect(issue.documentId).toBe(result.documentId);

    const [draft] = await db
      .insert(maintenanceIssues)
      .values({ code: "KHS-MNT-9002", title: "مسودة", status: "مسودة" })
      .returning();
    await expect(generateMaintenanceLetter({ issueId: draft.id, issuedBy: userId })).rejects.toThrow("اعتمد البلاغ");
  }, 120_000);
});

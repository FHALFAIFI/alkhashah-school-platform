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

async function seedSession(over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { people, perfModels, perfCycles, perfSessions, documents } = await import("@/db/schema");
  const [person] = await db.insert(people).values({ fullName: "معلم", category: "معلم" }).returning();
  const [model] = await db.insert(perfModels).values({ key: `m-${Math.floor(person.id.charCodeAt(0))}`, nameAr: "نموذج", audience: "معلم" }).returning();
  const [cycle] = await db
    .insert(perfCycles)
    .values({ personId: person.id, cycleType: "معلم", yearKey: "1448-1449", modelId: model.id, modelSnapshot: { indicators: [] } })
    .returning();
  const [doc] = await db
    .insert(documents)
    .values({ docNumber: `KHS-${cycle.id.slice(0, 8)}`, verificationCode: `VC-${cycle.id.slice(0, 8)}`, docType: "performance_report", title: "تقرير جلسة", entityType: "perf_session", entityId: cycle.id })
    .returning();
  const [session] = await db
    .insert(perfSessions)
    .values({ cycleId: cycle.id, sessionType: "نهائي", reportDocId: null, ...over })
    .returning();
  return { person, cycle, session, doc };
}

describe("التقارير الموقعة: التمييز والنسخ والتنبيه", () => {
  it("استبدال التقرير الموقع يحفظ النسخة السابقة ولا يفقدها", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { perfSessions, perfSignedReportVersions, storedFiles } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const { session } = await seedSession();
    const [f1] = await db.insert(storedFiles).values({ originalName: "s1.pdf", mime: "application/pdf", size: 1, sha256: "a", storagePath: `s1-${session.id}` }).returning();
    const [f2] = await db.insert(storedFiles).values({ originalName: "s2.pdf", mime: "application/pdf", size: 1, sha256: "b", storagePath: `s2-${session.id}` }).returning();

    // أول رفع — لا نسخة سابقة
    await db.update(perfSessions).set({ signedReportFileId: f1.id }).where(eq(perfSessions.id, session.id));

    // الاستبدال ينقل f1 إلى السجل قبل ضبط f2
    await db.transaction(async (tx) => {
      await tx.insert(perfSignedReportVersions).values({ sessionId: session.id, version: 1, fileId: f1.id, reason: "توقيع محدّث" });
      await tx.update(perfSessions).set({ signedReportFileId: f2.id }).where(eq(perfSessions.id, session.id));
    });

    const [updated] = await db.select().from(perfSessions).where(eq(perfSessions.id, session.id));
    expect(updated.signedReportFileId).toBe(f2.id);

    const versions = await db.select().from(perfSignedReportVersions).where(eq(perfSignedReportVersions.sessionId, session.id));
    expect(versions.length).toBe(1);
    expect(versions[0].fileId).toBe(f1.id);
    // الملف القديم ما زال موجوداً — لم يُحذف
    expect((await db.select().from(storedFiles).where(eq(storedFiles.id, f1.id))).length).toBe(1);
  });

  it("يميز «اكتمل التقييم» عن «استُلم التقرير الموقع» في لوحة التقارير الناقصة", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { perfSessions } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { missingSignedReports } = await import("@/lib/performance/signed-reports");

    const { session, doc } = await seedSession();
    // جلسة أصدرت تقريرها غير الموقع وعُلّم اكتمال تقييمها، بلا تقرير موقع
    await db
      .update(perfSessions)
      .set({ reportDocId: doc.id, evaluationCompletedAt: new Date(), status: "بانتظار التقرير الموقع" })
      .where(eq(perfSessions.id, session.id));

    const missing = await missingSignedReports();
    expect(missing.length).toBe(1);
    expect(missing[0].sessionId).toBe(session.id);
    expect(missing[0].evaluationCompletedAt).not.toBeNull();

    // بعد رفع التقرير الموقع تختفي من اللوحة
    const { storedFiles } = await import("@/db/schema");
    const [sf] = await db.insert(storedFiles).values({ originalName: "signed.pdf", mime: "application/pdf", size: 1, sha256: "z", storagePath: `signed-${session.id}` }).returning();
    await db.update(perfSessions).set({ signedReportFileId: sf.id }).where(eq(perfSessions.id, session.id));
    expect((await missingSignedReports()).length).toBe(0);
  });

  it("الحقول النصية الاختيارية موجودة ولا تُشترط", async () => {
    await truncateAll(pool);
    const { db } = await import("@/db");
    const { perfSessions } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { session } = await seedSession();

    // حفظ بلا أي حقل نصي — يبقى null ولا يفشل
    await db
      .update(perfSessions)
      .set({ principalComment: null, employeeComment: null, recommendations: null })
      .where(eq(perfSessions.id, session.id));
    const [s] = await db.select().from(perfSessions).where(eq(perfSessions.id, session.id));
    expect(s.principalComment).toBeNull();
    expect(s.employeeComment).toBeNull();
    expect(s.recommendations).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * D-065 — إصدار محضر الاجتماع: ما يُحفظ، وما يجب أن تعرضه الصفحة بعده.
 *
 * العطل الذي تثبّته هذه الاختبارات: الإصدار كان ينجح كاملاً في قاعدة البيانات — وثيقة
 * مرقّمة وملف PDF و`minutes_doc_id` — ولا يظهر على الشاشة شيء، لأن الإجراء انتهى بتحويل
 * لا يفرّقه عن العنوان الحالي إلا الوسم `#minutes`، وذاك انتقال وسم لا يطلب تصييراً جديداً.
 * فيظن المدير أن الزر لم يعمل فيضغطه ثانيةً، فتصدر وثيقة رسمية مكرّرة برقم جديد.
 *
 * لذلك يثبّت هنا شقّان لا شق واحد:
 *  1. الأثر المحفوظ — الوثيقة وصفّها ولقطتها وملف PDF فعلي و`minutes_doc_id` تشير إليه.
 *  2. عقد التحويل — وجهة الإجراء تحمل رقم الوثيقة الصادرة في معامل استعلام، فيختلف
 *     العنوان بأكثر من الوسم ويقع انتقال حقيقي، ويصير الرقم بذاته إثبات النتيجة.
 *
 * (المرحلة والرابط على الشاشة المُحدَّثة يثبّتهما سيناريو س3 في `tests/e2e/workflows.spec.ts`.)
 */

let pool: Pool;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);

  const { db } = await import("@/db");
  const { users, people, planYears, committees, committeeMembers, meetings, meetingTypes, meetingOutcomes } =
    await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: "t-minutes", displayName: "محاضر", passwordHash: "x" }).returning();
  ids.userId = u.id;

  const [chair] = await db.insert(people).values({ fullName: "خالد الرئيس", category: "معلم" }).returning();
  const [secretary] = await db.insert(people).values({ fullName: "ماجد المقرر", category: "موظف" }).returning();

  const [year] = await db.insert(planYears).values({ key: "min-yr", nameAr: "سنة المحاضر", status: "نشطة" }).returning();
  const [committee] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "اللجنة الإدارية للمدرسة", kind: "لجنة", status: "معتمدة" })
    .returning();
  ids.committeeId = committee.id;
  await db.insert(committeeMembers).values([
    { committeeId: committee.id, personId: chair.id, role: "رئيس", sortOrder: 1 },
    { committeeId: committee.id, personId: secretary.id, role: "مقرر", sortOrder: 2 },
  ]);

  const [type] = await db
    .insert(meetingTypes)
    .values({ key: "min-periodic", nameAr: "دوري", requiresSignature: false, sortOrder: 1 })
    .returning();

  const [meeting] = await db
    .insert(meetings)
    .values({
      committeeId: committee.id,
      typeId: type.id,
      seq: 1,
      title: "اجتماع إصدار المحضر",
      meetingDate: new Date("2026-08-08"),
      location: "قاعة الاجتماعات",
      agenda: ["بند أول", "بند ثانٍ"],
      discussion: "مناقشة تجريبية",
      status: "مسودة",
    })
    .returning();
  ids.meetingId = meeting.id;

  await db.insert(meetingOutcomes).values({
    meetingId: meeting.id,
    outcomeType: "قرار",
    text: "قرار متابعة تنفيذ التوصيات",
    sortOrder: 1,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("D-065 — إصدار المحضر الرسمي يُحفظ كاملاً", () => {
  it("يكتب الوثيقة ولقطتها وملف PDF ويربطها بالاجتماع في minutes_doc_id", async () => {
    const { db } = await import("@/db");
    const { documents, meetings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { generateMinutesDocument } = await import("@/lib/reports/minutes-report");
    const { readStoredFile } = await import("@/lib/storage");

    const issued = await generateMinutesDocument({ meetingId: ids.meetingId, issuedBy: ids.userId });
    expect(issued.docNumber).toMatch(/^KHS-DOC-\d{5}$/);

    // صفّ الوثيقة موجود فعلاً ومربوط بالاجتماع
    const [doc] = await db.select().from(documents).where(eq(documents.id, issued.docId));
    expect(doc).toBeTruthy();
    expect(doc.docType).toBe("meeting_minutes");
    expect(doc.entityType).toBe("meeting");
    expect(doc.entityId).toBe(ids.meetingId);
    expect(doc.verificationCode).toHaveLength(8);
    expect(doc.pdfFileId).toBe(issued.pdfFileId);

    // اللقطة هي المرجع الأبدي: محتوى المحضر العربي لا اسم ملف
    expect(doc.htmlSnapshot).toContain("اللجنة الإدارية للمدرسة");
    expect(doc.htmlSnapshot).toContain("قرار متابعة تنفيذ التوصيات");
    expect(doc.htmlSnapshot).toContain("خالد الرئيس");
    expect(doc.htmlSnapshot).toContain("ماجد المقرر");
    expect(doc.htmlSnapshot).toContain(issued.docNumber);
    expect(doc.htmlSnapshot).toContain('dir="rtl"');

    // ملف PDF فعلي على القرص لا سجل فارغ — هذا ما يفتحه رابط «تنزيل المحضر»
    const pdf = await readStoredFile(issued.pdfFileId);
    expect(pdf).not.toBeNull();
    expect(pdf!.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf!.data.length).toBeGreaterThan(10_000);
    expect(pdf!.file.mime).toBe("application/pdf");

    // الاجتماع يشير إلى الوثيقة — عليه تتوقف مرحلة سير العمل ورابط التنزيل في الصفحة
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, ids.meetingId));
    expect(meeting.minutesDocId).toBe(issued.docId);
  }, 90_000);

  it("رقم الوثيقة يتغير في كل إصدار، فلا يبدو الضغط الثاني بلا أثر", async () => {
    const { db } = await import("@/db");
    const { meetings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { generateMinutesDocument } = await import("@/lib/reports/minutes-report");

    const [before] = await db.select().from(meetings).where(eq(meetings.id, ids.meetingId));
    const again = await generateMinutesDocument({ meetingId: ids.meetingId, issuedBy: ids.userId });

    expect(again.docId).not.toBe(before.minutesDocId);
    const [after] = await db.select().from(meetings).where(eq(meetings.id, ids.meetingId));
    // الاجتماع يتبع آخر إصدار — فالوجهة الجديدة تعرض الوثيقة السارية لا وثيقة قديمة
    expect(after.minutesDocId).toBe(again.docId);
  }, 90_000);
});

describe("D-065 — وجهة الإجراء تفرض تصييراً جديداً", () => {
  const pageSource = readFileSync(
    path.join(process.cwd(), "src/app/(app)/committees/[id]/meetings/[mid]/page.tsx"),
    "utf8",
  );

  it("التحويل يحمل رقم الوثيقة في معامل استعلام لا وسماً وحده", () => {
    const target = /redirect\(`\/committees\/\$\{id\}\/meetings\/\$\{mid\}\?issued=([^`]*)`\)/.exec(pageSource);
    expect(target, "إجراء الإصدار لا ينتهي بتحويل يحمل معامل `issued`").not.toBeNull();
    expect(target![1]).toContain("docNumber");
  });

  it("التأكيد يُقرأ من الوثيقة المحفوظة لا من العنوان", () => {
    // رقم ملفَّق في العنوان لا يقابل محضر هذا الاجتماع يجب ألا يُعرض إطلاقاً
    expect(pageSource).toContain("minutesDoc[0]?.docNumber === issuedNumber");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { desc, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * D-032 — قبول المرفوعات على الخادم من الدور المصادَق حصراً.
 *
 * القواعد المثبتة هنا نص التكليف §5 حرفياً:
 *  - رفع المدير يُقبل تلقائياً فور الحفظ ولا يحتاج اعتماداً ثانياً منه.
 *  - رفع أي دور آخر يبقى «قيد الاعتماد» حتى يعتمده المدير يدوياً.
 *  - القرار من جدول الأدوار في القاعدة — لا قيمة من المتصفح إطلاقاً.
 *  - سجل التدقيق يذكر الطريقة نصاً: «قبول تلقائي بواسطة المدير» / «اعتماد يدوي بواسطة المدير».
 *  - فحوص أمان الملف تبقى نشطة حتى مع القبول التلقائي.
 *  - ملفات النظام المولّدة (نطاق reports) خارج آلية القبول.
 */

let pool: Pool;
let principalId = "";
let staffId = "";

// PNG صالح 1×1 (توقيع حقيقي يمر من فحص magic bytes)
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, roles, userRoles } = await import("@/db/schema");

  const [principalRole] = await db
    .insert(roles)
    .values({ key: "principal", nameAr: "مدير المدرسة" })
    .onConflictDoNothing()
    .returning();
  const roleId =
    principalRole?.id ??
    (await db.select().from(roles).where(eq(roles.key, "principal")))[0].id;

  const [p] = await db
    .insert(users)
    .values({ username: "t-principal", displayName: "المدير", passwordHash: "x" })
    .returning();
  principalId = p.id;
  await db.insert(userRoles).values({ userId: principalId, roleId });

  const [s] = await db
    .insert(users)
    .values({ username: "t-staff", displayName: "موظف", passwordHash: "x" })
    .returning();
  staffId = s.id;
});

afterAll(async () => {
  await pool.end();
});

async function latestAudit(entityId: string) {
  const { db } = await import("@/db");
  const { auditLog } = await import("@/db/schema");
  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(desc(auditLog.createdAt));
  return rows[0];
}

describe("D-032 — قبول المرفوعات", () => {
  it("رفع المدير يُقبل تلقائياً فوراً مع تسجيل هويته ووقته وطريقة القبول", async () => {
    const { saveUploadedFile } = await import("@/lib/storage");
    const file = await saveUploadedFile({
      originalName: "شاهد-المدير.png",
      mime: "image/png",
      data: PNG_1PX,
      scope: "attachments",
      uploadedBy: principalId,
    });
    expect(file.acceptanceStatus).toBe("مقبول");
    expect(file.acceptanceMode).toBe("قبول تلقائي بواسطة المدير");
    expect(file.acceptedBy).toBe(principalId);
    expect(file.acceptedAt).not.toBeNull();

    const audit = await latestAudit(file.id);
    expect(audit.action).toBe("file.auto_accepted");
    expect(audit.summary).toContain("قبول تلقائي بواسطة المدير");
  });

  it("رفع غير المدير يبقى «قيد الاعتماد» بلا مُعتمِد", async () => {
    const { saveUploadedFile } = await import("@/lib/storage");
    const file = await saveUploadedFile({
      originalName: "شاهد-موظف.png",
      mime: "image/png",
      data: PNG_1PX,
      scope: "attachments",
      uploadedBy: staffId,
    });
    expect(file.acceptanceStatus).toBe("قيد الاعتماد");
    expect(file.acceptanceMode).toBeNull();
    expect(file.acceptedBy).toBeNull();
    expect(file.acceptedAt).toBeNull();

    const audit = await latestAudit(file.id);
    expect(audit.action).toBe("file.pending_acceptance");
  });

  it("المدير يعتمد ملفاً معلقاً يدوياً — والطريقة «اعتماد يدوي بواسطة المدير» في التدقيق", async () => {
    const { saveUploadedFile, acceptStoredFile } = await import("@/lib/storage");
    const { db } = await import("@/db");
    const { storedFiles } = await import("@/db/schema");

    const file = await saveUploadedFile({
      originalName: "بانتظار-الاعتماد.png",
      mime: "image/png",
      data: PNG_1PX,
      scope: "attachments",
      uploadedBy: staffId,
    });
    const result = await acceptStoredFile({ fileId: file.id, actorId: principalId });
    expect(result.success).toBeTruthy();

    const [updated] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
    expect(updated.acceptanceStatus).toBe("مقبول");
    expect(updated.acceptanceMode).toBe("اعتماد يدوي بواسطة المدير");
    expect(updated.acceptedBy).toBe(principalId);

    const audit = await latestAudit(file.id);
    expect(audit.action).toBe("file.manually_accepted");
    expect(audit.summary).toContain("اعتماد يدوي بواسطة المدير");
  });

  it("غير المدير لا يستطيع اعتماد ملف — يُرفض والملف لا يتغير", async () => {
    const { saveUploadedFile, acceptStoredFile } = await import("@/lib/storage");
    const { db } = await import("@/db");
    const { storedFiles } = await import("@/db/schema");

    const file = await saveUploadedFile({
      originalName: "محاولة-اعتماد.png",
      mime: "image/png",
      data: PNG_1PX,
      scope: "attachments",
      uploadedBy: staffId,
    });
    const result = await acceptStoredFile({ fileId: file.id, actorId: staffId });
    expect(result.error).toBeTruthy();

    const [unchanged] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
    expect(unchanged.acceptanceStatus).toBe("قيد الاعتماد");
    expect(unchanged.acceptedBy).toBeNull();
  });

  it("ملفات النظام المولّدة (نطاق reports) خارج آلية القبول — لا تدخل الطابور", async () => {
    const { saveUploadedFile } = await import("@/lib/storage");
    const file = await saveUploadedFile({
      originalName: "KHS-DOC-0001.pdf",
      mime: "application/pdf",
      data: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64)]),
      scope: "reports",
      uploadedBy: staffId,
    });
    expect(file.acceptanceStatus).toBeNull();
    expect(file.acceptanceMode).toBeNull();
  });

  it("فحص أمان الملف يبقى نشطاً مع القبول التلقائي — محتوى مخالف يُرفض حتى من المدير", async () => {
    const { saveUploadedFile, UploadValidationError } = await import("@/lib/storage");
    await expect(
      saveUploadedFile({
        originalName: "مزيف.png",
        mime: "image/png",
        data: Buffer.from("<html>ليست صورة</html>"),
        scope: "attachments",
        uploadedBy: principalId,
      }),
    ).rejects.toThrow(UploadValidationError);
  });
});

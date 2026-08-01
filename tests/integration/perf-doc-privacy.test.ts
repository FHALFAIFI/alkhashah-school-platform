import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4 §16 (D-013) — خصوصية وثائق الأداء الفردية:
 * ملف PDF لوثيقة أداء لا يُنزَّل بصلاحية files.download وحدها — يتطلب
 * performance.individual.read أيضاً (كان تقرير الجلسة متاحاً لأي حامل تنزيل).
 */

let pool: Pool;
let userId = "";
let permissions = new Set<string>(["files.download"]);

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: userId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions,
    roleKeys: new Set<string>(),
    csrfToken: "x",
    sessionId: "x",
  })),
  requirePermission: vi.fn(async () => ({ id: userId, permissions, csrfToken: "x", sessionId: "x" })),
  requireUser: vi.fn(async () => ({ id: userId, permissions: new Set() })),
  AuthError: class extends Error {
    status = 403;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let perfPdfFileId = "";
let normalPdfFileId = "";

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, documents } = await import("@/db/schema");
  const { saveUploadedFile } = await import("@/lib/storage");
  const [u] = await db.insert(users).values({ username: "t-privacy", displayName: "اختبار الخصوصية", passwordHash: "x" }).returning();
  userId = u.id;

  const pdfBytes = Buffer.from("%PDF-1.4 test");
  const perfFile = await saveUploadedFile({ originalName: "perf.pdf", mime: "application/pdf", data: pdfBytes, scope: "reports", uploadedBy: userId });
  perfPdfFileId = perfFile.id;
  const normalFile = await saveUploadedFile({ originalName: "normal.pdf", mime: "application/pdf", data: pdfBytes, scope: "reports", uploadedBy: userId });
  normalPdfFileId = normalFile.id;

  await db.insert(documents).values({
    docNumber: "KHS-DOC-77001",
    verificationCode: "AB12CD34",
    docType: "employee_performance_report",
    title: "تقرير أداء تجريبي",
    htmlSnapshot: "<p>لقطة</p>",
    pdfFileId: perfPdfFileId,
    issuedBy: userId,
  });
  await db.insert(documents).values({
    docNumber: "KHS-DOC-77002",
    verificationCode: "EF56GH78",
    docType: "committee_report",
    title: "تقرير لجنة تجريبي",
    htmlSnapshot: "<p>لقطة</p>",
    pdfFileId: normalPdfFileId,
    issuedBy: userId,
  });
});

afterAll(async () => {
  await pool.end();
});

async function download(fileId: string): Promise<number> {
  const { GET } = await import("@/app/api/files/[id]/route");
  const res = await GET(new NextRequest(`http://localhost/api/files/${fileId}`), {
    params: Promise.resolve({ id: fileId }),
  });
  return res.status;
}

describe("تنزيل وثائق الأداء الفردية (D-013)", () => {
  it("يُرفض بصلاحية التنزيل وحدها ويُقبل مع صلاحية الأداء الفردي", async () => {
    permissions = new Set(["files.download"]);
    expect(await download(perfPdfFileId)).toBe(403);

    permissions = new Set(["files.download", "performance.individual.read"]);
    expect(await download(perfPdfFileId)).toBe(200);
  });

  it("الوثائق غير الحساسة تبقى متاحة بصلاحية التنزيل وحدها", async () => {
    permissions = new Set(["files.download"]);
    expect(await download(normalPdfFileId)).toBe(200);
  });
});

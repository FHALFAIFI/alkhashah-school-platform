import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import AdmZip from "adm-zip";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.6 §B/§G/§I — المخرجات المحفوظة والتوليد الخلفي (D-059/D-060).
 *
 * العقود المثبَّتة:
 *  1. مخرج (تقرير، صيغة) يُولَّد مرة واحدة — الإعادة تعيد الصف القائم لا ملفاً ثانياً.
 *  2. مخرجات المسودة لا تُحفظ إطلاقاً.
 *  3. مهمة نشطة واحدة لكل تقرير؛ الطلب الثاني يخسر بوضوح؛ المنقطعة تعاد بمحاولة أعلى.
 *  4. `runJob` يكمل الناقص فقط، ويجمّع ZIP سليمة تُقرأ وتُستخرج فعلاً.
 *  5. النسخة الموقّعة تدخل الحزمة عند إعادة تجميعها (D-060).
 */

let pool: Pool;
let userId = "";
let yearId = "";
let seq = 1;

const FULL = new Set([
  "reports.read",
  "reports.builder",
  "reports.generate",
  "documents.issue",
  "plan.read",
]);
const viewer = () => ({ id: userId, permissions: FULL });

async function finalizedInstance(): Promise<string> {
  const { createInstance, finalizeInstance } = await import("@/lib/reports/instances/service");
  const created = await createInstance(
    { title: `تقرير مخرجات ${seq++}`, typeKey: "single", options: { reportKey: "programs-active" } },
    viewer(),
  );
  expect(created.error).toBeUndefined();
  const fin = await finalizeInstance(created.instanceId!, viewer());
  expect(fin.error).toBeUndefined();
  return created.instanceId!;
}

async function getRow(id: string) {
  const { db } = await import("@/db");
  const { reportInstances } = await import("@/db/schema");
  const [row] = await db.select().from(reportInstances).where(eq(reportInstances.id, id));
  return row;
}

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears, programs } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-out", displayName: "اختبار", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "out-yr", nameAr: "سنة المخرجات", status: "نشطة" }).returning();
  yearId = y.id;
  await db.insert(programs).values({ planYearId: yearId, seq: 1, domain: "التعليم", name: "برنامج المخرجات", status: "معتمد" });
});

afterAll(async () => {
  await pool.end();
});

describe("§B — المخرجات المحفوظة", () => {
  it("توليد صيغة محفوظة متكرّر بأمان: الملف نفسه لا ملف ثانٍ", async () => {
    const { ensureStoredOutput } = await import("@/lib/reports/instances/outputs");
    const id = await finalizedInstance();
    const row = await getRow(id);

    const first = await ensureStoredOutput(row, "xlsx", userId);
    expect(first.created).toBe(true);
    const second = await ensureStoredOutput(row, "xlsx", userId);
    expect(second.created).toBe(false);
    expect(second.fileId).toBe(first.fileId);

    const { db } = await import("@/db");
    const { reportOutputs } = await import("@/db/schema");
    const rows = await db.select().from(reportOutputs).where(eq(reportOutputs.instanceId, id));
    expect(rows.filter((r) => r.format === "xlsx")).toHaveLength(1);
  });

  it("مخرجات المسودة لا تُحفظ", async () => {
    const { createInstance } = await import("@/lib/reports/instances/service");
    const { ensureStoredOutput } = await import("@/lib/reports/instances/outputs");
    const created = await createInstance(
      { title: "مسودة مخرجات", typeKey: "single", options: { reportKey: "programs-active" } },
      viewer(),
    );
    const row = await getRow(created.instanceId!);
    await expect(ensureStoredOutput(row, "xlsx", userId)).rejects.toThrow(/المسودة/);
  });

  it("اسم الملف: «العنوان الكامل - تاريخ الإنشاء» (§G)", async () => {
    const { ensureStoredOutput } = await import("@/lib/reports/instances/outputs");
    const id = await finalizedInstance();
    const row = await getRow(id);
    await ensureStoredOutput(row, "docx", userId);

    const { db } = await import("@/db");
    const { reportOutputs, storedFiles } = await import("@/db/schema");
    const [output] = await db
      .select({ name: storedFiles.originalName })
      .from(reportOutputs)
      .innerJoin(storedFiles, eq(reportOutputs.fileId, storedFiles.id))
      .where(eq(reportOutputs.instanceId, id));
    expect(output.name).toContain(row.title);
    expect(output.name).toMatch(/ - \d{4}-\d{2}-\d{2}\.docx$/);
  });
});

describe("§I — مهام التوليد الخلفي", () => {
  it("المهمة تعمل حتى الاكتمال وتجمّع حزمة سليمة، وإعادتها لا تكرر شيئاً", async () => {
    const { requestGeneration, runJob, latestJob } = await import("@/lib/reports/instances/jobs");
    const { readOutput } = await import("@/lib/reports/instances/outputs");
    const { verifyZip } = await import("@/lib/reports/instances/export-zip");
    const id = await finalizedInstance();

    const req = await requestGeneration(id, ["xlsx", "docx"], viewer());
    expect(req.error).toBeUndefined();
    await runJob(req.jobId!);

    const job = await latestJob(id);
    expect(job!.status).toBe("مكتمل");

    const zip = await readOutput(id, "zip");
    expect(zip).toBeTruthy();
    const archive = new AdmZip(zip!.data);
    const names = archive.getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.endsWith(".xlsx"))).toBe(true);
    expect(names.some((n) => n.endsWith(".docx"))).toBe(true);
    expect(verifyZip(zip!.data, names)).toBe(true);

    // الإعادة: مهمة جديدة تكمل ولا تكرر — عدد المخرجات ثابت
    const { db } = await import("@/db");
    const { reportOutputs } = await import("@/db/schema");
    const before = await db.select().from(reportOutputs).where(eq(reportOutputs.instanceId, id));
    const again = await requestGeneration(id, ["xlsx", "docx"], viewer());
    expect(again.error).toBeUndefined();
    await runJob(again.jobId!);
    const after = await db.select().from(reportOutputs).where(eq(reportOutputs.instanceId, id));
    expect(after.filter((o) => o.format !== "zip")).toHaveLength(before.filter((o) => o.format !== "zip").length);
  });

  it("مهمة نشطة واحدة: الطلب الثاني يخسر بوضوح لا بصمت", async () => {
    const { requestGeneration } = await import("@/lib/reports/instances/jobs");
    const id = await finalizedInstance();
    const first = await requestGeneration(id, ["xlsx"], viewer());
    expect(first.error).toBeUndefined();
    const second = await requestGeneration(id, ["xlsx"], viewer());
    expect(second.error).toContain("جارٍ فعلاً");
  });

  it("المهمة المنقطعة (نبض قديم) تُغلق بسبب صريح وتُعاد بمحاولة أعلى", async () => {
    const { requestGeneration } = await import("@/lib/reports/instances/jobs");
    const id = await finalizedInstance();
    const first = await requestGeneration(id, ["xlsx"], viewer());
    expect(first.error).toBeUndefined();

    // محاكاة الانقطاع: مهمة «قيد التنفيذ» نبضها أقدم من النافذة
    await pool.query(
      `UPDATE report_jobs SET status = 'قيد التنفيذ', heartbeat_at = now() - interval '10 minutes' WHERE id = $1`,
      [first.jobId],
    );

    const retry = await requestGeneration(id, ["xlsx"], viewer());
    expect(retry.error).toBeUndefined();
    const { rows } = await pool.query(`SELECT status, attempt, error FROM report_jobs WHERE instance_id = $1 ORDER BY created_at`, [id]);
    expect(rows[0].status).toBe("فشل");
    expect(rows[0].error).toContain("انقطع");
    expect(rows[1].attempt).toBe(2);
  });

  it("طلب التوليد لمسودة يُرفض بإرشاد واضح", async () => {
    const { createInstance } = await import("@/lib/reports/instances/service");
    const { requestGeneration } = await import("@/lib/reports/instances/jobs");
    const created = await createInstance(
      { title: "مسودة توليد", typeKey: "single", options: { reportKey: "programs-active" } },
      viewer(),
    );
    const refused = await requestGeneration(created.instanceId!, ["pdf"], viewer());
    expect(refused.error).toContain("اعتمد التقرير أولاً");
  });
});

describe("§B/§G — النسخة الموقّعة والحزمة", () => {
  it("النسخة الموقّعة تدخل الحزمة عند إعادة تجميعها", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const { attachSignedCopy } = await import("@/lib/reports/instances/service");
    const { rebuildZip, readOutput } = await import("@/lib/reports/instances/outputs");
    const { saveUploadedFile } = await import("@/lib/storage");
    const id = await finalizedInstance();

    const req = await requestGeneration(id, ["xlsx"], viewer());
    await runJob(req.jobId!);

    // نسخة موقّعة PDF صالحة التوقيع (%PDF-)
    const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("محتوى موقّع"), Buffer.from("\n%%EOF")]);
    const file = await saveUploadedFile({
      originalName: "التقرير الموقع.pdf",
      mime: "application/pdf",
      data: pdfBytes,
      scope: "reports",
      uploadedBy: userId,
    });
    const attached = await attachSignedCopy(id, file.id, viewer());
    expect(attached.error).toBeUndefined();

    const row = await getRow(id);
    await rebuildZip(row, userId);
    const zip = await readOutput(id, "zip");
    const names = new AdmZip(zip!.data).getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.includes("النسخة الموقعة"))).toBe(true);
  });
});

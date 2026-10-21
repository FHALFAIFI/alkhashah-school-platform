import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.6 — البلوكرات التي رفعتها المراجعة المستقلة، مثبَّتة اختباراتٍ لا وعوداً.
 *
 *  §5 سباق الاعتماد: لا لقطة تُعتمد من إعدادات مسودة قديمة — قفل تفاؤلي على `updated_at`.
 *  §6 متانة الحزمة: لا حزمة قديمة قابلة للتنزيل بعد وصول نسخة موقّعة؛ الإعادة تقرأ
 *     المرجع الراهن؛ الفشل يظهر ولا يُبتلع.
 *  §7 قادح صفّ ZIP: الملف وبصمته وحجمه فقط — لا صيغة ولا تقرير ولا هوية.
 *  §8 فحص البايتات: العبث بالملف على القرص يُرفض بنتيجة «معطوب» صريحة.
 */

let pool: Pool;
let userId = "";
let yearId = "";
let seq = 1;

const FULL = new Set(["reports.read", "reports.builder", "reports.generate", "documents.issue", "plan.read"]);
const viewer = () => ({ id: userId, permissions: FULL });

async function getRow(id: string) {
  const { db } = await import("@/db");
  const { reportInstances } = await import("@/db/schema");
  const [row] = await db.select().from(reportInstances).where(eq(reportInstances.id, id));
  return row;
}

async function draft(title = `تقرير بلوكرات ${seq++}`): Promise<string> {
  const { createInstance } = await import("@/lib/reports/instances/service");
  const created = await createInstance(
    { title, typeKey: "single", options: { reportKey: "programs-active" } },
    viewer(),
  );
  expect(created.error).toBeUndefined();
  return created.instanceId!;
}

async function finalized(): Promise<string> {
  const { finalizeInstance } = await import("@/lib/reports/instances/service");
  const id = await draft();
  const fin = await finalizeInstance(id, viewer());
  expect(fin.error).toBeUndefined();
  return id;
}

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 4 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears, programs } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-blockers", displayName: "بلوكرات", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "blk-yr", nameAr: "سنة البلوكرات", status: "نشطة" }).returning();
  yearId = y.id;
  await db.insert(programs).values({ planYearId: yearId, seq: 1, domain: "التعليم", name: "برنامج البلوكرات", status: "معتمد" });
});

afterAll(async () => {
  await pool.end();
});

describe("§5 — سباق الاعتماد لا يجمّد إعدادات قديمة", () => {
  /**
   * حتمي بترتيب الأقفال لا بالتوقيت، وبلا أي محاكاة: الاختبار يمسك قفل صفّ المسودة أولاً،
   * ثم يبدأ الاعتماد — فيبني لقطته على الحالة القديمة ثم **يتوقف** على `FOR UPDATE`. عندها
   * يعدّل الاختبار العنوان ويُنهي معاملته، فيستأنف الاعتماد ويجد `updated_at` قد تغيّر.
   * المطلوب: تُرمى اللقطة القديمة ويُعاد البناء، فيُعتمد العنوان الأحدث لا الأقدم.
   */
  it("تعديل يهبط بين بناء اللقطة وقفل الصفّ يُبطل المحاولة ويُعاد البناء من آخر حالة", async () => {
    const { finalizeInstance } = await import("@/lib/reports/instances/service");
    const id = await draft("عنوان قبل التعديل");

    const holder = new Pool({ connectionString: TEST_DB_URL, max: 1 });
    const client = await holder.connect();
    await client.query("BEGIN");
    await client.query("SELECT id FROM report_instances WHERE id = $1 FOR UPDATE", [id]);

    // الاعتماد يبدأ الآن: يبني اللقطة على «عنوان قبل التعديل» ثم يتوقف على القفل المملوك
    const finalizing = finalizeInstance(id, viewer());
    await new Promise((r) => setTimeout(r, 300));

    await client.query(
      "UPDATE report_instances SET title = $2, updated_at = now() + interval '1 second' WHERE id = $1",
      [id, "عنوان بعد التعديل"],
    );
    await client.query("COMMIT");
    client.release();
    await holder.end();

    const result = await finalizing;
    expect(result.error).toBeUndefined();

    const row = await getRow(id);
    expect(row.status).toBe("نهائي");
    expect(row.title).toBe("عنوان بعد التعديل");
    // الجوهر: اللقطة المجمّدة بُنيت من آخر حالة للمسودة لا من الحالة التي بدأ بها الاعتماد
    expect((row.snapshot as { title: string }).title).toBe("عنوان بعد التعديل");
  });

  it("اعتمادان متزامنان: رقم واحد ولقطة واحدة", async () => {
    const { finalizeInstance } = await import("@/lib/reports/instances/service");
    const id = await draft();
    const [a, b] = await Promise.all([finalizeInstance(id, viewer()), finalizeInstance(id, viewer())]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(a.reportNumber).toBe(b.reportNumber);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM report_instances WHERE id = $1 AND report_number IS NOT NULL", [id]);
    expect(rows[0].n).toBe(1);
  });
});

describe("§6 — متانة إعادة تجميع الحزمة", () => {
  async function attachSigned(id: string, label: string) {
    const { saveUploadedFile } = await import("@/lib/storage");
    const { attachSignedCopy } = await import("@/lib/reports/instances/service");
    const data = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(label), Buffer.from("\n%%EOF")]);
    const file = await saveUploadedFile({
      originalName: `${label}.pdf`,
      mime: "application/pdf",
      data,
      scope: "reports",
      uploadedBy: userId,
    });
    const result = await attachSignedCopy(id, file.id, viewer());
    expect(result.error).toBeUndefined();
    return file.id;
  }

  it("ربط نسخة موقّعة يزيل الحزمة القديمة فوراً — لا حزمة ناقصة قابلة للتنزيل", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const { readOutput } = await import("@/lib/reports/instances/outputs");
    const id = await finalized();
    const job = await requestGeneration(id, ["xlsx"], viewer());
    await runJob(job.jobId!);
    expect(await readOutput(id, "zip")).toBeTruthy();

    await attachSigned(id, "نسخة أولى");
    // النافذة بين الربط وإعادة التجميع لا تحمل حزمة قديمة إطلاقاً
    expect(await readOutput(id, "zip")).toBeNull();
  });

  it("إعادة التجميع تقرأ مرجع النسخة الراهن — الاستبدال قبل التنفيذ يفوز", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const { readOutput } = await import("@/lib/reports/instances/outputs");
    const id = await finalized();
    await runJob((await requestGeneration(id, ["xlsx"], viewer())).jobId!);

    await attachSigned(id, "نسخة أولى");
    const zipJob = await requestGeneration(id, ["zip"], viewer());
    expect(zipJob.error).toBeUndefined();
    // الاستبدال يقع **بعد** جدولة المهمة وقبل تنفيذها
    await attachSigned(id, "نسخة ثانية بديلة");
    await runJob(zipJob.jobId!);

    const zip = await readOutput(id, "zip");
    if (!zip || "corrupt" in zip) throw new Error("حزمة غائبة أو معطوبة");
    const names = new AdmZip(zip.data).getEntries().map((e) => e.entryName);
    expect(names.some((n) => n.includes("نسخة ثانية بديلة"))).toBe(true);
    expect(names.some((n) => n.includes("نسخة أولى"))).toBe(false);
  });

  it("فشل إعادة التجميع يُسجَّل في المهمة بسببه ولا يُبتلع، والإعادة تنجح", async () => {
    const { requestGeneration, runJob, latestJob } = await import("@/lib/reports/instances/jobs");
    const { readOutput } = await import("@/lib/reports/instances/outputs");
    const id = await finalized();
    // لا مخرجات محفوظة بعد: تجميع الحزمة يفشل حتماً برسالة عربية
    const failing = await requestGeneration(id, ["zip"], viewer());
    await runJob(failing.jobId!);
    const failed = await latestJob(id);
    expect(failed!.status).toBe("فشل");
    expect(failed!.error).toContain("لا مخرجات محفوظة");

    // الإعادة مع صيغة فعلية تُكمل الناقص وتجمّع الحزمة
    const retry = await requestGeneration(id, ["xlsx"], viewer());
    expect(retry.error).toBeUndefined();
    expect(retry.jobId).not.toBe(failing.jobId);
    await runJob(retry.jobId!);
    expect((await latestJob(id))!.status).toBe("مكتمل");
    expect(await readOutput(id, "zip")).toBeTruthy();
  });

  it("انقطاع المهمة أثناء التجميع: المخرجات المكتملة تبقى والإعادة تكمل", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const { readOutput } = await import("@/lib/reports/instances/outputs");
    const id = await finalized();
    await runJob((await requestGeneration(id, ["xlsx"], viewer())).jobId!);

    // محاكاة انقطاع: المهمة عالقة «قيد التنفيذ» بنبض قديم
    await pool.query(
      `INSERT INTO report_jobs (instance_id, formats, status, heartbeat_at, requested_by)
       VALUES ($1, '["zip"]'::jsonb, 'قيد التنفيذ', now() - interval '10 minutes', $2)`,
      [id, userId],
    );
    const recovered = await requestGeneration(id, ["zip"], viewer());
    expect(recovered.error).toBeUndefined();
    await runJob(recovered.jobId!);
    expect(await readOutput(id, "zip")).toBeTruthy();
    const { rows } = await pool.query(`SELECT status, error FROM report_jobs WHERE instance_id = $1 ORDER BY created_at`, [id]);
    expect(rows.some((r: { status: string; error: string | null }) => r.status === "فشل" && (r.error ?? "").includes("انقطع"))).toBe(true);
    expect(rows[rows.length - 1].status).toBe("مكتمل");
  });
});

describe("§7 — قادح صفّ ZIP يسمح باستبدال الملف وحده", () => {
  it("تبديل الملف والبصمة والحجم مسموح؛ الصيغة والتقرير والمعرّف مرفوضة", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const id = await finalized();
    const other = await finalized();
    await runJob((await requestGeneration(id, ["xlsx"], viewer())).jobId!);

    const { rows } = await pool.query(`SELECT id, file_id FROM report_outputs WHERE instance_id = $1 AND format = 'zip'`, [id]);
    const zipRow = rows[0];

    // المسموح
    await expect(
      pool.query(`UPDATE report_outputs SET checksum = 'deadbeef', size = 123, created_at = now() WHERE id = $1`, [zipRow.id]),
    ).resolves.toBeTruthy();

    // الممنوع
    await expect(
      pool.query(`UPDATE report_outputs SET format = 'pdf' WHERE id = $1`, [zipRow.id]),
    ).rejects.toThrow(/D-060/);
    await expect(
      pool.query(`UPDATE report_outputs SET instance_id = $2 WHERE id = $1`, [zipRow.id, other]),
    ).rejects.toThrow(/D-060/);
    await expect(
      pool.query(`UPDATE report_outputs SET id = gen_random_uuid() WHERE id = $1`, [zipRow.id]),
    ).rejects.toThrow(/D-060/);
  });

  it("مخرجات غير ZIP تبقى مجمّدة تماماً", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const id = await finalized();
    await runJob((await requestGeneration(id, ["xlsx"], viewer())).jobId!);
    await expect(
      pool.query(`UPDATE report_outputs SET checksum = 'x' WHERE instance_id = $1 AND format = 'xlsx'`, [id]),
    ).rejects.toThrow(/D-055/);
    await expect(
      pool.query(`DELETE FROM report_outputs WHERE instance_id = $1 AND format = 'xlsx'`, [id]),
    ).rejects.toThrow(/D-055/);
  });
});

describe("§8 — فحص البايتات الفعلية يرفض العبث بالملف المخزَّن", () => {
  it("تعديل بايت واحد على القرص يجعل القراءة تعيد «معطوب» لا محتوى", async () => {
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const { readOutput } = await import("@/lib/reports/instances/outputs");
    const { db } = await import("@/db");
    const { reportOutputs, storedFiles } = await import("@/db/schema");
    const id = await finalized();
    await runJob((await requestGeneration(id, ["xlsx"], viewer())).jobId!);

    const healthy = await readOutput(id, "xlsx");
    expect(healthy && !("corrupt" in healthy)).toBe(true);

    const [row] = await db
      .select({ storagePath: storedFiles.storagePath })
      .from(reportOutputs)
      .innerJoin(storedFiles, eq(reportOutputs.fileId, storedFiles.id))
      .where(eq(reportOutputs.instanceId, id));
    const full = path.resolve(process.env.STORAGE_DIR!, row.storagePath);
    const bytes = readFileSync(full);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff; // قلب بايت واحد في منتصف الملف
    writeFileSync(full, bytes);

    const tampered = await readOutput(id, "xlsx");
    expect(tampered && "corrupt" in tampered).toBe(true);
  });

  it("العبث بالنسخة الموقّعة يُرفض كذلك", async () => {
    const { saveUploadedFile } = await import("@/lib/storage");
    const { attachSignedCopy } = await import("@/lib/reports/instances/service");
    const { readSignedCopy } = await import("@/lib/reports/instances/outputs");
    const { db } = await import("@/db");
    const { storedFiles } = await import("@/db/schema");
    const id = await finalized();
    const file = await saveUploadedFile({
      originalName: "موقعة للعبث.pdf",
      mime: "application/pdf",
      data: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x41), Buffer.from("\n%%EOF")]),
      scope: "reports",
      uploadedBy: userId,
    });
    await attachSignedCopy(id, file.id, viewer());
    const [stored] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
    const full = path.resolve(process.env.STORAGE_DIR!, stored.storagePath);
    const bytes = readFileSync(full);
    bytes[10] ^= 0xff;
    writeFileSync(full, bytes);

    const read = await readSignedCopy(await getRow(id));
    expect(read && "corrupt" in read).toBe(true);
  });
});

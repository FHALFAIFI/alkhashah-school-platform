import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { synthetic52PeopleWorkbook } from "../helpers/fixtures";

/**
 * تقوية تأكيد الاستيراد عبر الواجهة الحقيقية على الجوال (390×844):
 * - تأكيد ناجح يُنشئ 52 شخصاً بالضبط وحدثَي تدقيق (بدء + تنفيذ) واحدَين فقط.
 * - انتهاء الجلسة عند النقر: رسالة عربية ورابط دخول returnTo، الدفعة تبقى «معاينة»، ثم إعادة دخول وتنفيذ.
 * - استجابة غير مؤكدة: الخادم ينفّذ والعميل يفقد الرد → إعادة التحميل تُظهر «منفذة» بلا تكرار.
 * تعمل على قاعدة madrasa_test المعزولة فقط.
 */

test.use({ viewport: { width: 390, height: 844 }, locale: "ar-SA" });

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEST_DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}

async function submitLoginForm(page: Page) {
  const creds = principalCredentials();
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
}

async function login(page: Page) {
  await page.goto("/login");
  await submitLoginForm(page);
  await page.waitForURL("**/dashboard");
}

/** يرفع دفعة 52 صفاً جاهزاً عبر الواجهة ويعيد معرّفها (بحالة «معاينة»). */
async function uploadReady52Batch(page: Page): Promise<string> {
  await page.goto("/imports/new?type=people");
  await page.setInputFiles("#file", { name: "commit-52.xlsx", mimeType: XLSX_MIME, buffer: await synthetic52PeopleWorkbook() });
  await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

async function cleanupBatch(pool: Pool, batchId: string) {
  if (!batchId) return;
  await pool.query("DELETE FROM people WHERE import_batch_id=$1", [batchId]);
  await pool.query("DELETE FROM import_batches WHERE id=$1", [batchId]);
}

test("تأكيد الاستيراد على الجوال: 52 شخصاً بالضبط + حدث تنفيذ واحد + إعادة التحميل لا تُكرِّر", async ({ page }) => {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  let batchId = "";
  try {
    await login(page);
    batchId = await uploadReady52Batch(page);

    await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
    await expect(page.getByText("تأكيد استيراد بيانات الموظفين")).toBeVisible();
    await expect(page.locator("li", { hasText: "عدد الصفوف الجاهزة" })).toContainText("52");

    const execBtn = page.getByRole("button", { name: "تأكيد التنفيذ", exact: true });
    await expect(execBtn).toBeVisible();
    await execBtn.click();
    await expect(page.getByText("تم الاستيراد", { exact: true })).toBeVisible({ timeout: 30_000 });

    const peopleCount = await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId]);
    expect(peopleCount.rows[0].c).toBe(52);
    const started = await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_commit_started'", [batchId]);
    const committed = await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_committed'", [batchId]);
    expect(started.rows[0].c).toBe(1);
    expect(committed.rows[0].c).toBe(1);

    // إعادة تحميل: تُظهر «منفذة» ولا تعرض زر تأكيد → لا إعادة محاولة
    await page.goto(`/imports/${batchId}`);
    await expect(page.getByText("منفذة", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "تأكيد التنفيذ", exact: true })).toHaveCount(0);
    const peopleAfterReload = await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId]);
    expect(peopleAfterReload.rows[0].c).toBe(52);
    const committedAfter = await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_committed'", [batchId]);
    expect(committedAfter.rows[0].c).toBe(1);
  } finally {
    await cleanupBatch(pool, batchId);
    await pool.end();
  }
});

test("انتهاء الجلسة عند التأكيد: رسالة عربية ورابط دخول returnTo، الدفعة تبقى «معاينة»، ثم إعادة دخول وتنفيذ", async ({ page, context }) => {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  let batchId = "";
  try {
    await login(page);
    batchId = await uploadReady52Batch(page);

    // فتح لوحة التأكيد ثم إزالة كوكي الجلسة قبل النقر (محاكاة انتهاء الجلسة)
    await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
    await expect(page.getByText("تأكيد استيراد بيانات الموظفين")).toBeVisible();
    await context.clearCookies();

    await page.getByRole("button", { name: "تأكيد التنفيذ", exact: true }).click();

    // رسالة انتهاء الجلسة (نص حرفي) + رابط دخول يحمل returnTo للدفعة نفسها
    await expect(
      page.getByText("انتهت الجلسة. لم يتم تنفيذ الاستيراد. سجّل الدخول ثم ارجع إلى الدفعة.", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const loginLink = page.getByRole("link", { name: "تسجيل الدخول والعودة إلى الدفعة" });
    await expect(loginLink).toBeVisible();
    expect(await loginLink.getAttribute("href")).toContain(`returnTo=${encodeURIComponent(`/imports/${batchId}`)}`);

    // الدفعة بقيت «معاينة»: 52 صفاً جاهزاً و0 أشخاص
    expect((await pool.query("SELECT status FROM import_batches WHERE id=$1", [batchId])).rows[0].status).toBe("معاينة");
    expect((await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId])).rows[0].c).toBe(0);
    expect((await pool.query("SELECT count(*)::int c FROM import_rows WHERE batch_id=$1 AND status='جاهز'", [batchId])).rows[0].c).toBe(52);

    // إعادة الدخول عبر الرابط ثم العودة إلى الدفعة (returnTo)
    await loginLink.click();
    await page.waitForURL("**/login**");
    await submitLoginForm(page);
    await page.waitForURL(`**/imports/${batchId}`);

    // تنفيذ مرة واحدة → 52 شخصاً بالضبط
    await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
    await page.getByRole("button", { name: "تأكيد التنفيذ", exact: true }).click();
    await expect(page.getByText("تم الاستيراد", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect((await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId])).rows[0].c).toBe(52);
  } finally {
    await cleanupBatch(pool, batchId);
    await pool.end();
  }
});

test("استجابة غير مؤكدة: الخادم ينفّذ لكن العميل يفقد الرد → إعادة التحميل تُظهر «منفذة» بلا تكرار", async ({ page }) => {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  let batchId = "";
  try {
    await login(page);
    batchId = await uploadReady52Batch(page);

    await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
    await expect(page.getByText("تأكيد استيراد بيانات الموظفين")).toBeVisible();

    // اعتراض طلب فعل التنفيذ (POST): نفّذه على الخادم ثم أفقد الرد على العميل
    let dropped = false;
    await page.route(`**/imports/${batchId}`, async (route, request) => {
      if (request.method() === "POST" && !dropped) {
        dropped = true;
        await route.fetch(); // الخادم ينفّذ المعاملة فعلاً (يُنشئ 52 شخصاً)
        await route.abort("failed"); // العميل لا يستلم الرد (استجابة ضائعة/مُجهضة)
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: "تأكيد التنفيذ", exact: true }).click();
    // العميل يرى استجابة غير مؤكدة → رسالة مراجعة الحالة، دون إعادة محاولة تلقائية
    await expect(page.getByText(/تعذّر تأكيد نتيجة التنفيذ/)).toBeVisible({ timeout: 15_000 });
    await page.unroute(`**/imports/${batchId}`);

    // إعادة التحميل: تُظهر «منفذة» ولا تعرض زر تأكيد (لا تعرض/تنفّذ تنفيذاً آخر)
    await page.goto(`/imports/${batchId}`);
    await expect(page.getByText("منفذة", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("تم الاستيراد", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "تأكيد التنفيذ", exact: true })).toHaveCount(0);

    // 52 شخصاً بالضبط وحدث تنفيذ واحد
    expect((await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId])).rows[0].c).toBe(52);
    expect((await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_committed'", [batchId])).rows[0].c).toBe(1);
  } finally {
    await cleanupBatch(pool, batchId);
    await pool.end();
  }
});

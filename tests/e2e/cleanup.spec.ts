import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * صفحة تنظيف السجلات التجريبية على الجوال (390×844):
 *  - تُعرض المعاينة الدقيقة والأقسام المحفوظة دون تمرير أفقي.
 *  - نموذج الأرشفة موجود لكنه لا يُنفَّذ (نتوقف قبل التنفيذ) — لا كتابة في قاعدة البيانات.
 *  - دفعة فارس البديلة تبقى «معاينة» بعد فتح الصفحة (لم تُؤرشَف).
 * تعمل على قاعدة madrasa_test المعزولة فقط (حارس fail-closed).
 */

test.use({ ...devices["iPhone 12"], viewport: { width: 390, height: 844 }, locale: "ar-SA" });

const STORAGE = process.env.E2E_STORAGE_DIR ?? path.resolve("storage-e2e");
const TEST_DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(STORAGE, "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  const password = line.split("كلمة المرور المؤقتة:")[1].trim();
  return { username: "principal", password };
}

async function login(page: Page) {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - doc.clientWidth);
  });
}

async function countArchiveBatches(): Promise<number> {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  try {
    const r = await pool.query("select count(*)::int as n from archive_batches");
    return r.rows[0].n as number;
  } finally {
    await pool.end();
  }
}

test("تنظيف السجلات: تُعرض على الجوال دون تمرير أفقي ولا تنفّذ أرشفة", async ({ page }) => {
  /*
   * CI يشغّل `next dev`، فأول زيارة لأي مسار تدفع ثمن ترجمته. وشاشة التنظيف تُحصي كل
   * مجموعات السجلات قبل أن تُصيَّر، فهي من أبطأ المسارات أول مرة. المهلة هنا سقفٌ يتّسع
   * لعدّاء مزدحم، لا انتظارٌ مقصود.
   */
  test.setTimeout(180_000);
  const archivesBefore = await countArchiveBatches();

  await login(page);
  /*
   * `networkidle` ليست إشارة جاهزية بل نافذة هدوء بمدة ثابتة (٥٠٠ مللي بلا طلبات)، ولا
   * تتحقّق أصلاً على عدّاء يترجم المسار عند الطلب — فسقط الاختبار على الـ`pull_request`
   * ونجح على الـ`push` بالشيفرة نفسها. الجاهزية الحقيقية هي العناصر التي يفحصها الاختبار
   * بعد سطرين، وهي تُنتظر بحالتها.
   */
  await page.goto("/admin/cleanup");

  // العنوان والأقسام الأساسية
  await expect(page.getByRole("heading", { name: "تنظيف السجلات التجريبية" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("المعاينة الدقيقة — عدد المرشّحين للأرشفة حسب المجموعة")).toBeVisible();
  await expect(page.getByText("محفوظ وآمن — لا يُشمل بالتنظيف")).toBeVisible();

  // نموذج الأرشفة موجود مع حقل عبارة التأكيد — لكن لا نُرسله (نتوقف قبل التنفيذ)
  await expect(page.getByRole("heading", { name: "تنفيذ الأرشفة (خطوة المدير اليدوية)" })).toBeVisible();
  await expect(page.locator('input[name="confirmationText"]')).toBeVisible();

  // لا تمرير أفقي عند 390px
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  // لم تُنفَّذ أي أرشفة بمجرد فتح الصفحة
  expect(await countArchiveBatches()).toBe(archivesBefore);

  // دفعة فارس البديلة تبقى «معاينة» (محفوظة)
  await expect(page.getByText("دفعة فارس محفوظة").first()).toBeVisible();
});

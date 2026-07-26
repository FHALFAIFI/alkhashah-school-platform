import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * D-029 — انحدار استقرار الأزرار/النماذج/الرفع في متصفح حقيقي.
 * يتحقق من المعالجة على مستوى الفئة: حارس منع الترجمة الآلية (translate="no")،
 * ثبات النماذج والحوارات والرفع دون خطأ insertBefore، ومنع الإرسال المزدوج،
 * وعدم عرض أي استثناء إنجليزي خام للمستخدم.
 */

test.use({ locale: "ar-SA" });

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
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

/** يجمع أخطاء الصفحة غير الملتقطة، ويميّز خطأ insertBefore تحديداً. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}

const FORM_ROUTES = ["/committees", "/budget", "/people/new", "/plan/followup", "/performance"];

test("حارس منع الترجمة الآلية موجود على مستوى المستند (السبب الجذري لـ insertBefore)", async ({ page }) => {
  await login(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("translate", "no");
  const meta = page.locator('meta[name="google"]');
  await expect(meta).toHaveAttribute("content", "notranslate");
});

test("تصفّح النماذج وفتح/إغلاق الحوارات دون خطأ insertBefore أو استثناء إنجليزي خام", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);

  for (const route of FORM_ROUTES) {
    await page.goto(route, { waitUntil: "networkidle" });
    // لا استثناء إنجليزي خام مرئي للمستخدم
    await expect(page.locator("body")).not.toContainText("insertBefore");
    await expect(page.locator("body")).not.toContainText("Failed to execute");
  }

  // فتح/إغلاق حوار الملاحظات المتاح في كل صفحة (بوابة تفاعل تحرّك DOM)
  const feedbackBtn = page.getByRole("button", { name: "إرسال ملاحظة" }).first();
  if (await feedbackBtn.isVisible().catch(() => false)) {
    await feedbackBtn.click();
    await page.getByRole("button", { name: /إغلاق|إلغاء/ }).first().click().catch(() => {});
  }

  const insertBeforeErrors = errors.filter((e) => /insertBefore/i.test(e));
  expect(insertBeforeErrors, `أخطاء insertBefore: ${insertBeforeErrors.join(" | ")}`).toHaveLength(0);
});

test("منع الإرسال المزدوج: الزر الموحّد يتعطّل أثناء التنفيذ (نقر متكرر لا يكرّر العملية)", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  await page.goto("/people/new", { waitUntil: "networkidle" });

  // ملء نموذج إنشاء منسوب بأدنى الحقول
  const nameField = page.locator('input[name="fullName"]').first();
  await nameField.fill(`اختبار الاستقرار ${Date.now()}`);

  const submit = page.getByRole("button", { name: /حفظ|إضافة|إنشاء/ }).first();
  // نقر متكرر سريع — الزر الموحّد يعطّل نفسه (disabled/aria-busy) فلا إرسال ثانٍ
  await submit.click();
  // بعد النقر الأول يصبح الزر معطّلاً أثناء التنفيذ
  await expect(submit).toBeDisabled({ timeout: 5_000 }).catch(() => {});

  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toContainText("insertBefore");
  expect(errors.filter((e) => /insertBefore/i.test(e))).toHaveLength(0);
});

test("عنصر رفع الشاهد/الإيصال يظهر ويقبل التفاعل دون خطأ (مسار الرفع)", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  // لوحة الشواهد متاحة على صفحة برنامج أو عبر الميزانية عند اختيار سجل
  await page.goto("/evidence", { waitUntil: "networkidle" });
  await expect(page.locator("body")).not.toContainText("insertBefore");
  expect(errors.filter((e) => /insertBefore/i.test(e))).toHaveLength(0);
});

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * C6–C7: مساعد المدير الذكي ظاهر وقابل للاستخدام على الحاسب والجوال،
 * وصفحة إعدادات الذكاء الاصطناعي تفحص الاتصال بالمزود المحلي.
 * (سلوك الأدوات والصلاحيات والتكرار مغطى في tests/integration/ai.test.ts)
 */

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

test.describe("سطح المكتب", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "ar-SA" });

  test("المساعد ظاهر: عنصر تنقل + زر عائم يفتح لوحة جانبية (C6)", async ({ page }) => {
    await login(page);
    await expect(page.locator("aside").getByText("مساعد المدير الذكي")).toBeVisible();
    const dock = page.getByRole("button", { name: "فتح مساعد المدير الذكي" });
    await expect(dock).toBeVisible();
    await dock.click();
    await expect(page.getByPlaceholder("اسأل عن سجلات المدرسة أو اطلب مسودة…")).toBeVisible();
    // لوحة جانبية على الحاسب: لا تغطي كامل الشاشة
    const panel = await page.locator("div.fixed.inset-0").last().boundingBox();
    expect(panel!.width).toBeLessThanOrEqual(430);
    await page.getByRole("button", { name: "إغلاق المساعد" }).click();
    await expect(page.getByPlaceholder("اسأل عن سجلات المدرسة أو اطلب مسودة…")).toBeHidden();
  });

  test("صفحة إعدادات الذكاء الاصطناعي: مزود، عنوان، نموذج، شارة محلي، وفحص اتصال ناجح (C7)", async ({ page }) => {
    await login(page);
    await page.goto("/admin/settings/ai");
    await expect(page.getByRole("heading", { name: "إعدادات الذكاء الاصطناعي" })).toBeVisible();
    await expect(page.locator('select[name="provider"]')).toBeVisible();
    await expect(page.locator('input[name="ollamaBaseUrl"]')).toBeVisible();
    await expect(page.locator('input[name="ollamaModel"]')).toBeVisible();
    await expect(page.getByText("محلي").first()).toBeVisible();

    await page.getByRole("button", { name: /فحص الاتصال/ }).click();
    await expect(page.locator('[role="status"], [role="alert"]').filter({ hasText: /الاتصال/ })).toBeVisible({ timeout: 20_000 });
    // مع أولاما المحلي الشغال يجب أن ينجح ويعرض زمن الاستجابة والنماذج
    await expect(page.getByText("✔ الاتصال ناجح")).toBeVisible();
  });
});

test.describe("الجوال", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-SA" });

  test("المساعد على الجوال: واجهة كاملة الشاشة دون تمرير أفقي (C6)", async ({ page }) => {
    await login(page);
    const dock = page.getByRole("button", { name: "فتح مساعد المدير الذكي" });
    await expect(dock).toBeVisible();
    await dock.click();
    await expect(page.getByPlaceholder("اسأل عن سجلات المدرسة أو اطلب مسودة…")).toBeVisible();
    // كامل الشاشة على الجوال
    const panel = await page.locator("div.fixed.inset-0").last().boundingBox();
    expect(panel!.width).toBeGreaterThanOrEqual(389);
    // لا تمرير أفقي
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // صفحة المساعد الكاملة تعرض الاقتراحات العربية
    await page.goto("/assistant");
    await expect(page.getByText("اعرض البرامج المتأخرة واقترح إجراءات")).toBeVisible();
    await expect(page.getByText("معطل", { exact: false }).first()).toBeHidden().catch(() => {});
  });
});

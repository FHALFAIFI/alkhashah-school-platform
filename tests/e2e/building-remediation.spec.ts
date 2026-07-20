import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 9 — قبول ميزات وحدة المبنى المُعاد بناؤها (Phases 2–6) عبر الواجهة الحقيقية (madrasa_test):
 * قوالب الفحص (إنشاء/تفعيل/تكرار)، المحرر اليدوي (إنشاء غرفة/وضع/حفظ مسودة)، مسح QR (يدوي)،
 * مسح المستندات (بديل الرفع)، ومرشّح الأصول (نشط/مؤرشف). دورة الأصل الكاملة والتجميد التاريخي
 * مغطّاة باختبارات التكامل (asset-lifecycle, inspection-templates, document-scan, qr-scan).
 */

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}
async function login(page: Page) {
  const c = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", c.username);
  await page.fill("#password", c.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}
async function hOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, 0));
}

test("قوالب الفحص: إنشاء ← معاينة ← تفعيل ← تكرار (Phase 3)", async ({ page }) => {
  test.setTimeout(120_000);
  page.on("dialog", (d) => void d.accept());
  await login(page);
  // القوالب المرجعية (قوالب النظام) ظاهرة
  await page.goto("/building/inspections/templates");
  await expect(page.getByText("قالب نظام").first()).toBeVisible({ timeout: 20_000 });
  // إنشاء قالب
  await page.getByRole("link", { name: "إنشاء قالب" }).click();
  await page.waitForURL("**/building/inspections/templates/new");
  await page.locator('input[name="nameAr"]').fill("قالب فحص قبول آلي");
  await page.locator('input[placeholder="وصف عنصر الفحص"]').first().fill("النوافذ سليمة");
  await page.getByRole("button", { name: "حفظ المسودة" }).click();
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText("معاينة القالب")).toBeVisible();
  // تفعيل
  await page.getByRole("button", { name: "تفعيل" }).first().click();
  await expect(page.getByText("مُفعّل").first()).toBeVisible({ timeout: 20_000 });
  // تكرار → عائلة جديدة (نسخة)
  await page.getByRole("button", { name: "تكرار القالب" }).first().click();
  await expect(page.getByText("(نسخة)").first()).toBeVisible({ timeout: 20_000 });
});

test("المحرر اليدوي: إنشاء غرفة ← صينية ← وضع ← حفظ مسودة (Phase 6)", async ({ page }) => {
  test.setTimeout(120_000);
  page.on("dialog", (d) => void d.accept());
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.goto("/building/editor/first"); // دور بلا هندسة مبذورة — يبدأ فارغاً
  await expect(page.locator('input[placeholder="اسم الغرفة"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('input[placeholder="اسم الغرفة"]').fill("غرفة قبول آلي");
  await page.getByRole("button", { name: "إضافة غرفة" }).click();
  await expect(page.getByText("الغرف غير الموضوعة (1)")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "ضع في المخطط" }).first().click();
  await expect(page.locator("svg rect[rx='2']").first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "حفظ المسودة" }).click();
  await expect(page.getByText(/حفظت مسودة النسخة|حُفظت/).first()).toBeVisible({ timeout: 20_000 });
});

test("مسح QR: إدخال يدوي لرمز مجهول يظهر خطأ عربي واضح (Phase 5)", async ({ page }) => {
  await login(page);
  await page.goto("/building/scan");
  await expect(page.getByRole("button", { name: "مسح رمز غرفة" })).toBeVisible();
  await page.locator('input[placeholder="KHS-RM-0001 أو KHS-AST-0001"]').fill("KHS-RM-0000");
  await page.getByRole("button", { name: "بحث" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
  expect(await hOverflow(page)).toBe(0);
});

test("مسح المستندات: الصفحة تعرض بديل الرفع دائماً (Phase 4)", async ({ page }) => {
  await login(page);
  await page.goto("/building/documents");
  await expect(page.getByRole("button", { name: "مسح مستند (الكاميرا)" })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('summary:has-text("رفع ملف بدلاً من استخدام الكاميرا")')).toBeVisible();
  expect(await hOverflow(page)).toBe(0);
});

test("الأصول: مرشّح النشط/المؤرشف يعرض ولا تمرير أفقي على 390 (Phase 2)", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/building/assets");
  await expect(page.getByRole("link", { name: "الأصول النشطة" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "الأصول المؤرشفة" })).toBeVisible();
  await page.getByRole("link", { name: "الأصول المؤرشفة" }).click();
  await page.waitForURL((u) => decodeURIComponent(u.toString()).includes("عرض="));
  await expect(page.getByText("لا أصول مؤرشفة")).toBeVisible({ timeout: 15_000 });
  expect(await hOverflow(page)).toBe(0);
});

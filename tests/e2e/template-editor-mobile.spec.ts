import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * v2.2 §E2 — the column/section editor on a phone, in Arabic RTL.
 *
 * Separate file because a mobile device profile forces its own Playwright worker and
 * cannot be scoped to a describe block.
 */

test.use({ ...devices["iPhone 12"], viewport: { width: 390, height: 844 }, locale: "ar-SA" });

function principalCredentials(): { username: string; password: string } {
  const dir = process.env.E2E_STORAGE_DIR ?? "storage-e2e";
  const file = path.resolve(process.cwd(), dir, "private", "initial-credentials.txt");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}

async function login(page: Page) {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

/** ينشئ قالب تقرير برنامج ويفتح محرّره */
async function openProgramTemplate(page: Page): Promise<string> {
  await page.goto("/admin/templates");
  await expect(page.getByRole("heading", { name: "إدارة القوالب" })).toBeVisible();

  const name = `قالب جوال ${Date.now()}`;
  await page.getByRole("button", { name: "إنشاء قالب" }).click();
  // النموذج يُفتح بعد الترطيب — الانتظار الصريح يمنع نقراً يسبق تفاعل الصفحة
  await expect(page.locator("#tpl-type")).toBeVisible();
  await page.selectOption("#tpl-type", "program_report");
  await page.locator('input[name="nameAr"]').fill(name);
  await page.getByRole("button", { name: "إنشاء كمسودة" }).click();
  await expect(page.getByRole("status").filter({ hasText: "أُنشئ القالب" })).toBeVisible({ timeout: 20_000 });

  const link = page.getByRole("link", { name }).first();
  await expect(async () => {
    await page.reload();
    await expect(link).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 25_000 });
  await link.click();
  await expect(page.getByTestId("sections-editor")).toBeVisible({ timeout: 20_000 });
  return new URL(page.url()).searchParams.get("template")!;
}


test("محرّر الأقسام والأعمدة قابل للاستخدام على 390 بكسل بلا تمرير أفقي", async ({ page }) => {
  await login(page);
  await openProgramTemplate(page);

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const sections = page.getByTestId("sections-editor");
  const columns = page.getByTestId("columns-editor");
  await expect(sections).toBeVisible();
  await expect(columns).toBeVisible();

  // أزرار الترتيب تعمل باللمس على الجوال
  await columns.getByTestId("column-row-domain").getByRole("button", { name: /لأعلى/ }).click();
  await expect(columns.getByTestId("column-row-domain").locator("span").first()).toHaveText("1");

  // إخفاء عمود يعمل على الجوال أيضاً
  await columns.getByTestId("column-row-owner").getByRole("checkbox").uncheck();
  const frame = page.frameLocator('iframe[title="معاينة القالب"]');
  await expect(frame.locator("th", { hasText: "مسؤول التنفيذ" })).toHaveCount(0);

  // لا تمرير أفقي على مستوى الصفحة
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

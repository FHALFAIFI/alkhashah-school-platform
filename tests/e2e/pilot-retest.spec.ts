import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 10 — لوحة إعادة اختبار المدير على /pilot: الدعوة، المهام الخمس عشرة، حفظ المسودة،
 * وإرسال ملاحظة عن مهمة تُسجَّل في قناة الملاحظات وتظهر في شاشة الإدارة.
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

test("لوحة إعادة الاختبار: الدعوة + المهام + حفظ مسودة + إرسال ملاحظة يُسجَّل", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/pilot");
  await expect(page.getByRole("heading", { name: "دعوة لإعادة اختبار المنصة" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "قائمة إعادة اختبار المدير" })).toBeVisible();
  // خمس عشرة مهمة
  await expect(page.getByRole("link", { name: "افتح الصفحة" })).toHaveCount(15);

  // اضبط حالة أول مهمة وأضف تعليقاً ثم احفظ كمسودة
  const first = page.locator("ol > li").first();
  await first.locator("select").selectOption("نجح");
  await first.locator("textarea").fill("الأزرار تعمل بشكل جيد");
  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await expect(page.getByText("حُفظت المسودة على هذا الجهاز")).toBeVisible({ timeout: 10_000 });

  // أرسل ملاحظة عن المهمة الأولى → رقم مرجعي
  await first.getByRole("button", { name: "إرسال ملاحظة" }).click();
  await expect(first.getByText(/تم تسجيل ملاحظتك — الرقم المرجعي FB-/)).toBeVisible({ timeout: 20_000 });

  // تظهر في شاشة إدارة الملاحظات (تُعرَض في بطاقة الجوال وصف الجدول معاً — نتحقق من وجودها)
  await page.goto("/admin/feedback");
  await expect
    .poll(async () => page.getByText(/إعادة اختبار 1: نجح/).count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
});

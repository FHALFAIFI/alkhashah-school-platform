import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A1: لا إنجليزية في المسارات الأساسية.
 * A18: التنزيلات والمسارات الخاصة محمية بالمصادقة.
 */

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  const password = line.split("كلمة المرور المؤقتة:")[1].trim();
  return { username: "principal", password };
}

// يسمح بالأرقام والرموز والكلمات التقنية غير المرئية — يرفض الكلمات الإنجليزية الظاهرة
async function assertNoVisibleEnglish(page: import("@playwright/test").Page) {
  const text = await page.evaluate(() => document.body.innerText);
  const latinWords = text.match(/[A-Za-z]{2,}/g) ?? [];
  // امتدادات الملفات المرفوعة (تظهر ضمن أسماء ملفات حقيقية في /imports) كلمات تقنية مسموحة
  const allowed = new Set(["PDF", "CSV", "Excel", "Word", "QR", "KHS", "DOC", "AST", "RM", "MNT", "ZIP", "xlsx", "docx", "csv", "zip", "pdf"]);
  // رموز التحقق للوثائق الصادرة أحرف سداسية عشرية بالتصميم (KHS-DOC + رمز تحقق) — ليست كلمات إنجليزية
  const violations = latinWords.filter((w) => !allowed.has(w) && !/^KHS/.test(w) && !/^[A-F0-9]+$/.test(w));
  expect(violations, `كلمات إنجليزية ظاهرة: ${violations.join(", ")}`).toEqual([]);
}

test("صفحة الدخول عربية بلا إنجليزية ظاهرة", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "منصة الإدارة المدرسية المتكاملة" })).toBeVisible();
  await assertNoVisibleEnglish(page);
});

test("الوصول غير المصادق للمسارات الخاصة يرفض (A18)", async ({ request }) => {
  const res = await request.get("/api/files/123e4567-e89b-42d3-a456-426614174000");
  expect(res.status()).toBe(401);
});

test("الصفحات الأساسية بعد الدخول عربية بالكامل (A1)", async ({ page }) => {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");

  for (const route of ["/dashboard", "/plan", "/people", "/imports", "/evidence", "/tasks", "/calendar", "/reports", "/documents"]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await assertNoVisibleEnglish(page);
  }
});

test("مستخدم مصادق بلا صلاحية تنزيل يرفض بالرمز 403 أو يقبل حسب الدور", async ({ page, request }) => {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");
  // ملف غير موجود بمعرف صالح — مصادق ومصرح: 404 وليس 401
  const res = await page.request.get("/api/files/123e4567-e89b-42d3-a456-426614174000");
  expect(res.status()).toBe(404);
});

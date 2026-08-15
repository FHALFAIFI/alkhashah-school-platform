import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * دخان سير عمل نطاق v2 على الواجهة الحقيقية: عمل الأزرار فعلياً (نقر → أثر) على الصفحات
 * الجديدة. قائمة المرافق مستقلة عن بيانات مبذورة فتصلح لإثبات نقر الأزرار طرفاً لطرف.
 */

function principalCredentials() {
  const dir = process.env.E2E_STORAGE_DIR ?? "storage-e2e";
  const file = path.resolve(process.cwd(), dir, "private", "initial-credentials.txt");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes("principal"))!;
  const password = line.split("كلمة المرور المؤقتة:")[1].trim();
  return { username: "principal", password };
}

async function login(page: Page) {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

test.describe("نطاق v2 — دخان الواجهة", () => {
  test("قائمة المرافق: إضافة مرفق ثم تعليم حالته عبر أزرار حقيقية", async ({ page }) => {
    await login(page);
    await page.goto("/building/facilities");
    await expect(page.getByRole("heading", { name: "المرافق المطلوب توفيرها أو تحسينها" })).toBeVisible();

    // إضافة مرفق مخصص عبر نموذج الفعل (form action)
    const name = `مرفق آلي ${Date.now()}`;
    await page.locator('input[name="facilityType"]').fill(name);
    await page.getByRole("button", { name: "إضافة مرفق", exact: true }).click();
    // الأثر الدائم: المرفق يظهر في القائمة بعد إعادة التحميل
    const row = page.locator("div.border-sand-200", { hasText: name }).first();
    await expect(async () => {
      await page.reload();
      await expect(row).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    // نقر «موجود» يغيّر الحالة فعلياً (أثر دائم)
    await row.getByRole("button", { name: "موجود", exact: true }).click();
    await expect(row.getByText("حُدّثت الحالة")).toBeVisible({ timeout: 15_000 });
  });

  // v2.2 §B: صارت الصفحة «المالية المدرسية» بعد فصل المالية عن البرامج، والملخص يعرض
  // «إجمالي الإيرادات» لا «إجمالي الإيرادات المستلمة».
  test("صفحة المالية تُعرض (ملخص أو حالة فارغة) بلا خطأ", async ({ page }) => {
    await login(page);
    await page.goto("/budget");
    await expect(page.getByRole("heading", { name: "المالية المدرسية" })).toBeVisible();
    // إمّا الملخص (عند وجود سنة نشطة) أو الحالة الفارغة الواضحة
    const hasSummary = await page.getByText("إجمالي الإيرادات").first().isVisible().catch(() => false);
    const hasEmpty = await page.getByText("لا سنة تخطيطية نشطة").isVisible().catch(() => false);
    expect(hasSummary || hasEmpty).toBe(true);
  });

  // v2.2 §D: حلّ مركز التقارير المركزي (فئات + محرّك واحد) محلّ الهيكل الثلاثي القديم.
  test("مركز التقارير يعرض فئاته ويشغّل تقريراً", async ({ page }) => {
    await login(page);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "مركز التقارير" })).toBeVisible();
    // v2.5.0 §14: أُعيد تنظيم الصفحة بأقسام مجالية — اسم الفئة عنوان بطاقة، ورابطها «عرض التقارير»
    await expect(page.getByRole("heading", { name: "الخطة والبرامج" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "المالية والميزانية" })).toBeVisible();
    await expect(page.getByRole("link", { name: "عرض التقارير" }).first()).toBeVisible();
    // فتح فئة ثم تشغيل تقرير منها
    await page.goto("/reports?category=plan");
    await expect(page.getByRole("heading", { name: "البرامج النشطة" })).toBeVisible();
    await page.goto("/reports?category=plan&report=programs-active");
    await expect(page.getByRole("heading", { name: "البرامج النشطة", level: 2 })).toBeVisible();
  });
});

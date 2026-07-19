import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * قناة ملاحظات التشغيل + مركز التشغيل التجريبي عبر الواجهة الحقيقية (madrasa_test).
 * يغطي: الإنشاء من سطح المكتب و390×844، رسالة النجاح والرقم المرجعي، عدم التمرير الأفقي،
 * عدم تداخل زر الملاحظة مع زر المساعد، ظهور الملاحظة في شاشة الإدارة، وتصدير Excel،
 * وحالة مركز التشغيل «بانتظار تأكيد استيراد بيانات فارس».
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

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - doc.clientWidth);
  });
}

async function submitFeedback(page: Page): Promise<string> {
  await page.getByTestId("feedback-open").click();
  await page.getByRole("dialog", { name: /إرسال ملاحظة/ }).waitFor();
  await page.selectOption('select[name="category"]', "مشكلة");
  await page.selectOption('select[name="severity"]', "تؤثر جزئياً على العمل");
  await page.fill('input[name="title"]', "ملاحظة اختبار آلي");
  await page.fill('textarea[name="attempted"]', "فتح الصفحة");
  await page.fill('textarea[name="happened"]', "ظهر خطأ");
  await page.getByRole("button", { name: "إرسال الملاحظة" }).click();
  const success = page.getByTestId("feedback-success");
  await success.waitFor();
  await expect(success).toContainText("تم تسجيل ملاحظتك");
  const text = await success.innerText();
  const m = text.match(/FB-\d{3,}/);
  expect(m, "يجب أن يظهر رقم مرجعي FB-####").not.toBeNull();
  return m![0];
}

test.describe("سطح المكتب", () => {
  test("إنشاء ملاحظة، ظهورها في الإدارة، وتصدير Excel", async ({ page }) => {
    await login(page);
    const ref = await submitFeedback(page);

    // تظهر في مركز الملاحظات (جدول سطح المكتب مرئي عند هذا العرض)
    await page.goto("/admin/feedback");
    await expect(page.locator("table").getByText(ref, { exact: false }).first()).toBeVisible();

    // تصدير Excel ينزّل ملفاً
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "تنزيل Excel" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("مركز التشغيل التجريبي يعرض حالة انتظار فارس", async ({ page }) => {
    await login(page);
    await page.goto("/pilot");
    await expect(page.getByText("مركز التشغيل التجريبي").first()).toBeVisible();
    await expect(page.getByText("بانتظار تأكيد استيراد بيانات فارس").first()).toBeVisible();
    // قائمة الأسبوع الأول والتحذير والحدود المعروفة حاضرة
    await expect(page.getByText("قائمة الأسبوع الأول")).toBeVisible();
    await expect(page.getByText(/قد يصبح التراجع الكامل عن استيراد فارس غير متاح/)).toBeVisible();
  });
});

test.describe("الجوال 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: "ar-SA" });

  test("إنشاء ملاحظة على الجوال بلا تمرير أفقي", async ({ page }) => {
    await login(page);
    // زر الملاحظة وزر المساعد لا يتداخلان
    const fb = await page.getByTestId("feedback-open").boundingBox();
    const ai = await page.getByRole("button", { name: "فتح مساعد المدير الذكي" }).boundingBox();
    expect(fb, "زر الملاحظة ظاهر").not.toBeNull();
    expect(ai, "زر المساعد ظاهر (AI مفعّل في الاختبار)").not.toBeNull();
    const overlap =
      fb!.x < ai!.x + ai!.width &&
      fb!.x + fb!.width > ai!.x &&
      fb!.y < ai!.y + ai!.height &&
      fb!.y + fb!.height > ai!.y;
    expect(overlap, "زر الملاحظة وزر المساعد يجب ألا يتداخلا").toBe(false);

    await submitFeedback(page);

    // النموذج/شاشة النجاح بلا تمرير أفقي على مستوى الصفحة
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("مركز التشغيل ومركز الملاحظات بلا تمرير أفقي عند 390px", async ({ page }) => {
    await login(page);
    for (const route of ["/pilot", "/admin/feedback"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      expect(await pageOverflow(page), `تمرير أفقي في ${route}`).toBeLessThanOrEqual(0);
    }
  });
});

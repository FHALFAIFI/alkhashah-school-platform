import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * بنود القبول الراسبة من جلسة الجوال 2026-07-17 — التحقق الآلي بعد الإصلاح:
 * 1) صفوف المعاينة بطاقات رأسية عربية عند 390×844 بلا تمرير أفقي (الجدول يبقى لسطح المكتب).
 * 2) القرارات قابلة للتراجع الكامل: تأكيد/تصحيح/استبعاد/تأجيل/إعادة إلى المراجعة + «تراجع عن آخر قرار».
 * 3) بعد حسم تحذير التصنيف يظهر «تمت مراجعة التصنيف» ويعود التحذير نشطاً عند إعادة المراجعة.
 * يعمل على دفعة اصطناعية موسومة «تجريبي آلي» — لا يلمس دفعة فارس الحقيقية ولا ينفذ أي دفعة.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve("storage/private/initial-credentials.txt");
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

/** مصنف اصطناعي بصفين: معلم مؤكد + «عامل/المستخدمين» غير مؤكد التصنيف (كدفعة فارس الحقيقية) */
async function unconfidentWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("بيانات الموظفين");
  ws.addRow(["الاسم", "الوظيفة الحالية", "السلك", "حالة الموظف", "المرحلة", "رقم الوظيفة"]);
  ws.addRow(["تجريبي آلي معلم قرارات", "معلم", "تعليمي", "على رأس العمل", "المرحلة الابتدائية", "900001"]);
  ws.addRow(["تجريبي آلي عامل قرارات", "عامل", "المستخدمين", "على رأس العمل", "الإدارة", "900002"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const RESOLVED = "تمت مراجعة التصنيف";
const WARNING = "التصنيف (معلم/موظف) غير مؤكد";

test.describe("قرارات الاستيراد القابلة للتراجع — 390×844", () => {
  test.describe.configure({ mode: "serial" });
  const { defaultBrowserType: _ignored, ...iphone12 } = devices["iPhone 12"];
  test.use({ ...iphone12, viewport: { width: 390, height: 844 }, locale: "ar-SA" });

  let batchUrl = "";

  test("رفع دفعة اصطناعية: البطاقات الرأسية تظهر والجدول مخفي ولا تمرير أفقي (البند 1)", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/imports/new?type=people");
    await page.setInputFiles("#file", { name: "موظفون تجريبي آلي قرارات.xlsx", mimeType: XLSX_MIME, buffer: await unconfidentWorkbook() });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    batchUrl = page.url();

    const cards = page.getByTestId("import-row-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toBeVisible();
    // الجدول موجود للحاسوب لكنه مخفي على الجوال
    await expect(page.locator("table").last()).toBeHidden();
    expect(await pageOverflow(page), "تمرير أفقي في صفحة الدفعة").toBeLessThanOrEqual(0);

    // بطاقة الصف غير المؤكد تعرض التحذير نشطاً
    const card = cards.filter({ hasText: "تجريبي آلي عامل قرارات" });
    await expect(card.getByText(WARNING).first()).toBeVisible();
    await expect(card.getByText("يحتاج مراجعة")).toBeVisible();
  });

  test("الدورة الكاملة: مراجعة←تأكيد←تراجع←تصحيح←تأجيل←إعادة←تأكيد ثم تراجع كامل يستعيد كل القيم (البندان 2 و3)", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto(batchUrl);
    const card = page.getByTestId("import-row-card").filter({ hasText: "تجريبي آلي عامل قرارات" });
    const status = async (s: string) => expect(card.locator("span.rounded-full", { hasText: s })).toBeVisible({ timeout: 20_000 });
    // كما يفعل المستخدم: تمرير الزر لوسط الشاشة قبل النقر كي لا يغطيه زر المساعد العائم أسفلها
    const tap = async (name: string) => {
      const btn = card.getByRole("button", { name });
      await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await btn.click();
    };

    // تأكيد كجاهز: التحذير يختفي وتظهر ملاحظة الحسم
    await tap("تأكيد كجاهز");
    await status("جاهز");
    await expect(card.getByText(RESOLVED)).toBeVisible();
    await expect(card.getByText(WARNING).first()).toBeHidden();

    // تراجع: يعود «يحتاج مراجعة» ويعود التحذير نشطاً
    await tap("تراجع عن آخر قرار");
    await status("يحتاج مراجعة");
    await expect(card.getByText(WARNING).first()).toBeVisible();
    await expect(card.getByText(RESOLVED)).toBeHidden();

    // تصحيح: تغيير الوظيفة والحفظ كجاهز
    await tap("تصحيح");
    await card.locator('input[name="f_jobTitle"]').fill("عامل خدمات معدل");
    await tap("حفظ كجاهز");
    await status("جاهز");
    await expect(card.getByText("عامل خدمات معدل")).toBeVisible({ timeout: 20_000 });

    // تأجيل: حالة «مؤجل» وبوابة التنفيذ تمنع
    await tap("تأجيل");
    await status("مؤجل");
    await expect(page.getByText("لا يمكن التنفيذ قبل حسم 1 صفاً مؤجلاً (تأكيد/تصحيح/استبعاد)")).toBeVisible();
    await expect(card.getByText(WARNING).first()).toBeVisible(); // مؤجل = غير محسوم فالتحذير نشط

    // إعادة إلى المراجعة ثم تأكيد نهائي
    await tap("إعادة إلى المراجعة");
    await status("يحتاج مراجعة");
    await tap("تأكيد كجاهز");
    await status("جاهز");
    await expect(card.getByText(RESOLVED)).toBeVisible();

    // سجل القرارات يحفظ المسار كاملاً: تأكيد أُلغي بالتراجع ثم تصحيح وتأجيل وإعادة وتأكيد = 4 قيود
    await expect(card.getByText("سجل القرارات (4)")).toBeVisible();

    // التراجع أربع مرات يعيد الصف تماماً لأصله: «يحتاج مراجعة» + «عامل» + سجل فارغ
    for (let i = 3; i >= 0; i--) {
      await tap("تراجع عن آخر قرار");
      if (i > 0) {
        await expect(card.getByText(`سجل القرارات (${i})`)).toBeVisible({ timeout: 20_000 });
      } else {
        await expect(card.getByRole("button", { name: "تراجع عن آخر قرار" })).toBeHidden({ timeout: 20_000 });
      }
    }
    await status("يحتاج مراجعة");
    await expect(card.getByText("عامل", { exact: true })).toBeVisible();
    await expect(card.getByText("عامل خدمات معدل")).toBeHidden();
    await expect(card.getByRole("button", { name: "تراجع عن آخر قرار" })).toBeHidden();
    await expect(card.getByText(WARNING).first()).toBeVisible();
    expect(await pageOverflow(page), "تمرير أفقي بعد الدورة").toBeLessThanOrEqual(0);
  });
});

test.describe("سطح المكتب: جدول الدفعة كما هو", () => {
  test.use({ viewport: { width: 1280, height: 800 }, locale: "ar-SA" });

  test("عند 1280px يظهر الجدول وتختفي البطاقات", async ({ page }) => {
    await login(page);
    await page.goto("/imports");
    const openBtn = page
      .locator("tbody tr")
      .filter({ hasText: "موظفون تجريبي آلي قرارات.xlsx" })
      .first()
      .getByRole("link", { name: "فتح" });
    await openBtn.click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
    await expect(page.locator("table").last()).toBeVisible();
    await expect(page.getByTestId("import-row-card").first()).toBeHidden();
  });
});

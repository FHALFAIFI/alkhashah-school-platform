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
// اسم ملف فريد لكل تشغيل — يتفادى منع التكرار الذي يمنع رفع نفس الملف مرتين
const DECISIONS_FILE = `موظفون تجريبي آلي قرارات ${Date.now().toString().slice(-8)}.xlsx`;

test.describe("قرارات الاستيراد القابلة للتراجع — 390×844", () => {
  test.describe.configure({ mode: "serial" });
  const { defaultBrowserType: _ignored, ...iphone12 } = devices["iPhone 12"];
  test.use({ ...iphone12, viewport: { width: 390, height: 844 }, locale: "ar-SA" });

  let batchUrl = "";

  test("رفع دفعة اصطناعية: البطاقات الرأسية تظهر والجدول مخفي ولا تمرير أفقي (البند 1)", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/imports/new?type=people");
    await page.setInputFiles("#file", { name: DECISIONS_FILE, mimeType: XLSX_MIME, buffer: await unconfidentWorkbook() });
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

  test("سجل التدقيق يعرض قبل/بعد لكل قرار وتراجع — والتراجع أحداث ملحقة لا حذف (عبر الواجهة)", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/admin/audit");

    // حدث «تصحيح» الأحدث للصف 2 من الدفعة الاصطناعية يحمل قيم قبل/بعد
    const correctRow = page
      .locator("tr", { hasText: "قرار «تصحيح» على الصف 2" })
      .filter({ hasNotText: "تراجع" })
      .first();
    await correctRow.locator("summary", { hasText: "قبل / بعد" }).click();
    await expect(correctRow.getByText("الوظيفة: «عامل» ← «عامل خدمات معدل»")).toBeVisible();
    await expect(correctRow.getByText("الحالة: «يحتاج مراجعة» ← «جاهز»")).toBeVisible();

    // التراجع عن التصحيح حدث مستقل يوثق استعادة القيم — لا حذف للحدث الأصلي
    const undoRow = page.locator("tr", { hasText: "تراجع عن قرار «تصحيح» على الصف 2" }).first();
    await undoRow.locator("summary", { hasText: "قبل / بعد" }).click();
    await expect(undoRow.getByText("الوظيفة: «عامل خدمات معدل» ← «عامل»")).toBeVisible();
  });
});

test.describe("سطح المكتب: جدول الدفعة كما هو", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 800 }, locale: "ar-SA" });

  test("عند 1280px يظهر الجدول وتختفي البطاقات", async ({ page }) => {
    await login(page);
    await page.goto("/imports");
    const openBtn = page
      .locator("tbody tr")
      .filter({ hasText: DECISIONS_FILE })
      .first()
      .getByRole("link", { name: "فتح" });
    await openBtn.click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
    await expect(page.locator("table").last()).toBeVisible();
    await expect(page.getByTestId("import-row-card").first()).toBeHidden();
  });

  /**
   * D-069 (شرط قبول): «مستبعد» يظهر فور الإجراء بلا أي إعادة تحميل — من نتيجة الإجراء
   * نفسها لا من HTML يُجلب على حدة — وعدادات الترويسة تتصالح بالتحديث الواحد الذي يليه،
   * والحالة تبقى صحيحة بعد التنقّل والعودة. كان التحديث بعد الإجراء يضيع على بناء
   * الإنتاج (`loading.tsx` + عيب Next 16.2 — vercel/next.js#86151) فلا يظهر الاستبعاد
   * إطلاقاً دون إعادة تحميل يدوية.
   */
  test("الاستبعاد يظهر فوراً بلا إعادة تحميل ويبقى بعد التنقّل والعودة", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/imports");
    await page
      .locator("tbody tr")
      .filter({ hasText: DECISIONS_FILE })
      .first()
      .getByRole("link", { name: "فتح" })
      .click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
    const batchPageUrl = page.url();

    const table = page.locator("table").last();
    const row = table.locator("tbody tr").filter({ hasText: "تجريبي آلي معلم قرارات" });
    await expect(row.locator("span.rounded-full", { hasText: "جاهز" })).toBeVisible();

    // عدّاد تحميل المستند: كل ما يلي يجب أن يقع داخل التطبيق — لا إعادة تحميل تُخفي العطل
    let documentLoads = 0;
    page.on("load", () => {
      documentLoads += 1;
    });

    await row.getByRole("button", { name: "استبعاد" }).click();
    // الشارة تتغير فوراً من نتيجة الإجراء (المخزن المؤكد من العميل — D-069)
    await expect(row.locator("span.rounded-full", { hasText: "مستبعد" })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByRole("button", { name: "استبعاد" })).toBeHidden();
    // مصالحة HTML الخادم: عدّادات الترويسة تُحدَّث بالتحديث الواحد بعد الإجراء
    await expect(page.getByText(/مستبعد: 1/)).toBeVisible({ timeout: 15_000 });
    expect(documentLoads, "وقعت إعادة تحميل كاملة للمستند").toBe(0);

    // البقاء بعد التنقّل والعودة — الحقيقة من الخادم في تحميل جديد تماماً
    await page.goto("/imports");
    await page.goto(batchPageUrl);
    await expect(row.locator("span.rounded-full", { hasText: "مستبعد" })).toBeVisible();

    // إرجاع الصف جاهزاً — لا يتغير ما تعتمده اختبارات لاحقة على هذه الدفعة
    const undo = row.getByRole("button", { name: "تراجع عن آخر قرار" });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(row.locator("span.rounded-full", { hasText: "جاهز" })).toBeVisible({ timeout: 10_000 });
  });
});

import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { syntheticPlanWorkbook } from "../helpers/fixtures";

/**
 * قبول استيراد الخطة التشغيلية عبر الواجهة عند 390×844 (بعد إصلاح البند الراسب 4):
 * معاينة غنية ببطاقات البرامج + ملخص (سنة/مجالات/برامج) بلا تمرير أفقي،
 * ومنع تكرار رفع نفس الملف، وإلغاء دفعة المعاينة من الواجهة. لا تنفيذ لأي دفعة.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PLAN_FILE = `خطة تجريبي آلي قبول ${Date.now().toString().slice(-8)}.xlsx`;

function principalCredentials(): { username: string; password: string } {
  const content = readFileSync(path.resolve("storage/private/initial-credentials.txt"), "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}
async function login(page: Page) {
  const c = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", c.username);
  await page.fill("#password", c.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");
}
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - doc.clientWidth);
  });
}

test.describe("قبول استيراد الخطة التشغيلية — 390×844", () => {
  test.describe.configure({ mode: "serial" });
  const { defaultBrowserType: _ignored, ...iphone12 } = devices["iPhone 12"];
  test.use({ ...iphone12, viewport: { width: 390, height: 844 }, locale: "ar-SA" });

  let batchUrl = "";

  test("المعاينة: ملخص وبطاقات برامج بلا تمرير أفقي (البند 4)", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto("/imports/new?type=operational_plan");
    await page.setInputFiles("#file", { name: PLAN_FILE, mimeType: XLSX_MIME, buffer: await syntheticPlanWorkbook() });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    batchUrl = page.url();

    // ملخص الخطة: السنة الدراسية + عدد المجالات + عدد البرامج
    await expect(page.getByText("السنة الدراسية")).toBeVisible();
    await expect(page.getByText("عدد المجالات")).toBeVisible();
    await expect(page.getByText("عدد البرامج")).toBeVisible();

    // بطاقات البرامج قابلة للفتح تُظهر الأهداف والمسؤول والتواريخ
    const cards = page.getByTestId("plan-program-card");
    await expect(cards).toHaveCount(2);
    await cards.first().locator("summary").click();
    await expect(cards.first().getByText("الهدف العام")).toBeVisible();
    await expect(cards.first().getByText("مسؤول التنفيذ")).toBeVisible();
    await expect(cards.first().getByText("تاريخ البدء")).toBeVisible();

    expect(await pageOverflow(page), "تمرير أفقي في معاينة الخطة").toBeLessThanOrEqual(0);
  });

  test("منع التكرار: رفع نفس الملف والدفعة قيد المعاينة يُمنع برسالة عربية", async ({ page }) => {
    await login(page);
    await page.goto("/imports/new?type=operational_plan");
    await page.setInputFiles("#file", { name: PLAN_FILE, mimeType: XLSX_MIME, buffer: await syntheticPlanWorkbook() });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await expect(page.getByText(/يوجد استيراد لنفس الملف/)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/imports\/new/);
  });

  test("إلغاء دفعة المعاينة من الواجهة يحررها ويتيح رفعاً جديداً", async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    await login(page);
    await page.goto(batchUrl);
    await page.getByRole("button", { name: "إلغاء الدفعة (لن تُنفذ)" }).click();
    await expect(page.getByText("ملغاة", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // بعد الإلغاء يُسمح برفع نفس الملف من جديد
    await page.goto("/imports/new?type=operational_plan");
    await page.setInputFiles("#file", { name: PLAN_FILE, mimeType: XLSX_MIME, buffer: await syntheticPlanWorkbook() });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByText("عدد البرامج")).toBeVisible();
  });

  test("اسم ملف طويل موصول بشرطات سفلية لا يُحدث تمريراً أفقياً في مركز العمل", async ({ page }) => {
    test.setTimeout(120_000);
    // يحاكي اسم الملف الرسمي الطويل — كان يمدّد بطاقة الاستيراد في لوحة المعلومات 3px
    const longName = `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_قبول_${Date.now().toString().slice(-8)}.xlsx`;
    await login(page);
    await page.goto("/imports/new?type=operational_plan");
    await page.setInputFiles("#file", { name: longName, mimeType: XLSX_MIME, buffer: await syntheticPlanWorkbook() });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    // الدفعة الآن «معاينة» جاهزة → تظهر بطاقتها في مركز العمل باسمها الطويل
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "مركز عمل مدير المدرسة" })).toBeVisible();
    await expect(page.getByText(longName, { exact: false }).first()).toBeVisible();
    expect(await pageOverflow(page), "تمرير أفقي في مركز العمل باسم ملف طويل").toBeLessThanOrEqual(0);
  });
});

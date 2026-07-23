import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * C1–C3: تجربة الجوال — لا تمرير أفقي على مستوى الصفحة في أي مسار رئيسي عند 390px،
 * والقائمة الجانبية العربية مرئية بالكامل وقابلة للاستخدام، والنماذج والبطاقات تحترم الشاشة.
 */

test.use({
  ...devices["iPhone 12"],
  viewport: { width: 390, height: 844 },
  locale: "ar-SA",
});

function principalCredentials(): { username: string; password: string } {
  // يقرأ من مجلد التخزين المعزول للاختبار (storage-e2e) كبقية المواصفات — لا من مجلد التطوير الحقيقي
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  const password = line.split("كلمة المرور المؤقتة:")[1].trim();
  return { username: "principal", password };
}

const ROUTES = [
  "/dashboard", "/tasks", "/notifications",
  "/plan", "/plan/followup", "/plan/kpis", "/plan/risks", "/budget", "/evidence",
  "/performance", "/performance/models",
  "/committees", "/committees/templates",
  "/building", "/building/facilities", "/building/assets", "/building/inspections", "/building/maintenance", "/building/offline",
  "/people", "/calendar", "/reports", "/reports/executive", "/documents",
  "/imports", "/imports/new", "/admin/users", "/admin/settings", "/admin/audit", "/admin/backup",
];
// ملاحظة: /admin/cleanup يُختبر على الجوال في cleanup.spec.ts بميزانية وقت خاصة به
// (صفحته تشغّل المصنّف الكامل، فلا يُدرَج في مسح المسارات الـ28 ذي الميزانية الثابتة).

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

test("صفحة الدخول بلا تمرير أفقي عند 390px", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("كل المسارات الرئيسية بلا تمرير أفقي عند 390px (C1)", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: "networkidle" });
    expect(await pageOverflow(page), `تمرير أفقي في ${route}`).toBeLessThanOrEqual(0);
  }
});

test("القائمة الجانبية على الجوال: ضمن الشاشة، بخلفية معتمة، تقفل التمرير، وتغلق (C2)", async ({ page }) => {
  await login(page);

  // مغلقة ابتداءً: خارج الشاشة تماماً
  const before = await page.locator("aside").boundingBox();
  expect(before!.x).toBeGreaterThanOrEqual(389);

  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.waitForTimeout(350);

  // مفتوحة: داخل الشاشة بالكامل وملتصقة بالحافة اليمنى، وبعرض لا يتجاوز min(86vw, 360px)
  const box = (await page.locator("aside").boundingBox())!;
  expect(Math.round(box.x + box.width)).toBeGreaterThanOrEqual(389);
  expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(391);
  expect(box.width).toBeLessThanOrEqual(Math.min(0.86 * 390, 360) + 1);
  expect(box.x).toBeGreaterThanOrEqual(0);

  // عناوين القائمة مرئية غير مقصوصة
  await expect(page.locator("aside").getByText("مركز عمل مدير المدرسة")).toBeVisible();
  await expect(page.locator("aside").getByText("سجل المعلمين والموظفين")).toBeVisible();

  // خلفية معتمة + قفل تمرير الجسم
  await expect(page.locator('button[aria-label="إغلاق القائمة"].fixed')).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  // زر إغلاق داخل القائمة يعمل
  await page.locator("aside").getByRole("button", { name: "إغلاق القائمة" }).click();
  await page.waitForTimeout(350);
  const closed = await page.locator("aside").boundingBox();
  expect(closed!.x).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

  // الإغلاق عند الضغط على الخلفية المعتمة
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.waitForTimeout(350);
  await page.locator('button[aria-label="إغلاق القائمة"].fixed').click({ position: { x: 10, y: 500 } });
  await page.waitForTimeout(350);
  expect((await page.locator("aside").boundingBox())!.x).toBeGreaterThanOrEqual(389);

  // الإغلاق بعد التنقل
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.waitForTimeout(350);
  await page.locator("aside").getByText("الشواهد").click();
  await page.waitForURL("**/evidence");
  await page.waitForTimeout(350);
  expect((await page.locator("aside").boundingBox())!.x).toBeGreaterThanOrEqual(389);
});

test("حقول الإدخال بخط 16px على الجوال لمنع تكبير سفاري (C3)", async ({ page }) => {
  await page.goto("/login");
  const size = await page.locator("#username").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test("أهداف اللمس في القائمة لا تقل عن 44px", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.waitForTimeout(350);
  const heights = await page.locator("aside nav a").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5);
});

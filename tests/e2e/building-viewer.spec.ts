import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * أزرار التحكم في مخطط المبنى (التصحيح التشغيلي — القضية 1):
 * تقريب/إبعاد/ملاءمة/إعادة ضبط/سحب/عجلة الفأرة تعمل فعلاً وتغيّر `viewBox`،
 * ضمن حدود آمنة، دون تحريك الصفحة، ودون أي كتابة بيانات، وبتسميات عربية وصفية.
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

/** قيمة viewBox الحالية للمخطط كأرقام */
async function viewBox(page: Page): Promise<[number, number, number, number]> {
  const raw = await page.locator(".relative > div[dir='ltr'] > svg").first().getAttribute("viewBox");
  return raw!.split(" ").map(Number) as [number, number, number, number];
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/** يراقب أي طلب كتابة (غير GET) أثناء التفاعل مع أزرار العرض — يجب ألا يقع أي طلب */
function collectWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(`${r.method()} ${r.url()}`);
  });
  return writes;
}

test("سطح المكتب: + و − والملاءمة وإعادة الضبط والسحب والعجلة تعمل ضمن الحدود", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await login(page);
  const writes = collectWrites(page);
  await page.goto("/building");
  const svg = page.locator(".relative > div[dir='ltr'] > svg").first();
  await expect(svg).toBeVisible({ timeout: 20_000 });

  const [x0, y0, w0, h0] = await viewBox(page);

  // كل زر له تسمية عربية وتلميح
  for (const [id, label] of [
    ["viewer-zoom-in", "تقريب"],
    ["viewer-zoom-out", "إبعاد"],
    ["viewer-fit", "ملاءمة المخطط للشاشة"],
    ["viewer-reset", "إعادة ضبط العرض"],
  ] as const) {
    const btn = page.getByTestId(id);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute("aria-label", label);
    await expect(btn).toHaveAttribute("title", label);
  }

  // + يقرّب فعلاً (نافذة العرض تضيق)
  await page.getByTestId("viewer-zoom-in").click();
  let [, , w] = await viewBox(page);
  expect(w).toBeLessThan(w0);

  // − من العرض الابتدائي بعد إعادة الضبط يغيّر العرض فعلاً (كان زراً ميتاً قبل التصحيح)
  await page.getByTestId("viewer-reset").click();
  await page.getByTestId("viewer-zoom-out").click();
  [, , w] = await viewBox(page);
  expect(w).toBeGreaterThan(w0);

  // نقرات متكررة: تتوقف عند حدَّي المقياس دون كسر
  for (let i = 0; i < 12; i++) await page.getByTestId("viewer-zoom-in").click();
  const [, , wMax] = await viewBox(page);
  expect(wMax).toBeCloseTo(w0 / 8, 0);
  for (let i = 0; i < 20; i++) await page.getByTestId("viewer-zoom-out").click();
  const [, , wMin] = await viewBox(page);
  expect(wMin).toBeCloseTo(w0 / 0.5, 0);

  // إعادة الضبط تعيد العرض الابتدائي بالضبط
  await page.getByTestId("viewer-reset").click();
  expect(await viewBox(page)).toEqual([x0, y0, w0, h0]);

  // الملاءمة تعرض صندوق المحتوى كاملاً (نافذة لا تتسع عن الإطار وتحوي كل الأشكال)
  await page.getByTestId("viewer-fit").click();
  const [fx, fy, fw, fh] = await viewBox(page);
  expect(fw).toBeLessThanOrEqual(w0 + 0.01);
  expect(fh).toBeLessThanOrEqual(h0 + 0.01);
  const shapes = await svg.locator("rect").evaluateAll((els) =>
    els.map((el) => ({
      x: Number(el.getAttribute("x")),
      y: Number(el.getAttribute("y")),
      w: Number(el.getAttribute("width")),
      h: Number(el.getAttribute("height")),
    })),
  );
  for (const s of shapes) {
    expect(s.x).toBeGreaterThanOrEqual(fx - 15);
    expect(s.y).toBeGreaterThanOrEqual(fy - 15);
    expect(s.x + s.w).toBeLessThanOrEqual(fx + fw + 15);
    expect(s.y + s.h).toBeLessThanOrEqual(fy + fh + 15);
  }

  // السحب بعد التقريب يحرّك النافذة
  await page.getByTestId("viewer-reset").click();
  await page.getByTestId("viewer-zoom-in").click();
  await page.getByTestId("viewer-zoom-in").click();
  const [px1] = await viewBox(page);
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  const [px2] = await viewBox(page);
  expect(px2).not.toBe(px1);

  // عجلة الفأرة فوق المخطط تقرّب/تبعد ولا تحرّك الصفحة
  await page.getByTestId("viewer-reset").click();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => (await viewBox(page))[2], { timeout: 5_000 })
    .toBeLessThan(w0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  // تبديل الدور يعمل ويعيد ضبط العرض للمخطط الجديد
  await page.getByRole("link", { name: /الأرضي/ }).first().click();
  await page.waitForURL((u) => decodeURIComponent(u.toString()).includes("دور=ground"));
  await expect(svg).toBeVisible({ timeout: 20_000 });
  const [gx, gy, gw] = await viewBox(page);
  expect(Number.isFinite(gx) && Number.isFinite(gy)).toBe(true);
  await page.getByTestId("viewer-zoom-in").click();
  const [, , gwZoomed] = await viewBox(page);
  expect(gwZoomed).toBeLessThan(gw);

  // أزرار العرض لا تكتب شيئاً: لا طلب غير GET صدر أثناء كل ما سبق
  expect(writes).toEqual([]);
  // ولا أخطاء وحدة تحكم
  expect(errors).toEqual([]);
});

test("جوال 390×844: الأزرار ظاهرة وقابلة للنقر وتغيّر العرض ولا تمرير أفقي", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const writes = collectWrites(page);
  await page.goto("/building");
  const svg = page.locator(".relative > div[dir='ltr'] > svg").first();
  await expect(svg).toBeVisible({ timeout: 20_000 });
  const [, , w0] = await viewBox(page);

  // الأزرار داخل إطار المخطط (أسفله) — تصل إليها الإصبع دون أن يحجبها الشريط العلوي
  await page.getByTestId("viewer-zoom-in").scrollIntoViewIfNeeded();
  await page.getByTestId("viewer-zoom-in").click();
  const [, , w1] = await viewBox(page);
  expect(w1).toBeLessThan(w0);
  await page.getByTestId("viewer-zoom-out").click();
  await page.getByTestId("viewer-reset").click();
  const [, , w2] = await viewBox(page);
  expect(w2).toBe(w0);
  await page.getByTestId("viewer-fit").click();

  // لا تمرير أفقي للصفحة كلها
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, 0),
  );
  expect(overflow).toBe(0);

  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

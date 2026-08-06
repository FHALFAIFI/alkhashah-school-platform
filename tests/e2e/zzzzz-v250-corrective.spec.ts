import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * Corrective fix (post-v2.5.0 deployment) — browser evidence for the two acceptance failures.
 *
 *  1. The low-performance threshold had no on-screen control. It was reachable only by editing
 *     the URL, so in practice it did not exist. The assertions below reach it the way the
 *     principal does — open the filters panel, read the field, type a number — because "the
 *     engine honours ?lowThreshold=" was already true when the requirement was reported failed.
 *
 *  2. A blank financial amount saved as NULL. Here the form is submitted through the browser
 *     with the amount left empty, and the assertion is that no row appears. The server-side
 *     half of that rule (forged requests with no browser in the path) is pinned in
 *     `tests/integration/finance-required-amount.test.ts`.
 *
 * Ordered `zzzzz-` so it runs after `zzzz-v250`, which creates and permanently deletes records.
 */

const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

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
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

async function withDb<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Opens the standard filters panel — every filter control lives inside it, collapsed by default */
async function openFilters(page: Page) {
  await page.getByRole("button", { name: "المرشّحات" }).first().click();
}

const LOW_REPORT = "/reports?category=performance&report=perf-low-performers";
const RESULTS_REPORT = "/reports?category=performance&report=perf-results";

test.describe("issue 1 — the low-performance threshold is reachable on screen", () => {
  test("the control is visible, labelled, explained, and defaults to 70", async ({ page }) => {
    await login(page);
    await page.goto(LOW_REPORT);
    await openFilters(page);

    const field = page.locator("#f-low");
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("70");
    await expect(page.getByText("حد الأداء المنخفض", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("يعرض الموظفين الذين تقل نتائجهم عن النسبة المحددة")).toBeVisible();
  });

  test("typing a new threshold applies it — no URL editing", async ({ page }) => {
    await login(page);
    await page.goto(LOW_REPORT);
    await openFilters(page);

    await page.locator("#f-low").fill("85");
    await page.locator("#f-low").press("Enter");
    await page.waitForURL(/lowThreshold=85/, { timeout: 30_000 });
    // and the applied value is reported back as an active filter
    await expect(page.getByText("حد الأداء المنخفض: أقل من 85٪")).toBeVisible();
  });

  test("an out-of-range value is normalized rather than applied raw", async ({ page }) => {
    await login(page);
    await page.goto(LOW_REPORT);
    await openFilters(page);

    await page.locator("#f-low").fill("999");
    await page.locator("#f-low").press("Enter");
    await page.waitForURL(/lowThreshold=100/, { timeout: 30_000 });
  });

  test("the threshold is offered on the all-employees report too, not only low performers", async ({ page }) => {
    await login(page);
    await page.goto(RESULTS_REPORT);
    await openFilters(page);
    await expect(page.locator("#f-low")).toBeVisible();
  });

  test("the report builder offers the threshold when a performance report is selected", async ({ page }) => {
    await login(page);
    await page.goto("/reports/builder?report=perf-low-performers");
    await openFilters(page);
    await expect(page.locator("#f-low")).toBeVisible();
  });
});

test.describe("issue 2 — a financial amount cannot be left blank", () => {
  /*
   * `/budget` renders an empty state when no plan year is active, so the forms under test do
   * not exist without one. This spec therefore provides its own and removes it afterwards,
   * rather than depending on whichever earlier spec happened to leave a year behind.
   */
  let seededYearId: string | null = null;

  test.beforeAll(async () => {
    seededYearId = await withDb(async (p) => {
      const existing = await p.query("select id from plan_years where status = 'نشطة' limit 1");
      if (existing.rowCount) return null;
      const created = await p.query(
        "insert into plan_years (key, name_ar, status) values ($1, $2, 'نشطة') returning id",
        [`corrective-${Date.now()}`, "سنة الفحص التصحيحي"],
      );
      return created.rows[0].id as string;
    });
  });

  test.afterAll(async () => {
    if (!seededYearId) return;
    await withDb(async (p) => {
      await p.query("delete from budget_income where plan_year_id = $1", [seededYearId]);
      await p.query("delete from budget_expenses where plan_year_id = $1", [seededYearId]);
      await p.query("delete from plan_years where id = $1", [seededYearId]);
    });
  });

  test("submitting income with no amount is refused and writes no row", async ({ page }) => {
    await login(page);
    const before = await withDb(async (p) => Number((await p.query("select count(*) from budget_income")).rows[0].count));

    await page.goto("/budget");
    await page.getByRole("button", { name: "إضافة إيراد" }).first().click();
    await page.locator('input[name="source"]').first().fill("مصدر بلا مبلغ");

    // the field advertises itself as required, and the form refuses to submit while it is empty
    await expect(page.locator('input[name="amount"]').first()).toHaveAttribute("required", "");
    await page.getByRole("button", { name: "حفظ الإيراد" }).first().click();

    await page.waitForTimeout(1500);
    const after = await withDb(async (p) => Number((await p.query("select count(*) from budget_income")).rows[0].count));
    expect(after).toBe(before);
  });

  test("submitting expense with no amount is refused and writes no row", async ({ page }) => {
    await login(page);
    const before = await withDb(async (p) => Number((await p.query("select count(*) from budget_expenses")).rows[0].count));

    await page.goto("/budget");
    await page.getByRole("button", { name: "إضافة مصروف" }).first().click();
    await expect(page.locator("#ex-amount")).toHaveAttribute("required", "");
    await page.getByRole("button", { name: "حفظ المصروف" }).first().click();

    await page.waitForTimeout(1500);
    const after = await withDb(async (p) => Number((await p.query("select count(*) from budget_expenses")).rows[0].count));
    expect(after).toBe(before);
  });

  test("a valid amount still saves — the rule blocks nothing legitimate", async ({ page }) => {
    await login(page);
    const marker = `إيراد تصحيحي ${Date.now()}`;

    await page.goto("/budget");
    await page.getByRole("button", { name: "إضافة إيراد" }).first().click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "حفظ الإيراد" }) }).first();
    await form.locator('input[name="source"]').fill(marker);
    await form.locator('input[name="amount"]').fill("1250.50");
    await form.getByRole("button", { name: "حفظ الإيراد" }).click();

    // surface the server's own message if it refuses — a bare count timeout says nothing
    await page.waitForTimeout(2000);
    const alerts = await page.getByRole("alert").allInnerTexts();
    const saved = await withDb(async (p) =>
      Number((await p.query("select count(*) from budget_income where source = $1", [marker])).rows[0].count),
    );
    expect(saved, `server said: ${alerts.join(" | ") || "(no alert shown)"}`).toBe(1);

    const amount = await withDb(async (p) =>
      (await p.query("select amount from budget_income where source = $1", [marker])).rows[0].amount,
    );
    expect(Number(amount)).toBe(1250.5);

    await withDb(async (p) => p.query("delete from budget_income where source = $1", [marker]));
  });

  test("the income form no longer claims that every field is optional", async ({ page }) => {
    await login(page);
    await page.goto("/budget");
    await page.getByRole("button", { name: "إضافة إيراد" }).first().click();
    await expect(page.getByText("كل الحقول اختيارية")).toHaveCount(0);
    await expect(page.getByText("المبلغ مطلوب", { exact: false }).first()).toBeVisible();
  });
});

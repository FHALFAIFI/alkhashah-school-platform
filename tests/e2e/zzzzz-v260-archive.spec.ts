import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * v2.6 §A/§B/§I — the report-archive flow in the browser.
 *
 * Serial by design: one instance is created as a draft, downloaded, finalized,
 * checked for immutability, waited on for background outputs, found via archive
 * search, then versioned. Each scenario carries the state of the previous one
 * (module-level `instanceId` / `reportNumber`), exactly like the record lifecycle
 * the principal will drive.
 *
 * Ordered `zzzzz-` so it runs after every earlier spec — it creates and finalizes
 * records that must not be observed by earlier specs.
 */

const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

const TAG = "v260";
const DRAFT_TITLE = "تقرير e2e تجريبي";

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

async function activePlanYearId(pool: Pool): Promise<string> {
  const found = await pool.query<{ id: string }>(
    "select id from plan_years where status = 'نشطة' order by created_at desc limit 1",
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await pool.query<{ id: string }>(
    "insert into plan_years (key, name_ar, status) values ($1, $2, 'نشطة') returning id",
    [`${TAG}-yr`, `سنة ${TAG}`],
  );
  return created.rows[0].id;
}

/** A non-closed, non-archived program seeded directly — data setup is not what this spec tests */
async function seedActiveProgram(pool: Pool, name: string): Promise<string> {
  const yearId = await activePlanYearId(pool);
  const seq = await pool.query<{ next: number }>("select coalesce(max(seq), 0) + 1 as next from programs");
  const res = await pool.query<{ id: string }>(
    `insert into programs (plan_year_id, seq, domain, name, owner_position, status, progress, execution_status)
     values ($1, $2, $3, $4, $5, 'معتمد', 40, 'في المسار') returning id`,
    [yearId, seq.rows[0].next, "المجال الأول", name, "وكيل الشؤون التعليمية"],
  );
  return res.rows[0].id;
}

const PROGRAM_NAME = `برنامج نشط للأرشيف ${TAG}`;
const UUID_PATH = /\/reports\/archive\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// State carried across the serial scenarios
let instanceId = "";
let reportNumber = "";

/**
 * شارة حالة التقرير في ترويسة الصفحة. تُقصد الشارة تحديداً لا أي نص مطابق: جدول المعاينة
 * يعرض حالات البرامج نفسها («مسودة»/«معتمد»)، فمطابقة النص وحدها تلتقط خلايا الجدول أيضاً.
 */
const statusBadge = (page: import("@playwright/test").Page, value: string) =>
  page.locator("span.rounded-full").filter({ hasText: new RegExp(`^${value}$`) });

test.describe("v2.6 — التقرير المحفوظ: من المسودة إلى الأرشيف", () => {
  test.describe.configure({ mode: "serial" });

  test("١. إنشاء مسودة تقرير مفرد «البرامج النشطة» — تهبط على صفحة المسودة بمعاينة حية", async ({ page }) => {
    test.setTimeout(120_000);
    await withDb((pool) => seedActiveProgram(pool, PROGRAM_NAME));
    await login(page);

    await page.goto("/reports/archive");
    await page.getByRole("link", { name: "تقرير جديد" }).click();
    await page.waitForURL("**/reports/archive/new");

    // Single type + source report + title
    await page.locator('input[name="typeKey"][value="single"]').check();
    await page.locator("#reportKey").selectOption("programs-active");
    await page.locator("#title").fill(DRAFT_TITLE);
    await page.getByRole("button", { name: "إنشاء المسودة" }).click();

    // The create action redirects straight to the draft page
    await page.waitForURL(UUID_PATH, { timeout: 60_000 });
    instanceId = page.url().split("/").pop()!;

    await expect(page.getByRole("heading", { name: DRAFT_TITLE })).toBeVisible();
    await expect(statusBadge(page, "مسودة").first()).toBeVisible();
    await expect(page.getByText("معاينة حية — تتغير بالمرشّحات")).toBeVisible();
    // Live preview really reads live data: the seeded program is on screen
    await expect(page.getByText(PROGRAM_NAME).first()).toBeVisible();
  });

  test("٢. تنزيل PDF المسودة — استجابة ناجحة ومحتوى PDF فعلي", async ({ page }) => {
    test.setTimeout(120_000);
    expect(instanceId).not.toBe("");
    await login(page);
    await page.goto(`/reports/archive/${instanceId}`);

    // Authenticated download: click as the user (page.request may not carry the session)
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 90_000 }),
      page.getByRole("link", { name: "تنزيل PDF" }).click(),
    ]);
    expect(await download.failure()).toBeNull();
    const filePath = await download.path();
    const head = readFileSync(filePath).subarray(0, 5).toString("latin1");
    expect(head).toBe("%PDF-");
  });

  test("٣. الاعتماد النهائي والترقيم — شارة «نهائي» ورقم تقرير ولا نموذج تحرير", async ({ page }) => {
    test.setTimeout(120_000);
    expect(instanceId).not.toBe("");
    await login(page);
    await page.goto(`/reports/archive/${instanceId}`);

    // D-069 acceptance: the badge must appear WITHOUT any full document reload —
    // the post-action refresh was lost on production builds (loading.tsx +
    // vercel/next.js#86151) and the badge never appeared over plain HTTP/1.1.
    let documentLoads = 0;
    page.on("load", () => {
      documentLoads += 1;
    });

    // SubmitButton confirmText raises a JS confirm dialog — accept it
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "اعتماد نهائي وترقيم" }).click();

    // useRefreshOnSuccess re-renders the page as final (verified refresh — D-069)
    await expect(statusBadge(page, "نهائي").first()).toBeVisible({ timeout: 90_000 });
    expect(documentLoads, "a full document reload occurred").toBe(0);

    const subtitle = await page.getByText(/رقم التقرير:/).innerText();
    const match = subtitle.match(/KHS-RPT-\d{4}-\d{4}/);
    expect(match).not.toBeNull();
    reportNumber = match![0];

    // The draft edit form is gone
    await expect(page.getByRole("button", { name: "حفظ المسودة" })).toHaveCount(0);
    await expect(page.getByText("معاينة حية — تتغير بالمرشّحات")).toHaveCount(0);
    await expect(page.getByText("اللقطة المعتمدة — كما جُمّدت لحظة الاعتماد")).toBeVisible();
  });

  test("٤. ثبات التقرير النهائي — لا زر «حذف المسودة»", async ({ page }) => {
    expect(instanceId).not.toBe("");
    await login(page);
    await page.goto(`/reports/archive/${instanceId}`);

    await expect(statusBadge(page, "نهائي").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "حذف المسودة" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "اعتماد نهائي وترقيم" })).toHaveCount(0);
  });

  test("٥. المخرجات الخلفية (§I) — التوليد يكتمل وتظهر روابط التنزيل وحزمة ZIP", async ({ page }) => {
    test.setTimeout(150_000);
    expect(instanceId).not.toBe("");
    await login(page);
    await page.goto(`/reports/archive/${instanceId}`);

    // The page polls itself while the job is active (JobWatcher). PDF generation
    // launches chromium server-side, so the wait is generous.
    const done = page
      .getByText("حالة التوليد: مكتمل")
      .or(page.getByRole("link", { name: "تنزيل PDF" }));
    await expect(done.first()).toBeVisible({ timeout: 90_000 });

    // At least one stored output link, and the assembled ZIP bundle
    await expect(page.getByRole("link", { name: "تنزيل PDF" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: "تنزيل ZIP" })).toBeVisible({ timeout: 90_000 });
  });

  test("٦. البحث في الأرشيف — بالرقم يظهر، وبحالة «نهائي» يظهر، وبحالة «مسودة» لا يظهر", async ({ page }) => {
    expect(reportNumber).not.toBe("");
    await login(page);
    await page.goto("/reports/archive");

    const form = page.locator('form[action="/reports/archive"]');
    await form.locator("#search").fill(reportNumber);
    await form.getByRole("button", { name: "بحث" }).click();
    await expect(page.locator("tr", { hasText: reportNumber })).toBeVisible();
    await expect(page.locator("tr", { hasText: reportNumber })).toContainText(DRAFT_TITLE);

    // Status filter «نهائي»: the row still appears
    await form.locator("#status").selectOption("نهائي");
    await form.getByRole("button", { name: "بحث" }).click();
    await expect(page.locator("tr", { hasText: reportNumber })).toBeVisible();

    // Status filter «مسودة»: the finalized report must not appear
    await form.locator("#status").selectOption("مسودة");
    await form.getByRole("button", { name: "بحث" }).click();
    await expect(page.getByText("لا تقارير محفوظة مطابقة")).toBeVisible();
    await expect(page.locator("tr", { hasText: reportNumber })).toHaveCount(0);
  });

  test("٧. نسخة جديدة (برقم جديد) — مسودة جديدة تشير إلى التقرير الأصلي", async ({ page }) => {
    test.setTimeout(120_000);
    expect(instanceId).not.toBe("");
    await login(page);
    await page.goto(`/reports/archive/${instanceId}`);

    await page.getByRole("button", { name: "نسخة جديدة (برقم جديد)" }).click();

    // The action redirects to the new instance — a different id than the original
    await page.waitForURL(
      (url) => UUID_PATH.test(url.pathname) && !url.pathname.endsWith(instanceId),
      { timeout: 60_000 },
    );
    const newId = page.url().split("/").pop()!;
    expect(newId).not.toBe(instanceId);

    await expect(statusBadge(page, "مسودة").first()).toBeVisible();
    await expect(page.getByText("هذا التقرير نسخة جديدة من")).toBeVisible();
    const originalLink = page.getByRole("link", { name: "تقرير أصلي سابق" });
    await expect(originalLink).toBeVisible();
    await expect(originalLink).toHaveAttribute("href", `/reports/archive/${instanceId}`);
  });
});

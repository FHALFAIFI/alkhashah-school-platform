import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * v2.2 §D — section → report deep links.
 *
 * The unit matrix proves every route is classified and every link points at a real
 * report. This spec proves the other half in a browser: clicking «تقارير القسم» from a
 * section actually lands on that section's category with the intended report selected,
 * and no button opens an error page.
 */

function principalCredentials(): { username: string; password: string } {
  const dir = process.env.E2E_STORAGE_DIR ?? "storage-e2e";
  const file = path.resolve(process.cwd(), dir, "private", "initial-credentials.txt");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}

async function login(page: Page) {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

/** الأقسام التي تحمل زر «تقارير القسم» وما يجب أن يفتحه كل زر */
const SECTIONS: { route: string; category: string; report?: string }[] = [
  { route: "/plan", category: "plan" },
  { route: "/plan/kpis", category: "plan", report: "plan-kpis" },
  { route: "/plan/followup", category: "plan", report: "plan-followups" },
  { route: "/plan/classifications", category: "plan", report: "programs-by-domain" },
  { route: "/plan/risks", category: "risks" },
  { route: "/plan/swot", category: "risks", report: "swot-register" },
  { route: "/tasks", category: "plan", report: "action-tasks" },
  { route: "/calendar", category: "plan", report: "calendar-events" },
  { route: "/evidence", category: "evidence" },
  { route: "/people", category: "employees" },
  { route: "/documents", category: "documents" },
  { route: "/imports", category: "imports" },
  { route: "/committees", category: "committees" },
  { route: "/performance", category: "performance" },
  { route: "/building", category: "building" },
  { route: "/admin/audit", category: "usage", report: "audit-log" },
  { route: "/admin/feedback", category: "usage", report: "feedback-register" },
];

test.describe("§D — الربط العميق من الأقسام إلى مركز التقارير", () => {
  test("كل زر «تقارير القسم» يفتح فئته الصحيحة بلا خطأ", async ({ page }) => {
    await login(page);
    for (const s of SECTIONS) {
      await page.goto(s.route);
      const link = page.getByRole("link", { name: "تقارير القسم" }).first();

      /**
       * القسم الذي لم تُستورد بياناته بعد يعرض حالة فارغة موثّقة بدل رأس صفحة كامل —
       * وهذا سلوك مقصود لا زر مكسور. الاختبار يقبله صراحةً ويشترط ظهور تلك الحالة،
       * فلا يمرّ قسم فقد زره فعلاً.
       */
      // `count()` لقطة لحظية بلا انتظار — الانتظار الصريح يمنع نتيجة كاذبة قبل اكتمال التصيير
      const present = await link
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!present) {
        await expect(
          page.getByText(/لم تستورد الخطة التشغيلية بعد|لا .{2,40} بعد/).first(),
          `${s.route}: لا زر تقارير ولا حالة فارغة موثّقة`,
        ).toBeVisible({ timeout: 10_000 });
        continue;
      }

      const href = await link.getAttribute("href");
      expect(href, `${s.route}: رابط فارغ`).toContain(`category=${s.category}`);
      if (s.report) expect(href).toContain(`report=${s.report}`);

      await link.click();
      await page.waitForURL(/\/reports\?/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { name: "مركز التقارير" })).toBeVisible();
      // لا صفحة خطأ ولا رسالة تعذّر
      await expect(page.getByText("حدث خطأ")).toHaveCount(0);
    }
  });

  test("تقرير التحليل الرباعي يفتح مباشرةً من قسمه", async ({ page }) => {
    await login(page);
    await page.goto("/plan/swot");
    await expect(page.getByRole("heading", { name: "التحليل الرباعي" })).toBeVisible();
    await page.getByRole("link", { name: "تقارير القسم" }).first().click();
    await page.waitForURL(/report=swot-register/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "سجل التحليل الرباعي", level: 2 })).toBeVisible();
  });

  test("مركز التقارير يعرض فئة «المخاطر والتحليل الرباعي» بتقاريرها", async ({ page }) => {
    await login(page);
    await page.goto("/reports?category=risks");
    await expect(page.getByRole("heading", { name: "سجل المخاطر" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "سجل التحليل الرباعي" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "التحليل الرباعي حسب النوع" })).toBeVisible();
  });
});

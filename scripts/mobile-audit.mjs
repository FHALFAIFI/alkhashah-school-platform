// Mobile overflow audit — visits every principal route at 390x844 and reports
// page-level horizontal overflow plus the elements that cause it.
import { chromium, devices } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3080";
const OUT = path.resolve(process.argv[2] ?? "audit-shots");
mkdirSync(OUT, { recursive: true });

const credsFile = "/Users/fahedalfify/Developer/School/Father's File/storage/private/initial-credentials.txt";
const line = readFileSync(credsFile, "utf8").split("\n").find((l) => l.includes("principal"));
const password = line.split("كلمة المرور المؤقتة:")[1].trim();

const ROUTES = [
  "/dashboard", "/tasks", "/notifications",
  "/plan", "/plan/kpis", "/plan/risks", "/evidence",
  "/performance", "/performance/models", "/performance/cycles",
  "/committees", "/committees/templates",
  "/building", "/building/assets", "/building/inspections", "/building/maintenance", "/building/rooms", "/building/offline",
  "/people", "/calendar", "/reports", "/reports/executive", "/documents",
  "/imports", "/imports/new", "/admin/users", "/admin/settings", "/admin/audit", "/admin/backup",
];

const iphone = { viewport: { width: Number(process.env.VW ?? 390), height: Number(process.env.VH ?? 844) }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "ar-SA" };

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const overflow = Math.max(doc.scrollWidth - vw, document.body.scrollWidth - vw);
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // element extends beyond viewport horizontally (RTL overflow goes left)
      if (r.right > vw + 1 || r.left < -1) {
        // skip elements inside an intentional horizontal scroll container
        let p = el.parentElement, contained = false;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if ((s.overflowX === "auto" || s.overflowX === "scroll") && p.clientWidth <= vw) { contained = true; break; }
          p = p.parentElement;
        }
        // skip the off-canvas drawer itself (translated off-screen intentionally)
        if (el.closest("aside") && !document.body.style.overflow) {
          const aside = el.closest("aside");
          const ar = aside.getBoundingClientRect();
          if (ar.left >= vw - 1) continue; // fully off-screen
        }
        if (!contained) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className?.toString() ?? "").slice(0, 90),
            left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          });
        }
      }
    }
    // dedupe: keep only outermost offenders
    return { vw, overflow, offenders: offenders.slice(0, 12) };
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext(iphone);
const page = await ctx.newPage();

// login
await page.goto(BASE + "/login");
await page.fill("#username", "principal");
await page.fill("#password", password);
await page.getByRole("button", { name: "تسجيل الدخول" }).click();
await page.waitForURL("**/dashboard");

const report = [];

// audit login page separately (fresh context)
{
  const ctx2 = await ctx.browser().newContext(iphone);
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/login");
  await p2.waitForLoadState("networkidle");
  const m = await measure(p2);
  await p2.screenshot({ path: path.join(OUT, "login.png"), fullPage: false });
  report.push({ route: "/login", ...m });
  await ctx2.close();
}

const detailLinks = {};
for (const route of ROUTES) {
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 });
  } catch { await page.goto(BASE + route, { timeout: 30000 }).catch(() => {}); }
  await page.waitForTimeout(400);
  const m = await measure(page);
  const name = route.replace(/\//g, "_").replace(/^_/, "") || "root";
  await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });
  report.push({ route, ...m });
  // collect one detail link per list page
  const href = await page.evaluate((r) => {
    const a = [...document.querySelectorAll(`main a[href^="${r}/"]`)].find((x) => /\/[0-9a-f-]{8,}/.test(x.getAttribute("href")));
    return a?.getAttribute("href") ?? null;
  }, route);
  if (href) detailLinks[route] = href;
}

for (const [parent, href] of Object.entries(detailLinks)) {
  try {
    await page.goto(BASE + href, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(400);
    const m = await measure(page);
    const name = "detail" + parent.replace(/\//g, "_");
    await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });
    report.push({ route: href, ...m });
  } catch (e) { report.push({ route: href, error: String(e).slice(0, 120) }); }
}

// drawer test on dashboard
await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "فتح القائمة" }).click();
await page.waitForTimeout(400);
const drawer = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const r = aside.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const backdrop = !!document.querySelector('button[aria-label="إغلاق القائمة"].fixed');
  const bodyLocked = document.body.style.overflow === "hidden";
  return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), vw, backdrop, bodyLocked };
});
await page.screenshot({ path: path.join(OUT, "drawer-open.png") });
report.push({ route: "drawer", drawer });

console.log(JSON.stringify(report, null, 1));
await browser.close();

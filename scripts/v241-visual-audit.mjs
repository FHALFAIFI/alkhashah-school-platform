/**
 * v2.4.1 §3 — RTL / visual validation across the four required widths.
 *
 * Extends `mobile-audit.mjs` (which only measured 390px) to the widths the brief names:
 * 1366×768 laptop, 1440×900 desktop, 1024×768 tablet, 360×740 narrow mobile.
 *
 * For every v2.4.1 surface it measures, at each width:
 *   • page-level horizontal overflow (must be 0 — wide tables must scroll inside their own
 *     `overflow-x` container, never push the document sideways)
 *   • clipped text (`scrollWidth > clientWidth` on a non-scrollable element)
 *   • controls overlapping each other in the action rows
 *   • `dir=rtl` actually applied
 *   • keyboard focus reaching the first sidebar link with a visible outline
 *   • destructive actions rendered in a high-contrast style
 * and captures a screenshot for the delivery record.
 *
 * Usage:  APP_URL=http://localhost:3081 node scripts/v241-visual-audit.mjs [outDir]
 */

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3081";
const OUT = path.resolve(process.argv[2] ?? "storage-e2e/visual-audit");
mkdirSync(OUT, { recursive: true });

const credsFile = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage-e2e", "private/initial-credentials.txt");
const line = readFileSync(credsFile, "utf8").split("\n").find((l) => l.includes("principal"));
const password = line.split("كلمة المرور المؤقتة:")[1].trim();

const WIDTHS = [
  { name: "laptop-1366", width: 1366, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "mobile-360", width: 360, height: 740 },
];

/** The surfaces v2.4.1 touched, plus the ones the brief calls out explicitly. */
const ROUTES = [
  "/dashboard",
  "/budget",
  "/plan",
  "/plan/consistency",
  "/plan/consistency?filter=all",
  "/plan/followup",
  "/committees",
  "/performance",
  "/performance/models",
  "/performance/analytics",
  "/reports?category=plan&report=programs-by-owner",
  "/reports?category=committees&report=committee-members",
];

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;

    const inScroller = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if ((s.overflowX === "auto" || s.overflowX === "scroll") && p.clientWidth <= vw + 1) return true;
        p = p.parentElement;
      }
      return false;
    };

    // 1) فيض أفقي على مستوى الصفحة
    const overflow = Math.max(doc.scrollWidth - vw, document.body.scrollWidth - vw);
    const offenders = [];
    for (const el of document.querySelectorAll("main *, header *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString() ?? "").slice(0, 70),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }

    // 2) نص مقصوص: عنصر محتواه أعرض من إطاره وليس داخل حاوية تمرير ولا معلَّم truncate
    const clipped = [];
    for (const el of document.querySelectorAll("main p, main span, main dd, main dt, main td, main th, main h1, main h2, main h3, main label, main button, main a")) {
      if (el.children.length > 0) continue;
      const s = getComputedStyle(el);
      if (s.overflow === "hidden" && s.textOverflow === "ellipsis") continue; // قصّ مقصود
      if (s.overflowX === "auto" || s.overflowX === "scroll") continue;
      if (inScroller(el)) continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        clipped.push({ text: (el.textContent ?? "").trim().slice(0, 45), sw: el.scrollWidth, cw: el.clientWidth });
      }
    }

    // 3) تراكب أزرار داخل صف إجراءات واحد
    const overlaps = [];
    for (const row of document.querySelectorAll("main .flex")) {
      const kids = [...row.children].filter((k) => k.getBoundingClientRect().width > 0);
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[j].getBoundingClientRect();
          const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (hOverlap > 4 && vOverlap > 4) {
            overlaps.push({ a: kids[i].tagName, b: kids[j].tagName, hOverlap: Math.round(hOverlap) });
          }
        }
      }
    }

    // 4) جداول عريضة يجب أن تمرَّر داخل حاويتها
    const tables = [...document.querySelectorAll("main table")].map((t) => ({
      w: Math.round(t.getBoundingClientRect().width),
      scrollable: inScroller(t),
      wider: t.scrollWidth > vw,
    }));

    return {
      vw,
      overflow: Math.max(0, overflow),
      offenders: offenders.slice(0, 6),
      clipped: clipped.slice(0, 6),
      overlaps: overlaps.slice(0, 4),
      rtl: doc.getAttribute("dir") === "rtl" || getComputedStyle(doc).direction === "rtl",
      tables,
    };
  });
}

const browser = await chromium.launch();
const report = [];
let failures = 0;

for (const w of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: w.width, height: w.height },
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    isMobile: w.width < 500,
    hasTouch: w.width < 500,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { timeout: 120_000 });
  await page.fill("#username", "principal");
  await page.fill("#password", password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  for (const route of ROUTES) {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 120_000 });
    } catch {
      await page.goto(BASE + route, { timeout: 120_000 }).catch(() => {});
    }
    await page.waitForTimeout(300);
    const m = await measure(page);
    const name = `${w.name}${route.replace(/[/?=&]/g, "_")}`;
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const bad = m.overflow > 1 || m.clipped.length > 0 || m.overlaps.length > 0 || !m.rtl;
    if (bad) failures++;
    report.push({ width: w.name, route, status: bad ? "FAIL" : "PASS", ...m });
  }

  // تركيز لوحة المفاتيح: أول رابط في القائمة يستقبل التبئير بمخطط ظاهر
  await page.goto(BASE + "/plan/consistency", { waitUntil: "networkidle", timeout: 120_000 });
  const focus = await page.evaluate(() => {
    const first = document.querySelector("aside a");
    first.focus();
    const s = getComputedStyle(first, ":focus-visible");
    return { focused: document.activeElement === first, outline: `${s.outlineWidth} ${s.outlineStyle}` };
  });

  // الإجراءات الهدّامة بتباين عالٍ (نص أحمر داكن على خلفية فاتحة)
  await page.goto(BASE + "/performance/models", { waitUntil: "networkidle", timeout: 120_000 });
  const destructive = await page.evaluate(() => {
    const el = [...document.querySelectorAll("main button, main a")].find((b) =>
      /حذف|أرشفة/.test(b.textContent ?? ""),
    );
    if (!el) return { found: false };
    const s = getComputedStyle(el);
    return { found: true, color: s.color, border: s.borderColor };
  });

  report.push({ width: w.name, route: "(keyboard+destructive)", status: focus.focused ? "PASS" : "FAIL", focus, destructive });
  if (!focus.focused) failures++;

  await ctx.close();
}

await browser.close();

writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1), "utf8");

const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
console.log("\nv2.4.1 §3 — RTL / visual audit\n");
console.log(pad("المقاس", 14), pad("المسار", 52), pad("الحالة", 6), "فيض / قصّ / تراكب");
console.log("-".repeat(120));
for (const r of report) {
  console.log(
    pad(r.width, 14),
    pad(r.route, 52),
    pad(r.status, 6),
    r.overflow === undefined
      ? JSON.stringify(r.focus ?? {})
      : `overflow=${r.overflow} clipped=${r.clipped.length} overlap=${r.overlaps.length} rtl=${r.rtl}`,
  );
  for (const o of r.offenders ?? []) console.log("   ⤷ offender", o.tag, o.cls, o.left, o.right);
  for (const c of r.clipped ?? []) console.log("   ⤷ clipped", JSON.stringify(c));
}
console.log(`\n${report.filter((r) => r.status === "PASS").length} PASS · ${failures} FAIL`);
console.log(`اللقطات: ${OUT}`);
process.exit(failures > 0 ? 1 : 0);

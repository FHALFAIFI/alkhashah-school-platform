/**
 * v2.5.0 §23 — performance measurement on production-shaped data.
 *
 * Measures server response time for the surfaces this scope added or changed, against the RC
 * image on a clone of production. Reports the median of five samples per surface after one
 * warm-up, so a cold compile does not masquerade as a slow query.
 *
 * What it is watching for, in the brief's terms: N+1 queries, unbounded reads, expensive
 * dynamic joins, and the cost of loading filter options. The numbers are recorded in the
 * delivery document so a later change can be compared against them rather than argued about.
 *
 *   APP_URL=http://127.0.0.1:3087 AUDIT_USER=rehearsal AUDIT_PASSWORD=… \
 *   node scripts/v250-perf-audit.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3087";
const USER = process.env.AUDIT_USER ?? "rehearsal";
const PASSWORD = process.env.AUDIT_PASSWORD;
if (!PASSWORD) throw new Error("AUDIT_PASSWORD is required");

/** عتبة الانتباه — ما تجاوزها يستحق نظرة، وليس فشلاً بذاته */
const ATTENTION_MS = 1500;

const SURFACES = [
  ["مركز التقارير", "/reports"],
  ["البرامج حسب المجال (تفصيلي)", "/reports?category=plan&report=programs-by-domain"],
  ["البرامج حسب المسؤول", "/reports?category=plan&report=programs-by-owner"],
  ["المتابعة الأسبوعية — الشاشة", "/plan/followup"],
  ["المتابعة الأسبوعية — التقرير", "/reports?category=plan&report=plan-followups"],
  ["نتائج الأداء التفصيلية", "/reports?category=performance&report=perf-results"],
  ["الأداء المنخفض", "/reports?category=performance&report=perf-low-performers"],
  ["السجل التفصيلي للجان", "/reports?category=committees&report=committee-registry-detailed"],
  ["سجل الاجتماعات التفصيلي", "/reports?category=meetings&report=meetings-registry-detailed"],
  ["بلاغات الصيانة", "/reports?category=building&report=maintenance-register"],
  ["سجل المصروفات", "/reports?category=finance&report=expense-register"],
  ["استغلال المخصصات", "/reports?category=finance&report=allocation-utilization"],
  ["منشئ التقارير", "/reports/builder"],
  ["المنشئ بتقرير محدد", "/reports/builder?report=programs-by-domain"],
  ["القوالب المحفوظة", "/reports/templates"],
  ["التقرير الفردي", "/reports/individual"],
  ["تصدير CSV", "/api/reports/export?category=plan&report=programs-by-domain&format=csv"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ar-SA" });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("#username", USER);
await page.fill("#password", PASSWORD);
await page.getByRole("button", { name: "تسجيل الدخول" }).click();
await page.waitForURL("**/dashboard", { timeout: 30_000 });

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = [];

for (const [label, route] of SURFACES) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" }).catch(() => {}); // إحماء
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const res = await page.goto(BASE + route, { waitUntil: "domcontentloaded" }).catch(() => null);
    samples.push(Date.now() - t0);
    if (res && res.status() >= 400) rows.push({ label, route, median: -1, status: res.status() });
  }
  rows.push({ label, route, median: median(samples), min: Math.min(...samples), max: Math.max(...samples) });
}

await browser.close();

const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
console.log("\nv2.5.0 §23 — قياس الأداء على نسخة من بيانات الإنتاج (وسيط 5 عينات بعد إحماء)\n");
console.log(pad("السطح", 34), pad("الوسيط", 9), pad("الأدنى", 8), pad("الأعلى", 8), "ملاحظة");
console.log("-".repeat(80));
let attention = 0;
for (const r of rows) {
  if (r.median === -1) continue;
  const note = r.median > ATTENTION_MS ? "يستحق النظر" : "";
  if (note) attention++;
  console.log(pad(r.label, 34), pad(`${r.median} ms`, 9), pad(`${r.min}`, 8), pad(`${r.max}`, 8), note);
}
console.log(`\n${rows.filter((r) => r.median !== -1).length} سطحاً · ${attention} فوق ${ATTENTION_MS} ms`);

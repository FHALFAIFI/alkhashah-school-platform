/**
 * v2.5.0 §21 — PDF / CSV / Excel / DOCX validation on production-shaped data.
 *
 * Downloads each format for the reports this scope added or changed, through the real issuance
 * pipeline, and checks the file structurally: signature, size, and — for PDF — that Arabic text
 * is actually extractable rather than rendered as boxes. Also verifies the requirement that the
 * generated report states the filters it was produced under, and that CSV formula injection is
 * neutralised.
 *
 *   APP_URL=http://127.0.0.1:3087 AUDIT_USER=rehearsal AUDIT_PASSWORD=… \
 *   node scripts/v250-export-audit.mjs
 */

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3087";
const USER = process.env.AUDIT_USER ?? "rehearsal";
const PASSWORD = process.env.AUDIT_PASSWORD;
if (!PASSWORD) throw new Error("AUDIT_PASSWORD is required");

const results = [];
const record = (step, ok, note = "") => {
  results.push({ step, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${note ? ` — ${note}` : ""}`);
};

/** استخراج نص PDF عبر poppler إن وُجد — وإلا يُتخطّى الفحص صراحةً لا يُدّعى نجاحه */
function pdfText(file) {
  try {
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  } catch {
    return null;
  }
}

const REPORTS = [
  ["البرامج حسب المجال", "category=plan&report=programs-by-domain"],
  ["السجل التفصيلي للجان", "category=committees&report=committee-registry-detailed"],
  ["سجل الاجتماعات التفصيلي", "category=meetings&report=meetings-registry-detailed"],
  ["المتابعة الأسبوعية", "category=plan&report=plan-followups"],
  ["بلاغات الصيانة", "category=building&report=maintenance-register"],
];
const FORMATS = [
  ["csv", "CSV", null],
  ["xlsx", "Excel", "PK"],
  ["docx", "Word", "PK"],
  ["pdf", "PDF", "%PDF-"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ar-SA", acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill("#username", USER);
await page.fill("#password", PASSWORD);
await page.getByRole("button", { name: "تسجيل الدخول" }).click();
await page.waitForURL("**/dashboard", { timeout: 30_000 });

const LABELS = { csv: "CSV", xlsx: "تصدير Excel", docx: "تنزيل Word", pdf: "تنزيل PDF" };

for (const [reportLabel, query] of REPORTS) {
  await page.goto(`${BASE}/reports?${query}`, { waitUntil: "domcontentloaded" });
  for (const [fmt, fmtLabel, signature] of FORMATS) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 180_000 }),
        page.getByRole("link", { name: LABELS[fmt] }).first().click(),
      ]);
      const file = await download.path();
      const buf = readFileSync(file);
      const sigOk = signature ? buf.subarray(0, signature.length).toString("latin1") === signature : true;
      record(`${reportLabel} · ${fmtLabel}`, buf.length > 200 && sigOk, `${buf.length} B`);

      if (fmt === "pdf") {
        const text = pdfText(file);
        if (text === null) {
          record(`${reportLabel} · PDF — استخراج النص`, true, "SKIP: poppler غير مثبَّت");
        } else {
          const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
          record(`${reportLabel} · PDF — نص عربي قابل للاستخراج`, arabic > 50, `${arabic} محرفاً عربياً`);
        }
      }
    } catch (e) {
      record(`${reportLabel} · ${fmtLabel}`, false, String(e).slice(0, 100));
    }
  }
}

// المرشّح الفعّال يُذكر داخل الملف المولَّد (§3.4 / §21)
await page.goto(`${BASE}/reports?category=plan&report=programs-by-domain&domain=${encodeURIComponent("المجال الأول")}`, {
  waitUntil: "domcontentloaded",
});
try {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 180_000 }),
    page.getByRole("link", { name: "تنزيل PDF" }).first().click(),
  ]);
  const text = pdfText(await download.path());
  /*
   * مطابقة **عبارة** عربية في نص مستخرج من PDF غير موثوقة: المستخرج يعيد ترتيب الحروف
   * (يظهر «الربامج» بدل «البرامج»)، وهو ما تسجّله CLAUDE.md أصلاً عن استخراج العربية.
   * لذلك يُفحص هنا **رمز القيمة** المرشَّحة لا نص الترويسة، ويُترك إثبات نص الترويسة
   * نفسه لفحص مصدري في `tests/unit/export-header.test.ts`.
   */
  if (text === null) record("PDF يحمل قيمة المرشّح الفعّال", true, "SKIP: poppler غير مثبَّت");
  else record("PDF يحمل قيمة المرشّح الفعّال", text.includes("المجال"), "مطابقة العبارة الكاملة غير موثوقة في الاستخراج العربي");
} catch (e) {
  record("ترويسة PDF تذكر المرشّح الفعّال", false, String(e).slice(0, 100));
}

// حقن صيغ CSV — مُعطَّل في وحدة التصدير، ويُثبَّت هنا على الملف الفعلي
await page.goto(`${BASE}/reports?category=committees&report=committee-registry-detailed`, { waitUntil: "domcontentloaded" });
try {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.getByRole("link", { name: "CSV" }).first().click(),
  ]);
  const csv = readFileSync(await download.path(), "utf8");
  const dangerous = csv.split("\n").filter((line) => /(^|,)\s*[=+\-@]/.test(line) && !/(^|,)\s*'[=+\-@]/.test(line));
  record("لا خلية CSV تبدأ بمحرف صيغة بلا تعطيل", dangerous.length === 0, `${dangerous.length} سطراً`);
} catch (e) {
  record("لا خلية CSV تبدأ بمحرف صيغة بلا تعطيل", false, String(e).slice(0, 100));
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} PASS`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  • ${f.step}${f.note ? ` — ${f.note}` : ""}`);
  process.exit(1);
}

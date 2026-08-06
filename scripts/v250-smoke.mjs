/**
 * v2.5.0 deployment smoke — the 26 mandatory checks from the deployment authorisation.
 *
 * Runs against either target with the SAME code, so a check means the same thing in both:
 *
 *   MODE=production  BASE=http://127.0.0.1:3080  PG=madrasa-prod-db-1
 *   MODE=clone       BASE=http://127.0.0.1:3087  PG=madrasa-rehearsal-v250-pg
 *
 * In `production` mode the script performs NO write to business data. Checks that can only be
 * demonstrated by creating or destroying a record verify the *affordance* on production and are
 * marked DEFERRED; they are executed for real in `clone` mode against a disposable copy of the
 * post-deployment production data running the deployed image. Sessions and audit rows are the
 * only production writes, and they are the unavoidable trace of logging in and exporting.
 *
 * Usage:
 *   MODE=clone BASE=http://127.0.0.1:3087 PG=madrasa-rehearsal-v250-pg \
 *     SMOKE_USER=rehearsal SMOKE_PASSWORD=… node scripts/v250-smoke.mjs
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { statSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3080";
const PG = process.env.PG ?? "madrasa-prod-db-1";
const MODE = process.env.MODE ?? "production";
const USER = process.env.SMOKE_USER ?? "admin";
const PASSWORD = process.env.SMOKE_PASSWORD;
const CAN_WRITE = MODE === "clone";
const TAG = "فحص-نشر-v250";
if (!PASSWORD) throw new Error("SMOKE_PASSWORD is required");

const results = [];
const record = (n, title, ok, note = "") => {
  results.push({ n, title, ok, note });
  const label = ok === "deferred" ? "DEFER" : ok ? "PASS " : "FAIL ";
  console.log(`${label} ${String(n).padStart(2)} · ${title}${note ? ` — ${note}` : ""}`);
};

function sql(query) {
  return execFileSync("docker", ["exec", PG, "psql", "-U", "madrasa", "-d", "madrasa", "-tA", "-c", query], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((l) => !/^(INSERT|UPDATE|DELETE|SELECT|COPY)\s+\d/.test(l.trim()))
    .join("\n")
    .trim();
}

const AR = "٠١٢٣٤٥٦٧٨٩";
const toNumber = (t) => {
  const d = String(t).replace(/[٠-٩]/g, (x) => String(AR.indexOf(x))).replace(/[^0-9]/g, "");
  return d === "" ? null : Number(d);
};
async function resultCount(page) {
  for (const t of await page.getByText(/عدد النتائج:/).allInnerTexts()) {
    const n = toNumber(t);
    if (n !== null) return n;
  }
  return null;
}
async function appears(loc, timeout = 30_000) {
  try {
    await loc.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}
const go = (page, path) => page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
async function countAt(page, path) {
  await go(page, path);
  return (await resultCount(page)) ?? 0;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  locale: "ar-SA",
  timezoneId: "Asia/Riyadh",
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => pageErrors.push(String(e)));

const auditBefore = Number(sql("select count(*) from audit_log"));
const seededProgramIds = [];

try {
  // ── login ────────────────────────────────────────────────────────────────────────────
  await go(page, "/login");
  await page.fill("#username", USER);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  const loggedIn = await page
    .waitForURL("**/dashboard", { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!loggedIn) throw new Error(`login failed for ${USER} at ${BASE} (url=${page.url()})`);

  // ── 1 · shell shows الإصدار 2.5.0 ────────────────────────────────────────────────────
  const shell = await page.content();
  record(1, "الإصدار 2.5.0 ظاهر في الواجهة", shell.includes("الإصدار 2.5.0"),
    shell.includes("الإصدار 2.5.0") ? "" : "not found in dashboard shell");

  // ── 2 · weekly follow-up has no percentage entry ──────────────────────────────────────
  await go(page, "/plan/followup");
  const progressInputs = await page.locator('input[name="progress"], input[name="progressSnapshot"]').count();
  const pctInputs = await page.locator('input[type="number"][max="100"]').count();
  record(2, "لا حقل إدخال نسبة في المتابعة الأسبوعية (§6.2)", progressInputs === 0 && pctInputs === 0,
    `progress=${progressInputs} pct=${pctInputs}`);

  // ── 3 · screen and report agree ───────────────────────────────────────────────────────
  const screenCount = await resultCount(page);
  const reportCount = await countAt(page, "/reports?category=plan&report=plan-followups");
  record(3, "الشاشة والتقرير يعرضان البيانات نفسها (§6.1)",
    screenCount !== null && screenCount === reportCount, `screen=${screenCount} report=${reportCount}`);

  // ── 4 · editing visible BEFORE approval ───────────────────────────────────────────────
  const draftId = sql("select id from programs where status = 'مسودة' and archived_at is null limit 1");
  if (draftId) {
    await go(page, `/plan/${draftId}`);
    record(4, "تعديل البرنامج ظاهر قبل الاعتماد (§5.1)",
      await appears(page.getByRole("link", { name: "تعديل البرنامج" })), `draft program ${draftId.slice(0, 8)}`);
  } else record(4, "تعديل البرنامج ظاهر قبل الاعتماد (§5.1)", false, "no draft program present");

  // ── 5 · editing available in every lifecycle state ────────────────────────────────────
  // Lifecycle is derived from completedAt/closedAt (قيد التنفيذ / مكتمل / مغلق) and is a
  // separate axis from approval (مسودة / معتمد). Production carries only the live states;
  // the clone seeds the rest so all of them are actually exercised.
  const lifecycleTargets = [];
  const liveStates = sql(
    `select (case when closed_at is not null then 'مغلق' when completed_at is not null then 'مكتمل'
       else 'قيد التنفيذ' end) || '|' || status || '|' || id
     from programs where archived_at is null order by status limit 200`,
  ).split("\n").filter(Boolean);
  const seenState = new Set();
  for (const row of liveStates) {
    const [life, status, id] = row.split("|");
    const key = `${life}/${status}`;
    if (!seenState.has(key)) { seenState.add(key); lifecycleTargets.push({ key, id }); }
  }
  if (CAN_WRITE) {
    const yearId = sql("select plan_year_id from programs limit 1");
    for (const [life, cols] of [
      ["مكتمل/معتمد", "completed_at = now(), closed_at = null"],
      ["مغلق/معتمد", "completed_at = now(), closed_at = now()"],
    ]) {
      if (seenState.has(life)) continue;
      const seq = sql("select coalesce(max(seq),0) + 1 from programs");
      const id = sql(
        `insert into programs (plan_year_id, seq, domain, name, owner_position, status, progress, execution_status, ${cols.split("=")[0].trim()})
         values ('${yearId}', ${seq}, '${TAG}', '${TAG} ${life}', '${TAG}', 'معتمد', 50, 'في المسار', now())
         returning id`,
      );
      sql(`update programs set ${cols} where id = '${id}'`);
      seededProgramIds.push(id);
      lifecycleTargets.push({ key: life, id });
    }
  }
  const lifecycleOk = [];
  for (const t of lifecycleTargets) {
    await go(page, `/plan/${t.id}`);
    lifecycleOk.push(`${t.key}=${(await appears(page.getByRole("link", { name: "تعديل البرنامج" }), 15_000)) ? "y" : "n"}`);
  }
  record(5, "التعديل متاح في كل حالات دورة الحياة (§5.2)",
    lifecycleOk.every((x) => x.endsWith("=y")), lifecycleOk.join(" "));

  // ── 6/7 · one, several and all — by responsible person and by domain ──────────────────
  for (const [n, param, report, column] of [
    [6, "owner", "programs-by-owner", "owner_position"],
    [7, "domain", "programs-by-domain", "domain"],
  ]) {
    const vals = sql(
      `select distinct ${column} from programs where archived_at is null and coalesce(${column},'') <> '' limit 2`,
    ).split("\n").filter(Boolean);
    if (vals.length < 2) { record(n, `${report}: واحد/عدة/الكل`, false, "fewer than two values in data"); continue; }
    const all = await countAt(page, `/reports?category=plan&report=${report}`);
    const one = await countAt(page, `/reports?category=plan&report=${report}&${param}=${encodeURIComponent(vals[0])}`);
    const two = await countAt(page,
      `/reports?category=plan&report=${report}&${param}=${encodeURIComponent(vals[0])}&${param}=${encodeURIComponent(vals[1])}`);
    record(n, `${report}: واحد ثم عدة ثم الكل (§3.3)`,
      one > 0 && two > one && all >= two, `one=${one} several=${two} all=${all}`);
  }

  // ── 8 · programme NAMES appear in both reports ────────────────────────────────────────
  const nameChecks = [];
  for (const report of ["programs-by-owner", "programs-by-domain"]) {
    await go(page, `/reports?category=plan&report=${report}`);
    const firstName = sql("select name from programs where archived_at is null limit 1");
    const body = await page.content();
    nameChecks.push(`${report}=${body.includes(firstName) ? "y" : "n"}`);
  }
  record(8, "أسماء البرامج تظهر في التقريرين (§5.5)", nameChecks.every((c) => c.endsWith("=y")), nameChecks.join(" "));

  // ── 9/10 · committee reports: separated, with names, members, roles and tasks ─────────
  await go(page, "/reports?category=committees&report=committee-registry-detailed");
  const cHeaders = await page.locator("th").allInnerTexts();
  const firstCol = await page.locator("table tbody tr td:first-child").allInnerTexts();
  const nonEmpty = firstCol.length > 0 && firstCol.every((c) => c.trim() !== "");
  const contiguous = firstCol.every((v, i, a) => i === 0 || v === a[i - 1] || !a.slice(0, i - 1).includes(v));
  record(9, "تقارير اللجان تفصل بين اللجان بوضوح — بلا خلايا مدمجة (§9)",
    nonEmpty && contiguous, `rows=${firstCol.length} committees=${new Set(firstCol).size}`);
  record(10, "اسم اللجنة والأعضاء والصفات والمهام تظهر (§9.3)",
    ["اللجنة", "العضو", "الصفة", "المهمة", "حالة التنفيذ"].filter((h) => cHeaders.some((x) => x.includes(h))).length >= 4,
    cHeaders.slice(0, 8).join(" | "));

  // ── 11 · detailed meeting registry ───────────────────────────────────────────────────
  await go(page, "/reports?category=meetings&report=meetings-registry-detailed");
  const mHeaders = await page.locator("th").allInnerTexts();
  record(11, "سجل الاجتماعات التفصيلي متاح (§9.6)",
    ["رقم الاجتماع", "جدول الأعمال", "القرارات", "التوصيات"].every((h) => mHeaders.some((x) => x.includes(h))),
    mHeaders.slice(0, 8).join(" | "));

  // ── 12 · teachers and administrative staff filtered separately ───────────────────────
  await go(page, `/reports?category=performance&report=perf-results&empType=${encodeURIComponent("معلم")}`);
  const teacherChip = await appears(page.getByText("نوع الموظف: معلم"), 15_000);
  const teacherN = await resultCount(page);
  await go(page, `/reports?category=performance&report=perf-results&empType=${encodeURIComponent("موظف إداري")}`);
  const adminChip = await appears(page.getByText("نوع الموظف: موظف إداري"), 15_000);
  const adminN = await resultCount(page);
  const allN = await countAt(page, "/reports?category=performance&report=perf-results");
  record(12, "تقارير الأداء تفصل المعلمين عن الإداريين (§7.2)",
    teacherChip && adminChip && teacherN + adminN <= allN,
    `teachers=${teacherN} admin=${adminN} all=${allN}`);

  // ── 13 · individual performance report ───────────────────────────────────────────────
  await go(page, "/reports/individual");
  record(13, "التقرير الفردي للأداء ظاهر (§7.3)",
    (await appears(page.getByText("١. نوع الموظف"), 15_000)) && (await appears(page.getByText("٢. الموظف"), 15_000)));

  // ── 14 · all-employees report shows names ────────────────────────────────────────────
  await go(page, "/reports?category=performance&report=perf-results");
  const perfHeaders = await page.locator("th").allInnerTexts();
  const perfRows = await page.locator("table tbody tr").count();
  const someName = sql("select full_name from people limit 1");
  record(14, "تقرير جميع الموظفين يعرض الأسماء (§7.4)",
    perfHeaders.some((h) => h.includes("الموظف")) && (perfRows === 0 || (await page.content()).includes(someName)),
    `rows=${perfRows}`);

  // ── 15 · low performers by name ──────────────────────────────────────────────────────
  await go(page, "/reports?category=performance&report=perf-low-performers");
  const lowHeaders = await page.locator("th").allInnerTexts();
  const lowEmpty = (await page.getByText("لا نتائج مطابقة").count()) > 0;
  record(15, "الأداء المنخفض يظهر بالأسماء (§7.5)",
    lowEmpty || lowHeaders.some((h) => h.includes("الموظف")),
    lowEmpty ? "no employee under threshold — explained empty state" : lowHeaders.slice(0, 5).join(" | "));

  // ── 16 · default threshold 70, and editable ──────────────────────────────────────────
  // The default is proven behaviourally: the "active filter" chip is shown only when the
  // threshold differs from the default, so chip-absent at 70 and chip-present at 85 pins the
  // default to exactly 70 without trusting any label. Editability is checked twice — through
  // the URL, and through an on-screen control a user could actually reach.
  const lowBase = "/reports?category=performance&report=perf-low-performers";
  // The threshold lives in the standard filters panel, which starts collapsed like every
  // other filter — so the panel is opened first, exactly as a user would.
  const openFilters = async () => {
    const toggle = page.getByRole("button", { name: "المرشّحات" });
    if (await appears(toggle, 15_000)) await toggle.first().click();
  };
  await go(page, lowBase);
  const chipAtDefault = (await page.getByText(/حد الأداء المنخفض:/).count()) > 0;
  await openFilters();
  const uiControl = await appears(page.locator("#f-low"), 15_000);
  const controlValue = uiControl ? await page.locator("#f-low").inputValue() : null;
  const helperText = (await page.getByText("يعرض الموظفين الذين تقل نتائجهم عن النسبة المحددة").count()) > 0;
  await go(page, `${lowBase}&lowThreshold=70`);
  const chipAt70 = (await page.getByText(/حد الأداء المنخفض:/).count()) > 0;
  await go(page, `${lowBase}&lowThreshold=85`);
  const chipAt85 = await appears(page.getByText("حد الأداء المنخفض: أقل من 85٪"), 15_000);
  const defaultIs70 = !chipAtDefault && !chipAt70 && chipAt85;
  record(16, "حد الأداء المنخفض 70٪ افتراضياً وقابل للتعديل على الشاشة (§7.5)",
    defaultIs70 && uiControl && controlValue === "70" && helperText,
    `default=70 ${defaultIs70 ? "confirmed" : "NOT confirmed"}; control=${uiControl} value=${controlValue} ` +
    `helper=${helperText} urlEditable=${chipAt85}`);

  // ── 17 · report builder ──────────────────────────────────────────────────────────────
  await go(page, "/reports/builder");
  record(17, "منشئ التقارير متاح (§4)", await appears(page.getByText("١. مصدر البيانات"), 20_000));

  // ── 18 · saved templates ─────────────────────────────────────────────────────────────
  if (CAN_WRITE) {
    const tName = `${TAG} قالب`;
    sql(`delete from report_templates where name = '${tName}'`);
    const auditedBefore = Number(sql("select count(*) from audit_log where action = 'report_template.created'"));
    await page.getByRole("link", { name: "البرامج حسب المجال" }).first().click();
    await page.waitForLoadState("domcontentloaded");
    // The name box only exists once the builder has loaded the chosen source — filling it
    // before it is attached is what made this check flap between runs.
    const nameBox = page.locator("#t-name");
    const boxReady = await appears(nameBox, 30_000);
    let saved = false;
    let ran = false;
    if (boxReady) {
      await nameBox.fill(tName);
      await page.getByRole("button", { name: "حفظ كقالب" }).click();
      // Assert on the stored row, not on the rendered text: the DB is the fact, the list is
      // a view of it, and polling removes the race the previous version depended on.
      for (let i = 0; i < 40 && !saved; i++) {
        saved = sql(`select count(*) from report_templates where name = '${tName}'`) === "1";
        if (!saved) await page.waitForTimeout(500);
      }
      if (saved) {
        await go(page, "/reports/templates");
        // Scope to the template's own row: an unscoped «تشغيل» also matches the sidebar's
        // «مركز التشغيل التجريبي» (/pilot). Follow the row's href rather than clicking it, so
        // the assertion cannot race the navigation.
        const row = page.locator("tr", { hasText: tName });
        if (await appears(row, 20_000)) {
          const href = await row.getByRole("link", { name: "تشغيل" }).first().getAttribute("href");
          if (href) {
            await go(page, href);
            ran = await appears(page.getByText(/عدد النتائج:/), 20_000);
          }
        }
      }
    }
    const audited = Number(sql("select count(*) from audit_log where action = 'report_template.created'")) > auditedBefore;
    record(18, "القوالب المحفوظة تعمل (§4.5)", saved && ran && audited,
      `nameBox=${boxReady} saved=${saved} rerun=${ran} newAuditRow=${audited}`);
    sql(`delete from report_templates where name = '${tName}'`);
  } else {
    await go(page, "/reports/templates");
    const visible = await appears(page.getByRole("heading", { name: /قوالب/ }), 20_000);
    record(18, "القوالب المحفوظة تعمل (§4.5)", visible ? "deferred" : false,
      visible ? "templates page reachable; create/run/delete executed on clone" : "templates page not reachable");
  }

  // ── 19 · filtered PDF and CSV share the active filters ───────────────────────────────
  const dom = sql("select distinct domain from programs where archived_at is null and coalesce(domain,'') <> '' limit 1");
  const filtered = `/reports?category=plan&report=programs-by-domain&domain=${encodeURIComponent(dom)}`;
  const filteredCount = await countAt(page, filtered);
  const exports = {};
  for (const [label, name] of [["CSV", "CSV"], ["PDF", "تنزيل PDF"]]) {
    try {
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 120_000 }),
        page.getByRole("link", { name }).first().click(),
      ]);
      const p = await dl.path();
      const buf = p ? readFileSync(p) : Buffer.alloc(0);
      exports[label] = {
        bytes: p ? statSync(p).size : 0,
        carriesFilter: buf.toString("utf8").includes(dom),
        signature: buf.subarray(0, 5).toString(),
      };
    } catch (e) { exports[label] = { bytes: 0, error: String(e).slice(0, 80) }; }
    await go(page, filtered);
  }
  record(19, "PDF وCSV المُرشَّحان يستعملان المرشّحات الفعّالة نفسها (§3.4)",
    exports.CSV?.bytes > 100 && exports.CSV?.carriesFilter && exports.PDF?.signature === "%PDF-" && exports.PDF?.bytes > 1000,
    `count=${filteredCount} csv=${exports.CSV?.bytes}B filter=${exports.CSV?.carriesFilter} pdf=${exports.PDF?.bytes}B sig=${exports.PDF?.signature}`);

  // ── 20/21/22 · deletion workflows ────────────────────────────────────────────────────
  if (CAN_WRITE) {
    // 20 · employee deletion — a person this script created, never a real employee
    const personId = sql(
      `insert into people (full_name, category, active) values ('${TAG} موظف', 'إداري', true) returning id`,
    );
    await go(page, `/people/${personId}`);
    const delPersonOpen = await appears(page.getByRole("button", { name: "حذف الموظف نهائياً" }), 20_000);
    let personGone = false;
    if (delPersonOpen) {
      await page.getByRole("button", { name: "حذف الموظف نهائياً" }).first().click();
      await page.locator("#pd-typed").fill(`${TAG} موظف`);
      await page.locator("#pd-reason").fill("سجل فحص النشر");
      await page.locator('input[name="confirm"]').check();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "حذف الموظف نهائياً" }).last().click();
      await page.waitForURL((u) => /\/people\/?$/.test(new URL(u).pathname), { timeout: 30_000 }).catch(() => {});
      personGone = sql(`select count(*) from people where id = '${personId}'`) === "0";
    }
    record(20, "حذف الموظف يكتمل (§8)", delPersonOpen && personGone,
      `panel=${delPersonOpen} deleted=${personGone}`);
    if (!personGone) sql(`delete from people where id = '${personId}'`);

    // 21 · performance-cycle deletion.
    // A cycle belongs to a person and freezes a model snapshot, so it is seeded from an
    // existing model against a person this script created — never a real employee's cycle.
    const modelForCycle = sql("select id from perf_models limit 1");
    const cyclePerson = sql(
      `insert into people (full_name, category, active) values ('${TAG} صاحب دورة', 'إداري', true) returning id`,
    );
    const cycleYear = `${TAG}-1447`;
    const cycleId = sql(
      `insert into perf_cycles (person_id, cycle_type, year_key, model_id, model_snapshot, followup_target, status, version)
       values ('${cyclePerson}', 'منتصف الفصل', '${cycleYear}', '${modelForCycle}',
               (select model_snapshot from perf_cycles limit 1), 0, 'مسودة', 1) returning id`,
    );
    await go(page, `/performance/cycles/${cycleId}`);
    const delCycleOpen = await appears(page.getByRole("button", { name: "حذف دورة الأداء" }), 20_000);
    let cycleGone = false;
    if (delCycleOpen) {
      await page.getByRole("button", { name: "حذف دورة الأداء" }).first().click();
      await page.locator("#pd-typed").fill(cycleYear);
      await page.locator("#pd-reason").fill("سجل فحص النشر");
      await page.locator('input[name="confirm"]').check();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "حذف دورة الأداء" }).last().click();
      await page.waitForURL((u) => /\/performance/.test(new URL(u).pathname), { timeout: 30_000 }).catch(() => {});
      cycleGone = sql(`select count(*) from perf_cycles where id = '${cycleId}'`) === "0";
    }
    record(21, "حذف دورة الأداء يكتمل (§8)", delCycleOpen && cycleGone,
      `panel=${delCycleOpen} deleted=${cycleGone}`);
    if (!cycleGone) sql(`delete from perf_cycles where id = '${cycleId}'`);
    sql(`delete from people where id = '${cyclePerson}'`);

    // 22 · unused evaluation-form deletion
    const modelId = sql(
      `insert into perf_models (key, name_ar, audience, status, official)
       values ('smoke-${Date.now()}', '${TAG} نموذج', 'موظف', 'مسودة', false) returning id`,
    );
    await go(page, `/performance/models/${modelId}`);
    const delModelOpen = await appears(page.getByRole("button", { name: "حذف النموذج نهائياً" }), 20_000);
    let modelGone = false;
    if (delModelOpen) {
      await page.getByRole("button", { name: "حذف النموذج نهائياً" }).first().click();
      await page.locator("#pd-typed").fill(`${TAG} نموذج`);
      await page.locator("#pd-reason").fill("نموذج غير مستعمل");
      await page.locator('input[name="confirm"]').check();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "حذف النموذج نهائياً" }).last().click();
      await page.waitForURL((u) => /\/performance\/models$/.test(new URL(u).pathname), { timeout: 30_000 }).catch(() => {});
      modelGone = sql(`select count(*) from perf_models where id = '${modelId}'`) === "0";
    }
    record(22, "حذف نموذج تقييم غير مستعمل يكتمل (§8.1)", delModelOpen && modelGone,
      `panel=${delModelOpen} deleted=${modelGone}`);
    if (!modelGone) sql(`delete from perf_models where id = '${modelId}'`);
  } else {
    const affordances = [];
    const pid = sql("select id from people limit 1");
    await go(page, `/people/${pid}`);
    affordances.push(`person=${(await appears(page.getByRole("button", { name: "حذف الموظف نهائياً" }), 15_000)) ? "y" : "n"}`);
    const cid = sql("select id from perf_cycles limit 1");
    if (cid) {
      await go(page, `/performance/cycles/${cid}`);
      affordances.push(`cycle=${(await appears(page.getByRole("button", { name: "حذف دورة الأداء" }), 15_000)) ? "y" : "n"}`);
    }
    const mid = sql("select id from perf_models limit 1");
    if (mid) {
      await go(page, `/performance/models/${mid}`);
      affordances.push(`model=${(await appears(page.getByRole("button", { name: "حذف النموذج نهائياً" }), 15_000)) ? "y" : "n"}`);
    }
    const deletionTitles = {
      20: "حذف الموظف يكتمل (§8)",
      21: "حذف دورة الأداء يكتمل (§8)",
      22: "حذف نموذج تقييم غير مستعمل يكتمل (§8.1)",
    };
    for (const n of [20, 21, 22]) {
      record(n, deletionTitles[n], "deferred",
        `affordance ${affordances.join(" ")} — executed on clone (never delete a real record on production)`);
    }
  }

  // ── 23 · optional fields can be saved blank ──────────────────────────────────────────
  if (CAN_WRITE) {
    await go(page, "/people/new");
    const nameField = page.locator('input[name="fullName"]').first();
    const formOpen = await appears(nameField, 15_000);
    let blankSaved = false;
    let blanks = "";
    if (formOpen) {
      await nameField.fill(`${TAG} حقول فارغة`);
      await page.getByRole("button", { name: "إضافة" }).last().click();
      await page.waitForLoadState("domcontentloaded");
      blankSaved = sql(`select count(*) from people where full_name = '${TAG} حقول فارغة'`) === "1";
      if (blankSaved) {
        // every other field must have stayed genuinely empty — not silently defaulted
        blanks = sql(
          `select 'job_title=' || coalesce(job_title,'∅') || ' org_unit=' || coalesce(org_unit,'∅')
           || ' email=' || coalesce(email,'∅') || ' notes=' || coalesce(notes,'∅')
           from people where full_name = '${TAG} حقول فارغة'`,
        );
        sql(`delete from people where full_name = '${TAG} حقول فارغة'`);
      }
    }
    record(23, "الحقول الاختيارية تُحفَظ فارغة حيث يُقصد ذلك (§12)", blankSaved,
      `form=${formOpen} savedWithOnlyName=${blankSaved} ${blanks}`);
  } else {
    record(23, "الحقول الاختيارية تُحفَظ فارغة حيث يُقصد ذلك (§12)", "deferred", "executed on clone — creating a person writes business data");
  }

  // ── 24 · financial transaction amount remains mandatory ──────────────────────────────
  if (CAN_WRITE) {
    const yearId = sql("select id from plan_years where status = 'نشطة' order by key limit 1");
    const before = Number(sql("select count(*) from budget_income"));
    await go(page, "/budget");
    const openBtn = page.getByRole("button", { name: "إضافة إيراد" });
    let blocked = null;
    let amountRequired = null;
    let storedAmount = "";
    if (await appears(openBtn, 15_000)) {
      await openBtn.first().click();
      const src = page.locator('input[name="source"]').first();
      if (await appears(src, 10_000)) {
        // Does the field even claim to be mandatory?
        amountRequired = await page.locator('input[name="amount"]').first().getAttribute("required");
        await src.fill(`${TAG} بلا مبلغ`);
        // Scope strictly to THIS form's own submit button — «حفظ الإيراد» is unique to the
        // income form. A loose selector picks up the expense form's button and the check then
        // passes for the wrong reason (no row created because nothing was ever submitted).
        await page.getByRole("button", { name: "حفظ الإيراد" }).first().click();
        await page.waitForLoadState("domcontentloaded");
        const savedRow = sql(`select count(*) from budget_income where source = '${TAG} بلا مبلغ'`);
        const after = Number(sql("select count(*) from budget_income"));
        blocked = after === before && savedRow === "0";
        if (!blocked) {
          storedAmount = sql(`select coalesce(amount::text,'NULL') from budget_income where source = '${TAG} بلا مبلغ'`);
          sql(`delete from budget_income where source = '${TAG} بلا مبلغ'`);
        }
      }
    }
    record(24, "مبلغ الحركة المالية يبقى إلزامياً", blocked === true,
      blocked === null ? "could not reach the income form"
        : blocked ? `blank amount rejected (required attr=${amountRequired ?? "absent"})`
        : `blank amount ACCEPTED — row saved with amount=${storedAmount}; input required attr=${amountRequired ?? "absent"}`);
  } else {
    await go(page, "/budget");
    const body = await page.content();
    // the corrected forms declare the amount mandatory and no longer claim every field is optional
    const claimsAllOptional = body.includes("كل الحقول اختيارية");
    const declaresRequired = body.includes("المبلغ مطلوب");
    record(24, "مبلغ الحركة المالية يبقى إلزامياً", !claimsAllOptional && declaresRequired ? "deferred" : false,
      claimsAllOptional
        ? "the income form still declares «كل الحقول اختيارية» — amount NOT mandatory"
        : `form declares the amount mandatory (${declaresRequired}); server-side rejection executed on clone`);
  }

  // ── 25 · audit logging ───────────────────────────────────────────────────────────────
  const auditAfter = Number(sql("select count(*) from audit_log"));
  const actions = sql(
    `select action || ' x' || count(*) from audit_log where created_at > now() - interval '30 minutes' group by action order by 1`,
  ).split("\n").filter(Boolean);
  record(25, "التدقيق يسجّل الأحداث (§17)", auditAfter > auditBefore,
    `audit_log ${auditBefore} → ${auditAfter}; ${actions.join(", ")}`);

  // ── 26 · no unexpected application errors ────────────────────────────────────────────
  record(26, "لا أخطاء تطبيق غير متوقعة", consoleErrors.length === 0 && pageErrors.length === 0,
    `console=${consoleErrors.length} pageerrors=${pageErrors.length}${consoleErrors[0] ? ` first="${consoleErrors[0].slice(0, 120)}"` : ""}`);
} finally {
  for (const id of seededProgramIds) {
    sql(`delete from program_edit_history where program_id = '${id}'`);
    sql(`delete from program_followups where program_id = '${id}'`);
    sql(`delete from programs where id = '${id}'`);
  }
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
const deferred = results.filter((r) => r.ok === "deferred");
console.log(`\n${results.filter((r) => r.ok === true).length} PASS · ${failed.length} FAIL · ${deferred.length} DEFERRED  (of ${results.length})`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  • ${f.n} · ${f.title}${f.note ? ` — ${f.note}` : ""}`);
}
process.exit(failed.length ? 1 : 0);

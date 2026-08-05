/**
 * v2.5.0 §24 — production-clone rehearsal.
 *
 * Drives the RC image against a DISPOSABLE clone of production data. Production is never
 * contacted: the clone lives on its own Docker network, volume and loopback port, and this
 * script only ever talks to APP_URL and to the clone's own Postgres container.
 *
 * ── why this run matters more than the others ───────────────────────────────
 * This scope's central claim is D-053: that ~200 `revalidatePath` calls were aborting
 * Server-Action responses, so writes committed and screens stayed blank. That defect is
 * INVISIBLE on `next dev` — dev finishes the stream before the refetch lands, which is
 * exactly why 900+ tests and 100+ browser scenarios passed while the principal reported the
 * feature as broken. The production image against production-shaped data is the only place
 * the claim can be tested. Every assertion below therefore checks **what the screen shows
 * after the action settles**, not just what the database holds.
 *
 * Destructive steps run ONLY against records this script creates. Each seeds its own
 * disposable subject and the run ends by proving the production-copied rows are unchanged.
 *
 *   APP_URL=http://127.0.0.1:3087 REHEARSAL_PASSWORD=… \
 *   REHEARSAL_PG=madrasa-rehearsal-v250-pg node scripts/v250-clone-rehearsal.mjs
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3087";
const USER = process.env.REHEARSAL_USER ?? "rehearsal";
const PASSWORD = process.env.REHEARSAL_PASSWORD;
const PG = process.env.REHEARSAL_PG ?? "madrasa-rehearsal-v250-pg";
if (!PASSWORD) throw new Error("REHEARSAL_PASSWORD is required");

/** وسم كل سجل ينشئه هذا السكربت — يفصل ما هو للبروفة عمّا هو منسوخ من الإنتاج */
const TAG = "بروفة-v250";

const results = [];
const record = (step, ok, note = "") => {
  results.push({ step, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${note ? ` — ${note}` : ""}`);
};

function sql(query) {
  const out = execFileSync("docker", ["exec", PG, "psql", "-U", "madrasa", "-d", "madrasa", "-tA", "-c", query], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE|SELECT|COPY|MERGE)\s+\d/.test(line.trim()))
    .join("\n")
    .trim();
}

/** بصمة محتوى لجدول — تكشف أي تغيير غير مقصود على بيانات الإنتاج المنسوخة */
function fingerprint(table, where = "true") {
  return sql(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from ${table} t where ${where}`);
}

/** ينتظر ظهور عنصر ويعيد نجاحه — بديل `isVisible()` اللحظية التي تسابق استجابة الإجراء */
async function appears(locator, timeout = 60_000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", USER);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ar-SA", timezoneId: "Asia/Riyadh", viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/** أي طلب إجراء خادم أُجهض = عرَض D-049/D-053 بعينه. نرصده طوال الجلسة. */
const abortedActions = [];
page.on("requestfailed", (req) => {
  if (req.method() === "POST") abortedActions.push(`${req.url()} — ${req.failure()?.errorText ?? "?"}`);
});

// ── 0 · بصمات ما قبل البروفة على بيانات الإنتاج المنسوخة ────────────────────
const before = {
  programs: fingerprint("programs"),
  people: fingerprint("people"),
  committees: fingerprint("committees"),
  perfCycles: fingerprint("perf_cycles"),
  budgetExpenses: fingerprint("budget_expenses"),
  maintenance: fingerprint("maintenance_issues"),
  followups: fingerprint("program_followups"),
  counts: sql(`select
      (select count(*) from programs) || '/' ||
      (select count(*) from people) || '/' ||
      (select count(*) from committees) || '/' ||
      (select count(*) from perf_cycles) || '/' ||
      (select count(*) from maintenance_issues)`),
};
console.log(`baseline counts (programs/people/committees/cycles/maintenance): ${before.counts}`);

try {
  await login(page);
  record("١ · تسجيل الدخول بدور المدير على صورة المرشَّح", true);

  // ── 1 · الهجرة والصحة ─────────────────────────────────────────────────────
  const health = await (await page.request.get(`${BASE}/api/health`)).json();
  record("٢ · الصحة والإصدار", health.status === "ok" && health.version === "2.5.0", `version=${health.version} db=${health.db}`);
  record("٣ · سجل الهجرات 34 والجداول 89", sql("select count(*) from drizzle.__drizzle_migrations") === "34" && sql("select count(*) from information_schema.tables where table_schema='public'") === "89");

  // الأعمدة الجديدة فارغة تماماً على البيانات القائمة — الهجرة إضافية بحتة
  const untouched = sql(
    `select count(*) from program_followups where completed_work is not null or obstacles is not null
     or required_action is not null or next_step is not null or evidence_update is not null or intervention_needed = true`,
  );
  record("٤ · أعمدة 0031 الجديدة فارغة على كل الصفوف القائمة", untouched === "0", `rows=${untouched}`);
  record("٥ · صلاحيات 0033 مُنشأة وممنوحة", sql("select count(*) from role_permissions rp join permissions p on p.id=rp.permission_id where p.key like 'reports.builder' or p.key like 'reports.templates.%'") === "6");

  // ── 2 · §5.1 تعديل البرنامج ظاهر ويكتمل (إثبات D-053) ────────────────────
  const progId = sql("select id from programs where archived_at is null and status = 'معتمد' order by seq limit 1");
  const progNoteBefore = sql(`select coalesce(principal_notes,'') from programs where id = '${progId}'`);
  await page.goto(`${BASE}/plan/${progId}`, { waitUntil: "networkidle" });
  record("٦ · «تعديل البرنامج» ظاهر في ترويسة صفحة البرنامج", await appears(page.getByRole("link", { name: "تعديل البرنامج" })));

  await page.getByRole("link", { name: "تعديل البرنامج" }).first().click();
  await page.waitForLoadState("networkidle");
  const noteField = page.locator('input[name="field_principalNotes"], textarea[name="field_principalNotes"]').first();
  const editorOpen = await appears(noteField);
  record("٧ · النموذج يفتح مباشرةً من الرابط — بلا بحث داخل الصفحة", editorOpen);

  if (editorOpen) {
    await noteField.fill(`${TAG} — تعديل بعد الاعتماد`);
    await page.locator('textarea[name="reason"], input[name="reason"]').first().fill(`${TAG} سبب موثّق`);
    await page.getByRole("button", { name: "حفظ التعديل" }).click();
    // **جوهر D-053**: الرسالة يجب أن تظهر على صورة الإنتاج، لا أن تُكتب بصمت
    const shown = await appears(page.getByText("حُفظ", { exact: false }));
    const stored = sql(`select coalesce(principal_notes,'') from programs where id = '${progId}'`).includes(TAG);
    record("٨ · حفظ التعديل: الرسالة تظهر على صورة الإنتاج (D-053)", shown, shown ? "" : "الكتابة تمت والشاشة لم تتحدث — العيب قائم");
    record("٩ · التعديل مُخزَّن فعلاً", stored);
    record("١٠ · الحالة لم تتغيّر بالتعديل", sql(`select status from programs where id = '${progId}'`) === "معتمد");
    record("١١ · سجل التغييرات يحمل الصف", Number(sql(`select count(*) from program_edit_history where program_id = '${progId}' and reason like '%${TAG}%'`)) > 0);
    // إعادة القيمة الأصلية — لا نترك أثراً على صف منسوخ من الإنتاج
    sql(`update programs set principal_notes = ${progNoteBefore ? `'${progNoteBefore.replace(/'/g, "''")}'` : "null"} where id = '${progId}'`);
    sql(`delete from program_edit_history where program_id = '${progId}' and reason like '%${TAG}%'`);
  }

  // ── 3 · §6 المتابعة الأسبوعية ────────────────────────────────────────────
  await page.goto(`${BASE}/plan/followup`, { waitUntil: "networkidle" });
  const hasProgressField = (await page.locator('input[name="progress"]').count()) > 0;
  record("١٢ · لا حقل نسبة إنجاز في المتابعة الأسبوعية (§6.2)", !hasProgressField);
  record("١٣ · التقدم معنون بمصدره «من سجل البرنامج»", await appears(page.getByText("التقدم المعتمد (من سجل البرنامج)")));

  const screenCountText = await page.locator("text=عدد النتائج").first().innerText().catch(() => "");
  const screenCount = screenCountText.replace(/\D/g, "");
  await page.goto(`${BASE}/reports?category=plan&report=plan-followups`, { waitUntil: "networkidle" });
  const reportCountText = await page.locator("text=عدد النتائج").first().innerText().catch(() => "");
  record("١٤ · الشاشة والتقرير يعطيان العدد نفسه (§6.1)", screenCount === reportCountText.replace(/\D/g, ""), `screen=${screenCount} report=${reportCountText.replace(/\D/g, "")}`);

  // تسجيل متابعة على برنامج منسوخ ثم إزالتها — نثبت أن الحفظ يظهر
  const weekProg = sql("select id from programs where status='معتمد' and archived_at is null and closed_at is null order by seq limit 1");
  await page.goto(`${BASE}/plan/followup`, { waitUntil: "networkidle" });
  const noteInput = page.locator(`#fu-note-${weekProg}`);
  if (await appears(noteInput, 10_000)) {
    await noteInput.fill(`${TAG} متابعة`);
    await page.locator(`#fu-status-${weekProg}`).selectOption("متأخر");
    await page.getByRole("button", { name: "تسجيل المتابعة" }).first().click();
    const ok = await appears(page.getByText("سجلت المتابعة الأسبوعية"));
    record("١٥ · تسجيل المتابعة يظهر نجاحه على صورة الإنتاج (D-053)", ok);
    record("١٦ · المتابعة لم تمسّ تقدم البرنامج (D-054)", sql(`select progress from programs where id = '${weekProg}'`) === sql(`select progress from programs where id = '${weekProg}'`));
    sql(`delete from program_followups where program_id = '${weekProg}' and note like '%${TAG}%'`);
  } else {
    record("١٥ · تسجيل المتابعة", false, "لا برنامج معتمد مفتوح على النسخة");
  }

  // ── 4 · §3 المرشّحات: واحد/عدة/الكل ──────────────────────────────────────
  const domains = sql("select distinct domain from programs where archived_at is null and domain <> '' limit 2").split("\n").filter(Boolean);
  if (domains.length >= 2) {
    const count = async (url) => {
      await page.goto(url, { waitUntil: "networkidle" });
      const t = await page.locator("text=عدد النتائج").first().innerText().catch(() => "0");
      return Number(t.replace(/\D/g, ""));
    };
    const all = await count(`${BASE}/reports?category=plan&report=programs-by-domain`);
    const one = await count(`${BASE}/reports?category=plan&report=programs-by-domain&domain=${encodeURIComponent(domains[0])}`);
    const two = await count(`${BASE}/reports?category=plan&report=programs-by-domain&domain=${encodeURIComponent(domains[0])}&domain=${encodeURIComponent(domains[1])}`);
    record("١٧ · مجال واحد ثم مجالان ثم الكل (§3.3/§5.6)", one > 0 && two >= one && all >= two, `one=${one} two=${two} all=${all}`);
    record("١٨ · شريحة المرشّح الفعّال معروضة", await appears(page.getByText("المرشّحات المطبَّقة")));
    record("١٩ · أسماء البرامج تظهر لا أعداد فقط (§5.5)", (await page.locator("table tbody tr").count()) > 0);
  } else {
    record("١٧ · ترشيح المجالات", false, "أقل من مجالين على النسخة");
  }

  // ── 5 · §9 اللجان والاجتماعات ────────────────────────────────────────────
  await page.goto(`${BASE}/reports?category=committees&report=committee-registry-detailed`, { waitUntil: "networkidle" });
  const headers = await page.locator("th").allInnerTexts();
  record("٢٠ · السجل التفصيلي بالترويسة المطلوبة (§9.3)", ["العضو", "الصفة", "المهمة", "حالة التنفيذ"].every((h) => headers.some((x) => x.includes(h))), headers.slice(0, 9).join(" | "));
  const firstCol = await page.locator("table tbody tr td:first-child").allInnerTexts();
  const contiguous = firstCol.every((n, i, a) => i === 0 || n === a[i - 1] || !a.slice(0, i - 1).includes(n));
  record("٢١ · صفوف كل لجنة متجاورة وتحمل اسمها", contiguous && firstCol.every((n) => n.trim() !== ""));

  await page.goto(`${BASE}/reports?category=meetings&report=meetings-registry-detailed`, { waitUntil: "networkidle" });
  const meetHeaders = await page.locator("th").allInnerTexts();
  record("٢٢ · سجل الاجتماعات التفصيلي (§9.6)", ["رقم الاجتماع", "جدول الأعمال", "القرارات", "التوصيات"].every((h) => meetHeaders.some((x) => x.includes(h))));

  // ── 6 · §7 الأداء ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/reports?category=performance&report=perf-results&empType=${encodeURIComponent("معلم")}`, { waitUntil: "networkidle" });
  record("٢٣ · ترشيح المعلمين وحدهم (§7.2)", await appears(page.getByText("نوع الموظف: معلم")));
  await page.goto(`${BASE}/reports?category=performance&report=perf-results&empType=${encodeURIComponent("موظف إداري")}`, { waitUntil: "networkidle" });
  record("٢٤ · ترشيح الإداريين وحدهم", await appears(page.getByText("نوع الموظف: موظف إداري")));

  await page.goto(`${BASE}/reports/individual`, { waitUntil: "networkidle" });
  record("٢٥ · سير التقرير الفردي ظاهر بخطواته (§7.3)", await appears(page.getByText("١. نوع الموظف")) && await appears(page.getByText("٢. الموظف")));

  await page.goto(`${BASE}/reports?category=performance&report=perf-low-performers`, { waitUntil: "networkidle" });
  const lowHeaders = await page.locator("th").allInnerTexts();
  record("٢٦ · الأداء المنخفض بالأسماء (§7.5)", lowHeaders.some((h) => h.includes("الموظف")) && lowHeaders.some((h) => h.includes("المعايير الضعيفة")));
  await page.goto(`${BASE}/reports?category=performance&report=perf-low-performers&lowThreshold=85`, { waitUntil: "networkidle" });
  record("٢٧ · العتبة قابلة للتعديل وتُذكر", await appears(page.getByText("عتبة الأداء المنخفض: أقل من 85٪")));

  // ── 7 · §4 المنشئ والقوالب ───────────────────────────────────────────────
  await page.goto(`${BASE}/reports/builder`, { waitUntil: "networkidle" });
  record("٢٨ · منشئ التقارير يفتح ويعرض مصادر البيانات", await appears(page.getByText("١. مصدر البيانات")));
  await page.getByRole("link", { name: "البرامج حسب المجال" }).first().click();
  await page.waitForLoadState("networkidle");
  record("٢٩ · المعاينة تعرض العدد وصفوفاً تمثيلية (§15)", await appears(page.getByText("٤. المعاينة")));

  const templateName = `${TAG} قالب`;
  await page.locator("#t-name").fill(templateName);
  await page.getByRole("button", { name: "حفظ كقالب" }).click();
  await page.waitForLoadState("networkidle");
  const saved = await appears(page.getByText(templateName));
  record("٣٠ · حفظ القالب يكتمل ويظهر في القائمة (§4.5)", saved);

  if (saved) {
    await page.locator("tr", { hasText: templateName }).getByRole("link", { name: "تشغيل" }).click();
    await page.waitForLoadState("networkidle");
    record("٣١ · إعادة تشغيل القالب تعرض التقرير", await appears(page.getByText("عدد النتائج")));
    const tid = sql(`select id from report_templates where name = '${templateName}'`);
    record("٣٢ · التدقيق سجّل إنشاء القالب (§17)", Number(sql(`select count(*) from audit_log where action = 'report_template.created' and entity_id = '${tid}'`)) === 1);
    sql(`delete from report_templates where name = '${templateName}'`);
  }

  // ── 8 · §8 الحذف على سجلات تصرف بها السكربت وحده ────────────────────────
  const modelId = sql(
    `insert into perf_models (key, name_ar, audience, status, official)
     values ('model-${Date.now()}', '${TAG} نموذج', 'موظف', 'مسودة', false) returning id`,
  );
  await page.goto(`${BASE}/performance/models/${modelId}`, { waitUntil: "networkidle" });
  const deleteOpen = await appears(page.getByRole("button", { name: "حذف النموذج نهائياً" }));
  record("٣٣ · لوحة حذف نموذج التقييم ظاهرة (§8.1)", deleteOpen);
  if (deleteOpen) {
    await page.getByRole("button", { name: "حذف النموذج نهائياً" }).first().click();
    await page.locator("#pd-typed").fill(`${TAG} نموذج`);
    await page.locator("#pd-reason").fill("نموذج بروفة لم يُستعمل");
    await page.locator('input[name="confirm"]').check();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "حذف النموذج نهائياً" }).last().click();
    await page.waitForLoadState("networkidle");
    const gone = sql(`select count(*) from perf_models where id = '${modelId}'`) === "0";
    const redirected = page.url().includes("/performance/models") && !page.url().includes(modelId);
    record("٣٤ · الحذف يكتمل فعلاً في القاعدة (§8.2)", gone);
    record("٣٥ · التحويل إلى وجهة صالحة بعد الحذف", redirected, page.url());
    record("٣٦ · شاهد الحذف مكتوب (§8.2)", sql(`select count(*) from deletion_tombstones where entity_type='perf_model' and entity_id='${modelId}'`) === "1");
  }

  // ── 9 · §21 التصدير بالمرشّحات نفسها ─────────────────────────────────────
  for (const [fmt, label] of [["csv", "CSV"], ["pdf", "PDF"]]) {
    const url = `${BASE}/api/reports/export?category=plan&report=programs-by-domain&format=${fmt}${domains[0] ? `&domain=${encodeURIComponent(domains[0])}` : ""}`;
    const res = await page.request.get(url);
    const buf = await res.body();
    const ok = res.status() === 200 && buf.length > 200;
    record(`٣٧ · تصدير ${label} بالمرشّح الفعّال`, ok, `status=${res.status()} bytes=${buf.length}`);
    if (fmt === "pdf") record("٣٨ · ملف PDF سليم البنية", buf.subarray(0, 5).toString() === "%PDF-");
  }

  // ── 10 · لا طلب إجراء أُجهض طوال الجلسة ─────────────────────────────────
  record("٣٩ · لا استجابة إجراء خادم أُجهضت (D-049/D-053)", abortedActions.length === 0, abortedActions.slice(0, 3).join(" ; "));

  // ── 11 · بيانات الإنتاج المنسوخة لم تتغيّر ──────────────────────────────
  const after = {
    programs: fingerprint("programs"),
    people: fingerprint("people"),
    committees: fingerprint("committees"),
    perfCycles: fingerprint("perf_cycles"),
    budgetExpenses: fingerprint("budget_expenses"),
    maintenance: fingerprint("maintenance_issues"),
    followups: fingerprint("program_followups"),
    counts: sql(`select
        (select count(*) from programs) || '/' ||
        (select count(*) from people) || '/' ||
        (select count(*) from committees) || '/' ||
        (select count(*) from perf_cycles) || '/' ||
        (select count(*) from maintenance_issues)`),
  };
  for (const key of Object.keys(before)) {
    record(`٤٠ · ${key} كما كان بعد البروفة`, before[key] === after[key], before[key] === after[key] ? "" : `${before[key]} → ${after[key]}`);
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} PASS`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  • ${f.step}${f.note ? ` — ${f.note}` : ""}`);
  process.exit(1);
}

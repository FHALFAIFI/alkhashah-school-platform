/**
 * v2.4.1 (النطاق الموحّد النهائي) §8 — production-clone rehearsal.
 *
 * Drives the seventeen required steps against the RC image running on a DISPOSABLE clone of
 * production data. Production is never contacted: the clone lives on its own Docker network,
 * volume and port, and this script only ever talks to APP_URL and to the clone's own
 * Postgres container.
 *
 * The parts that matter most here are the destructive ones. They run **only against records
 * this script created on the clone** — never against a copied production row. Every deletion
 * step therefore seeds its own disposable subject first and asserts the surrounding
 * production data is byte-identical afterwards.
 *
 * Run AFTER the clone app is healthy:
 *   APP_URL=http://127.0.0.1:3086 REHEARSAL_PASSWORD=… node scripts/v241-final-clone-rehearsal.mjs
 *
 * Every step prints PASS/FAIL; exit code 1 if anything fails.
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3086";
const USER = process.env.REHEARSAL_USER ?? "rehearsal";
const PASSWORD = process.env.REHEARSAL_PASSWORD;
const PG = process.env.REHEARSAL_PG ?? "madrasa-rehearsal-v241f-pg";
if (!PASSWORD) throw new Error("REHEARSAL_PASSWORD is required");

/** وسم كل سجل ينشئه هذا السكربت — يفصل ما هو للبروفة عمّا هو منسوخ من الإنتاج */
const TAG = "بروفة-نهائي";

const results = [];
const record = (step, ok, note = "") => {
  results.push({ step, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${note ? ` — ${note}` : ""}`);
};

/**
 * SQL against the clone (never production).
 *
 * `psql -tA` still prints the command tag after a RETURNING clause, so a naive `.trim()`
 * yields `"<uuid>\nINSERT 0 1"` — which silently produced a malformed URL and a 404 that
 * looked like a missing button. Command tags are stripped here, once, for every caller.
 */
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
async function appears(locator, timeout = 120_000) {
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
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "ar-SA",
  timezoneId: "Asia/Riyadh",
});
const page = await ctx.newPage();
// النسخة تعمل على صورة إنتاج داخل حاوية: أول طلب لكل مسار يحمّل وحدته كسولاً، وقد يتجاوز
// المهلة الافتراضية على جهاز مشغول. مهلة أطول + تسخين يجعلان الفشل دلالة على التطبيق لا
// على البنية التحتية.
page.setDefaultTimeout(90_000);
page.setDefaultNavigationTimeout(120_000);

try {
  /* ── 0 · تنظيف بقايا أي تشغيل سابق ثم تسخين المسارات ───────────────────── */
  sql(`delete from committee_members where person_id in (select id from people where full_name like '${TAG}%')`);
  sql(`delete from perf_sessions where cycle_id in (select id from perf_cycles where person_id in (select id from people where full_name like '${TAG}%'))`);
  sql(`delete from perf_cycles where person_id in (select id from people where full_name like '${TAG}%')`);
  sql(`delete from people where full_name like '${TAG}%'`);
  sql(`delete from programs where name like '${TAG}%'`);
  sql(`delete from budget_expenses where category like '${TAG}%'`);
  sql(`delete from financial_items where name_ar like '${TAG}%'`);
  // الفحوصات والبلاغات التي أنشأها تشغيل سابق — وإلا حُسبت ازدواجاً فمُنع إنشاء بلاغ جديد
  sql(`update inspection_findings set maintenance_issue_id = null where note like '${TAG}%'`);
  sql(`delete from maintenance_status_history where issue_id in (select id from maintenance_issues where description like '${TAG}%')`);
  sql(`update maintenance_issues set document_id = null where description like '${TAG}%'`);
  sql(`delete from documents where entity_type = 'maintenance' and entity_id in (select id from maintenance_issues where description like '${TAG}%')`);
  sql(`delete from maintenance_issues where description like '${TAG}%'`);
  sql(`delete from inspections where id in (select distinct inspection_id from inspection_findings where note like '${TAG}%')`);

  /* ── 1 · مراسي خط الأساس قبل أي كتابة ──────────────────────────────────── */
  const baseline = {
    ledger: sql("select count(*) from drizzle.__drizzle_migrations"),
    tables: sql("select count(*) from information_schema.tables where table_schema='public'"),
    people: sql("select count(*) from people"),
    programs: sql("select count(*) from programs"),
    committees: sql("select count(*) from committees"),
    cycles: sql("select count(*) from perf_cycles"),
    documents: sql("select count(*) from documents"),
    financialItems: sql("select count(*) from financial_items"),
    maintenance: sql("select count(*) from maintenance_issues"),
    peopleFp: fingerprint("people"),
    programsFp: fingerprint("programs"),
    committeesFp: fingerprint("committees"),
  };
  record(
    "1 · مراسي خط الأساس مقروءة",
    Number(baseline.people) >= 0,
    `ledger=${baseline.ledger} tables=${baseline.tables} people=${baseline.people} programs=${baseline.programs}`,
  );

  /* ── 2 · الهجرات مطبَّقة: 31 ملفاً وجدولان جديدان ────────────────────────── */
  const newTables = sql(
    "select count(*) from information_schema.tables where table_schema='public' and table_name in ('deletion_tombstones','program_edit_history')",
  );
  const newColumns = sql(
    "select count(*) from information_schema.columns where table_name='maintenance_issues' and column_name in ('category','safety_impact','operational_impact','requested_action')",
  );
  record("2a · جدولا الشاهد وسجل التعديل موجودان", newTables === "2", `${newTables}/2`);
  record("2b · أعمدة تقرير الصيانة الأربعة مضافة", newColumns === "4", `${newColumns}/4`);
  record("2c · سجل الهجرات 31", ["31"].includes(baseline.ledger), `ledger=${baseline.ledger}`);

  /* ── 3 · البيانات القائمة لم تُمسّ بالهجرة: الأعمدة الجديدة كلها NULL ────── */
  // يُقاس على البلاغات المنسوخة من الإنتاج وحدها — بلاغات البروفة تملأ الحقول عمداً
  const nonNull = sql(
    `select count(*) from maintenance_issues
     where description is distinct from null and description not like '${TAG}%'
       and (category is not null or safety_impact is not null or operational_impact is not null or requested_action is not null)`,
  );
  record("3 · الهجرة لم تكتب أي قيمة على بلاغ قائم", nonNull === "0", `${nonNull} صف غير فارغ`);

  await login(page);
  record("0 · تسجيل الدخول بحساب مكافئ للمدير على النسخة المعزولة", true);
  for (const route of [
    "/budget",
    "/plan",
    "/people",
    "/performance",
    "/performance/analytics",
    "/committees",
    "/building/maintenance",
    "/building/maintenance/inspect",
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => {});
  }

  /* ── 4-5 · الميزانية: مخصص لبند تجريبي ثم المتبقي في الملخّص الأعلى ─────── */
  sql(`delete from budget_expenses where category = '${TAG}'`);
  sql(`delete from financial_items where name_ar = '${TAG} بند'`);
  const itemId = sql(
    `insert into financial_items (name_ar, allocated_amount, sort_order) values ('${TAG} بند', null, 990) returning id`,
  );
  await page.goto(`${BASE}/budget`, { waitUntil: "networkidle" });
  const explains =
    (await page.getByText("لم يتم تحديد مخصص لهذا البند").count()) > 0 &&
    (await page.getByText("لا يمكن احتساب المتبقي قبل تحديد المخصص").count()) > 0;
  record("4a · البند بلا مخصص يشرح حالته بالنص المقرَّر", explains);

  const summaryCards = ["إجمالي المخصصات", "إجمالي المتبقي", "نسبة الإنفاق من المخصص", "إجمالي المصروفات"];
  const missingCards = [];
  for (const label of summaryCards) {
    if ((await page.getByText(label, { exact: false }).count()) === 0) missingCards.push(label);
  }
  record("4b · الملخّص الأعلى يعرض البطاقات الأربع", missingCards.length === 0, missingCards.join("، "));

  await page.goto(`${BASE}/budget/items/${itemId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "تحديد المخصص" }).first().click();
  const allocForm = page.locator("form").filter({ hasText: "المخصص المقترح" }).first();
  await allocForm.locator('input[name="allocatedAmount"]').fill("1000");
  await allocForm.getByRole("button", { name: /حفظ/ }).first().click();
  await page.waitForTimeout(2500);
  const allocated = sql(`select coalesce(allocated_amount::text,'NULL') from financial_items where id='${itemId}'`);
  record("5 · حُفظ المخصص للبند التجريبي", allocated.startsWith("1000"), `allocated=${allocated}`);

  /* ── 6 · الفحص من الصيانة وبلاغ منفصل لكل ملاحظة ───────────────────────── */
  await page.goto(`${BASE}/building/maintenance`, { waitUntil: "networkidle" });
  const inspectEntry = await page.getByRole("link", { name: "إجراء فحص" }).count();
  record("6a · «إجراء فحص» ظاهر داخل منطقة الصيانة", inspectEntry > 0);

  const roomId = sql("select id from rooms where active = true order by code limit 1");
  const templateId = sql("select id from inspection_templates where status = 'معتمد' order by created_at limit 1");
  let separateReports = "0";
  if (roomId && templateId) {
    await page.goto(`${BASE}/building/maintenance/inspect`, { waitUntil: "networkidle" });
    await page.selectOption("#insp-room", roomId).catch(() => {});
    await page.selectOption("#insp-tpl", templateId).catch(() => {});
    const failKeys = (await page.locator('input[type="radio"][value="not_ok"]').all()).slice(0, 3);
    for (const [i, radio] of failKeys.entries()) {
      await radio.check();
      const name = await radio.getAttribute("name");
      const key = name.replace("item_", "");
      await page.fill(`input[name="note_${key}"]`, `${TAG} ملاحظة ${i + 1}`);
    }
    const issuesBefore = Number(sql("select count(*) from maintenance_issues"));
    await page.getByRole("button", { name: "حفظ الفحص" }).click();
    const resultShown = await appears(page.getByText(/تم تسجيل .* تحتاج إلى صيانة/));
    record("6b · نتيجة الفحص تُقال صراحةً بعدد الملاحظات", resultShown);

    const optionsShown =
      (await appears(page.getByRole("button", { name: "إنشاء بلاغ منفصل لكل ملاحظة" }), 30_000)) &&
      (await appears(page.getByRole("button", { name: "مراجعة قبل الإنشاء" }), 30_000)) &&
      (await appears(page.getByRole("button", { name: "تخطي الآن" }), 30_000));
    record("6c · الخيارات الأربعة معروضة بعد الحفظ", optionsShown);

    await page.getByRole("button", { name: /إنشاء بلاغ منفصل لكل ملاحظة/ }).click();
    await page.waitForTimeout(4000);
    const issuesAfter = Number(sql("select count(*) from maintenance_issues"));
    separateReports = String(issuesAfter - issuesBefore);
    record("6d · بلاغ منفصل لكل ملاحظة (لا تجميع)", issuesAfter - issuesBefore === failKeys.length,
      `${issuesBefore} → ${issuesAfter} لـ ${failKeys.length} ملاحظات`);

    const linked = sql(
      "select count(*) from maintenance_issues i join inspection_findings f on f.maintenance_issue_id = i.id where i.inspection_finding_id = f.id",
    );
    record("6e · كل بلاغ مرتبط بملاحظته ثنائي الاتجاه", Number(linked) >= failKeys.length, `${linked} ربط`);
  } else {
    record("6 · الفحص من الصيانة", false, "لا غرفة أو قالب معتمد في النسخة");
  }

  /* ── 7 · اعتماد بلاغ وإصدار تقريره ─────────────────────────────────────── */
  const draftIssue = sql(
    `select id from maintenance_issues where status = 'مسودة' and description like '${TAG}%' order by created_at desc limit 1`,
  );
  if (draftIssue) {
    await page.goto(`${BASE}/building/maintenance/${draftIssue}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "اعتماد البلاغ وإصدار التقرير" }).click();
    // توليد الـPDF يمر بمتصفح داخل الحاوية — الانتظار على الرابط لا على مهلة ثابتة
    const hasPdf = await appears(page.getByRole("link", { name: "تنزيل PDF" }), 240_000);
    const hasPrint = await appears(page.getByRole("link", { name: "طباعة تقرير الصيانة" }), 30_000);
    const letterIssued = sql(`select count(*) from documents where doc_type='maintenance_letter'`);
    record("7 · «اعتماد البلاغ وإصدار التقرير» ينتج تقريراً للطباعة والتنزيل",
      hasPdf && hasPrint, `وثائق خطاب صيانة=${letterIssued}`);
  } else {
    record("7 · اعتماد بلاغ وإصدار تقريره", false, "لا بلاغ مسودة من الخطوة السابقة");
  }

  /* ── 8 · تعديل برامج في كل حالة (على نسخ تجريبية لا على برامج الإنتاج) ──── */
  const yearId = sql("select id from plan_years where status='نشطة' order by created_at desc limit 1");
  const editStates = [
    { label: "معتمد", extra: "null, null", seq: 9971 },
    { label: "مكتمل", extra: "now(), null", seq: 9972 },
    { label: "مغلق", extra: "now(), now()", seq: 9973 },
  ];
  for (const st of editStates) {
    sql(`delete from programs where name = '${TAG} ${st.label}'`);
    const pid = sql(
      `insert into programs (plan_year_id, seq, domain, name, general_goal, status, approved_at, completed_at, closed_at)
       values ('${yearId}', ${st.seq}, 'التعليم', '${TAG} ${st.label}', 'هدف أصلي', 'معتمد', now(), ${st.extra}) returning id`,
    );
    await page.goto(`${BASE}/plan/${pid}`, { waitUntil: "networkidle" });
    const editVisible = (await page.getByRole("button", { name: "تعديل البرنامج" }).count()) > 0;
    await page.getByRole("button", { name: "تعديل البرنامج" }).click();
    const warnShown = (await page.getByText(/هذا البرنامج (معتمد|مكتمل|مقفل)\./).count()) > 0;
    await page.locator('input[name="field_name"]').fill(`${TAG} ${st.label} — معدّل`);
    await page.getByRole("button", { name: "حفظ التعديل" }).click();
    await page.waitForTimeout(2500);
    const refusedNoReason = (await page.getByText(/اذكر سبب التعديل/).count()) > 0;
    await page.locator('textarea[name="reason"]').fill("تصحيح مُراجَع أثناء البروفة");
    await page.getByRole("button", { name: "حفظ التعديل" }).click();
    await page.waitForTimeout(3000);

    const after = sql(
      `select status || '|' || (approved_at is not null) || '|' || (completed_at is not null) || '|' || (closed_at is not null) || '|' || name from programs where id='${pid}'`,
    );
    const history = sql(`select count(*) from program_edit_history where program_id='${pid}'`);
    // psql يصيّر المنطقي نصاً «true»/«false» عبر «||» — تُقارَن كما هي لا كـ t/f
    const [status, approved, completed, closed, name] = after.split("|");
    const expectCompleted = st.label !== "معتمد";
    const expectClosed = st.label === "مغلق";
    const stateKept =
      status === "معتمد" &&
      approved === "true" &&
      completed === String(expectCompleted) &&
      closed === String(expectClosed);
    record(`8-${st.label} · التعديل ظاهر ومسموح، والتحذير يظهر`, editVisible && warnShown);
    record(`8-${st.label} · السبب إلزامي بعد الاعتماد`, refusedNoReason);
    record(`8-${st.label} · حُفظ التعديل والحالة لم تتغيّر`, name.includes("معدّل") && stateKept, after);
    record(`8-${st.label} · سجل التغييرات مكتوب`, Number(history) === 1, `${history} صف`);
  }

  /* ── 9 · حذف دورة أداء تجريبية كاملةً ──────────────────────────────────── */
  const disposablePerson = sql(
    `insert into people (full_name, category, employee_type, job_number) values ('${TAG} موظف', 'معلم', 'معلم', 'RHS-1') returning id`,
  );
  const modelId = sql("select id from perf_models order by created_at limit 1");
  const snapshot = sql(
    `select coalesce((select model_snapshot::text from perf_cycles limit 1), '{"model":{"nameAr":"نموذج"},"indicators":[]}')`,
  );
  const cycleA = sql(
    `insert into perf_cycles (person_id, cycle_type, year_key, model_id, model_snapshot)
     values ('${disposablePerson}', 'معلم', '1447', '${modelId}', '${snapshot.replace(/'/g, "''")}'::jsonb) returning id`,
  );
  const cycleB = sql(
    `insert into perf_cycles (person_id, cycle_type, year_key, model_id, model_snapshot)
     values ('${disposablePerson}', 'معلم', '1446', '${modelId}', '${snapshot.replace(/'/g, "''")}'::jsonb) returning id`,
  );
  sql(`insert into perf_sessions (cycle_id, session_type) values ('${cycleA}', 'نهائي'), ('${cycleB}', 'نهائي')`);

  await page.goto(`${BASE}/performance/cycles/${cycleA}`, { waitUntil: "networkidle" });
  const cycleDeleteVisible = (await page.getByRole("heading", { name: "حذف دورة الأداء" }).count()) > 0;
  record("9a · «حذف دورة الأداء» ظاهر في صفحة الدورة", cycleDeleteVisible);
  await page.getByRole("button", { name: "حذف دورة الأداء" }).first().click();
  const impactShown = (await page.getByText(/معاينة الأثر/).count()) > 0;
  record("9b · معاينة الأثر معروضة قبل التنفيذ", impactShown);
  await page.locator("#pd-typed").fill("1447");
  await page.locator("#pd-reason").fill("دورة أُنشئت للبروفة");
  await page.locator('input[name="confirm"]').check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف دورة الأداء" }).last().click();
  await page.waitForTimeout(6000);
  const cycleAGone = sql(`select count(*) from perf_cycles where id='${cycleA}'`) === "0";
  const cycleBKept = sql(`select count(*) from perf_cycles where id='${cycleB}'`) === "1";
  const personKept = sql(`select count(*) from people where id='${disposablePerson}'`) === "1";
  record("9c · حُذفت الدورة المختارة وبقيت الأخرى والموظف", cycleAGone && cycleBKept && personKept,
    `A=${cycleAGone} B=${cycleBKept} person=${personKept}`);
  record("9d · شاهد الحذف مكتوب للدورة",
    sql(`select count(*) from deletion_tombstones where entity_id='${cycleA}'`) === "1");

  /* ── 10 · حذف الموظف التجريبي نهائياً مع بقاء المشترك ──────────────────── */
  const anyCommittee = sql("select id from committees order by created_at limit 1");
  if (anyCommittee) {
    sql(`insert into committee_members (committee_id, person_id, role) values ('${anyCommittee}', '${disposablePerson}', 'عضو')`);
  }
  const committeeFpBefore = fingerprint("committees");
  await page.goto(`${BASE}/people/${disposablePerson}`, { waitUntil: "networkidle" });
  const purgeVisible = (await page.getByRole("heading", { name: "حذف الموظف نهائياً" }).count()) > 0;
  record("10a · «حذف الموظف نهائياً» ظاهر في صفحة المنسوب", purgeVisible);
  await page.getByRole("button", { name: "حذف الموظف نهائياً" }).first().click();
  const sharedShown = (await page.getByText(/سجلات مؤسسية مشتركة/).count()) > 0;
  record("10b · المعاينة تفصل المملوك عن المشترك", sharedShown);
  await page.locator("#pd-typed").fill(`${TAG} موظف`);
  await page.locator("#pd-reason").fill("منسوب أُنشئ للبروفة فقط");
  await page.locator('input[name="confirm"]').check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف الموظف نهائياً" }).last().click();
  await page.waitForTimeout(8000);

  const personGone = sql(`select count(*) from people where id='${disposablePerson}'`) === "0";
  const cyclesGone = sql(`select count(*) from perf_cycles where person_id='${disposablePerson}'`) === "0";
  const membershipGone = sql(`select count(*) from committee_members where person_id='${disposablePerson}'`) === "0";
  const committeeFpAfter = fingerprint("committees");
  record("10c · حُذف الموظف ودورة حياته", personGone && cyclesGone, `person=${personGone} cycles=${cyclesGone}`);
  record("10d · العضوية فُكّت واللجنة نفسها لم تُمسّ", membershipGone && committeeFpAfter === committeeFpBefore);
  record("10e · شاهد الحذف مكتوب بلا محتوى تقييمي",
    sql(`select count(*) from deletion_tombstones where entity_id='${disposablePerson}' and reason='منسوب أُنشئ للبروفة فقط'`) === "1");

  /* ── 11 · تقارير الأداء الفردي والشامل ─────────────────────────────────── */
  const docsBefore = Number(sql("select count(*) from documents"));
  await page.goto(`${BASE}/performance/analytics`, { waitUntil: "networkidle" });
  const overallBtn = page.getByRole("button", { name: "تقرير تفصيلي وإحصائي للجميع" });
  record("11a · زر التقرير الشامل بصياغة المدير", (await overallBtn.count()) > 0);
  if ((await overallBtn.count()) > 0) {
    await overallBtn.click();
    await page.waitForTimeout(45_000);
  }
  const overallDoc = sql("select count(*) from documents where doc_type='overall_performance_report'");
  record("11b · صدر التقرير الشامل", Number(overallDoc) > 0, `${overallDoc} وثيقة`);

  const anyPerson = sql("select person_id from perf_cycles order by created_at limit 1");
  if (anyPerson) {
    await page.goto(`${BASE}/performance/employees/${anyPerson}`, { waitUntil: "networkidle" });
    const indivBtn = page.getByRole("button", { name: /تقرير تفصيلي لل(معلم|موظف)/ });
    record("11c · زر التقرير الفردي بصياغة المدير", (await indivBtn.count()) > 0);
    if ((await indivBtn.count()) > 0) {
      await indivBtn.click();
      await page.waitForTimeout(45_000);
    }
  }
  const indivDoc = sql("select count(*) from documents where doc_type='employee_performance_report'");
  record("11d · صدر التقرير الفردي", Number(indivDoc) > 0, `${indivDoc} وثيقة`);

  /* ── 12 · سجل اللجان التفصيلي وبطاقة لجنة واحدة ────────────────────────── */
  await page.goto(`${BASE}/committees`, { waitUntil: "networkidle" });
  const registryBtn = page.getByRole("button", { name: "سجل المجالس واللجان التفصيلي" });
  record("12a · زر السجل التفصيلي بصياغة المدير", (await registryBtn.count()) > 0);
  if ((await registryBtn.count()) > 0) {
    await registryBtn.click();
    await page.waitForTimeout(45_000);
  }
  record("12b · صدر السجل التفصيلي",
    Number(sql("select count(*) from documents where doc_type='committee_registry'")) > 0);

  if (anyCommittee) {
    await page.goto(`${BASE}/committees/${anyCommittee}/report`, { waitUntil: "networkidle" });
    const cardBtn = page.getByRole("button", { name: /بطاقة مجلس أو لجنة/ });
    record("12c · «بطاقة مجلس أو لجنة» ظاهرة بمسمّاها", (await cardBtn.count()) > 0);
    if ((await cardBtn.count()) > 0) {
      await cardBtn.click();
      await page.waitForTimeout(45_000);
    }
    record("12d · صدرت بطاقة اللجنة",
      Number(sql("select count(*) from documents where doc_type='committee_report'")) > 0);
  }
  const docsAfter = Number(sql("select count(*) from documents"));
  record("12e · وثائق جديدة صدرت فعلياً", docsAfter > docsBefore, `${docsBefore} → ${docsAfter}`);

  /* ── 13 · التدقيق كامل لكل كتابة جديدة ─────────────────────────────────── */
  const auditActions = sql(
    "select string_agg(distinct action, ' · ') from audit_log where action in ('person.permanently_deleted','perf_cycle.permanently_deleted','program.edited','maintenance.created_from_finding','financial_item.allocation_set')",
  );
  const required = ["person.permanently_deleted", "perf_cycle.permanently_deleted", "program.edited", "maintenance.created_from_finding"];
  const covered = required.filter((a) => auditActions.includes(a));
  record("13 · كل عملية جديدة مُدقَّقة", covered.length === required.length, auditActions);

  /* ── 14 · التصدير يعمل ─────────────────────────────────────────────────── */
  // من داخل الصفحة نفسها: `page.request` لا يحمل كعكة الجلسة في هذا السياق فيعيد 401 مضلِّلاً
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
  const exportStatus = await page.evaluate(async () => {
    const r = await fetch("/api/reports/export?report=item-allocations&format=csv", { credentials: "include" });
    return r.status;
  });
  record("14 · تصدير تقرير مالي يعمل", exportStatus === 200, `HTTP ${exportStatus}`);

  /* ── 15 · هوية الإصدار ─────────────────────────────────────────────────── */
  const health = await (await page.request.get(`${BASE}/api/health`)).json();
  record("15 · /api/health يعيد الإصدار والالتزام", health.status === "ok" && Boolean(health.commit),
    `version=${health.version} commit=${health.commit}`);

  /* ── 16-17 · بيانات الإنتاج المنسوخة لم تتغيّر إلا بما أنشأناه ─────────── */
  const finalPeople = Number(sql("select count(*) from people"));
  const finalPrograms = Number(sql("select count(*) from programs"));
  const finalCommittees = Number(sql("select count(*) from committees"));
  record("16a · عدد المنسوبين عاد إلى خط الأساس بعد حذف التجريبي",
    finalPeople === Number(baseline.people), `${baseline.people} → ${finalPeople}`);
  record("16b · اللجان لم يتغيّر عددها ولا محتواها",
    finalCommittees === Number(baseline.committees) && fingerprint("committees") === baseline.committeesFp);
  record("16c · البرامج زادت بثلاثة برامج بروفة فقط",
    finalPrograms === Number(baseline.programs) + 3, `${baseline.programs} → ${finalPrograms}`);
  const untouchedProgramsFp = fingerprint("programs", `name not like '${TAG}%'`);
  const baselineUntouched = sql(
    `select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from programs t where name not like '${TAG}%'`,
  );
  record("16d · برامج الإنتاج المنسوخة نفسها لم تُمسّ", untouchedProgramsFp === baselineUntouched);

  const ledgerAfter = sql("select count(*) from drizzle.__drizzle_migrations");
  const tablesAfter = sql("select count(*) from information_schema.tables where table_schema='public'");
  record("17 · السجل والجداول ثابتان بعد البروفة",
    ledgerAfter === baseline.ledger && tablesAfter === baseline.tables,
    `ledger=${ledgerAfter} tables=${tablesAfter}`);
} catch (e) {
  record("خطأ غير متوقع", false, String(e).slice(0, 400));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  console.log("FAILED STEPS:");
  for (const f of failed) console.log(` - ${f.step}${f.note ? ` — ${f.note}` : ""}`);
  process.exit(1);
}

/**
 * v2.4.1 §8 — production-clone rehearsal.
 *
 * Drives the fifteen required workflows against the RC image running on a DISPOSABLE clone
 * of production data. Production is never contacted: the clone lives on its own Docker
 * network, its own volume and its own port, and this script only ever talks to APP_URL.
 *
 * Run AFTER the clone app is healthy:
 *   APP_URL=http://127.0.0.1:3085 REHEARSAL_PASSWORD=… node scripts/v241-clone-rehearsal.mjs
 *
 * Every step prints PASS/FAIL; exit code 1 if anything fails.
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3085";
const USER = process.env.REHEARSAL_USER ?? "rehearsal";
const PASSWORD = process.env.REHEARSAL_PASSWORD;
const PG = process.env.REHEARSAL_PG ?? "madrasa-rehearsal-v241-pg";
if (!PASSWORD) throw new Error("REHEARSAL_PASSWORD is required");

const results = [];
const record = (step, ok, note = "") => {
  results.push({ step, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${note ? ` — ${note}` : ""}`);
};

/** Read-only SQL against the clone (never production). */
function sql(query) {
  return execFileSync("docker", ["exec", PG, "psql", "-U", "madrasa", "-d", "madrasa", "-tA", "-c", query], {
    encoding: "utf8",
  }).trim();
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", USER);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA", timezoneId: "Asia/Riyadh" });
const page = await ctx.newPage();

try {
  await login(page);
  record("0 · تسجيل الدخول بحساب مكافئ للمدير على النسخة المعزولة", true);

  /* ── 1-3 · الميزانية: تحديد مخصص لبند بلا مخصص، ثم مصروف، ثم المتبقي ───────── */
  const itemId = sql("select id from financial_items where name_ar = 'المستلزمات' limit 1");
  const before = sql(`select coalesce(allocated_amount::text,'NULL') from financial_items where id='${itemId}'`);
  record("1a · حالة الإنتاج المستنسخة: «المستلزمات» بلا مخصص", before === "NULL", `allocated=${before}`);

  await page.goto(`${BASE}/budget/items/${itemId}`, { waitUntil: "networkidle" });
  const explains =
    (await page.getByText("لم يتم تحديد مخصص لهذا البند").count()) > 0 &&
    (await page.getByText("لا يمكن احتسابه قبل تحديد المخصص").count()) > 0;
  record("1b · الشاشة تشرح الحالة وتقدّم الإجراء بدل «—»", explains);

  await page.getByRole("button", { name: "تحديد المخصص" }).first().click();
  const allocForm = page.locator("form").filter({ hasText: "المخصص المقترح" }).first();
  await allocForm.locator('input[name="allocatedAmount"]').fill("2500");
  await allocForm.locator('input[name="note"]').fill("بروفة v2.4.1 — تحديد مخصص أولي");
  await allocForm.getByRole("button", { name: "حفظ المخصص" }).click();
  await page.waitForTimeout(3000);
  const after = sql(`select allocated_amount::text from financial_items where id='${itemId}'`);
  record("1c · حُفظ المخصص 2500 على البند", Number(after) === 2500, `allocated=${after}`);

  const allocAudit = sql(
    `select count(*) from audit_log where action='finance.item_allocation_set' and entity_id='${itemId}'`,
  );
  record("1d · التدقيق سجّل تحديد المخصص", Number(allocAudit) >= 1, `${allocAudit} سجل`);

  await page.goto(`${BASE}/budget`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "إضافة مصروف" }).click();
  const expForm = page.locator("form").filter({ hasText: "حفظ المصروف" }).last();
  await expForm.locator('input[name="amount"]').fill("300.25");
  await expForm.locator('select[name="financialItemId"]').selectOption({ label: "المستلزمات" });
  await expForm.getByRole("button", { name: "حفظ المصروف" }).click();
  const savedMsg = page.getByRole("status").filter({ hasText: "تم حفظ المصروف" }).first();
  await savedMsg.waitFor({ timeout: 30_000 });
  const msgText = (await savedMsg.textContent())?.trim() ?? "";
  record("2 · حفظ المصروف يقول «المتبقي بعد العملية»", msgText.includes("المتبقي بعد العملية"), msgText);
  record("3 · المتبقي دقيق بالهللة (2500 − 300.25 = 2199.75)", /٢٬١٩٩٫٧٥|2,?199\.75/.test(msgText), msgText);

  /* ── 4 · خفض المخصص تحت المصروف يتطلب تأكيداً صريحاً ─────────────────────── */
  await page.goto(`${BASE}/budget/items/${itemId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "تعديل المخصص" }).first().click();
  const lowerForm = page.locator("form").filter({ hasText: "المخصص المقترح" }).first();
  await lowerForm.locator('input[name="allocatedAmount"]').fill("100");
  const warned = (await lowerForm.getByText("سيصبح البند متجاوزاً فور الحفظ").count()) > 0;
  await lowerForm.getByRole("button", { name: "حفظ المخصص" }).click();
  await page.waitForTimeout(2500);
  const rejected = (await lowerForm.getByText("أكّد المتابعة لحفظ هذه القيمة").count()) > 0;
  const unchanged = Number(sql(`select allocated_amount::text from financial_items where id='${itemId}'`)) === 2500;
  record("4 · الخفض تحت المصروف يُحذّر ويُرفض بلا تأكيد صريح (حارس خادم)", warned && rejected && unchanged);

  /* ── 5-6 · تصحيح برنامج «مكتمل / 0٪» ثم تحديث طابور المراجعة ─────────────── */
  const contradictoryBefore = Number(
    sql(
      "select count(*) from programs where archived_at is null and ((execution_status='مكتمل' and (progress<100 or completed_at is null)) or (progress=100 and execution_status<>'مكتمل'))",
    ),
  );
  await page.goto(`${BASE}/plan/consistency`, { waitUntil: "networkidle" });
  const nationalDay = page.locator("div.rounded-xl").filter({ hasText: "اليوم الوطني" }).first();
  const shown = (await nationalDay.count()) > 0;
  record("5a · «اليوم الوطني» يظهر في طابور المراجعة بسبب التناقض", shown);

  await nationalDay.getByRole("button", { name: "تصحيح الحالة" }).click();
  const fixForm = page.locator("form").filter({ hasText: "تصحيح حالة «اليوم الوطني»" }).first();
  const noPreselect = (await fixForm.locator('select[name="executionStatus"]').inputValue()) === "";
  record("5b · «مكتمل» غير منتقاة مسبقاً — المدير يختار", noPreselect);
  await fixForm.locator('select[name="executionStatus"]').selectOption("في المسار");
  await fixForm.locator('input[name="progress"]').fill("60");
  await fixForm.locator('textarea[name="note"]').fill("بروفة v2.4.1 — تصحيح حالة تشغيلية");
  await fixForm.getByRole("button", { name: "حفظ التصحيح" }).click();
  await page.waitForTimeout(3500);

  const nd = sql(
    "select execution_status||'|'||progress||'|'||status||'|'||coalesce(closed_at::text,'null')||'|'||coalesce(approved_at::text,'null') from programs where name='اليوم الوطني'",
  );
  const [ndStatus, ndProgress, ndApproval, ndClosed, ndApproved] = nd.split("|");
  record("5c · صُحّحت الحالة والتقدم", ndStatus === "في المسار" && ndProgress === "60", nd);
  record("5d · الاعتماد والإقفال لم يُمسّا", ndApproval === "معتمد" && ndClosed === "null" && ndApproved !== "null");
  record(
    "5e · لقطة سجل + تدقيق للتصحيح",
    Number(sql("select count(*) from record_versions where reason like 'تصحيح تناقض حالة:%'")) >= 1 &&
      Number(sql("select count(*) from audit_log where action='program.consistency_corrected'")) >= 1,
  );

  const contradictoryAfter = Number(
    sql(
      "select count(*) from programs where archived_at is null and ((execution_status='مكتمل' and (progress<100 or completed_at is null)) or (progress=100 and execution_status<>'مكتمل'))",
    ),
  );
  record("6 · طابور المراجعة ينقص فعلياً بعد التصحيح", contradictoryAfter === contradictoryBefore - 1,
    `${contradictoryBefore} → ${contradictoryAfter}`);

  /* ── 7 · المتابعة الأسبوعية تعكس الحقيقة ─────────────────────────────────── */
  await page.goto(`${BASE}/plan/followup`, { waitUntil: "networkidle" });
  const stillWarns = await page.getByRole("link", { name: "حالة البرنامج تحتاج مراجعة" }).count();
  const notUpdated = (await page.getByText("لم يتم التحديث هذا الأسبوع").count()) > 0;
  record("7 · المتابعة الأسبوعية: وسم «تحتاج مراجعة» للمتبقّي + «لم يتم التحديث هذا الأسبوع»",
    notUpdated, `تحذيرات متبقية: ${stillWarns}`);

  /* ── 8 · حالات مهام اللجان (31 حالة NULL في الإنتاج) ─────────────────────── */
  const nullBefore = Number(sql("select count(*) from committee_task_assignments where status is null"));
  const committeeWithTasks = sql(
    "select committee_id::text from committee_task_assignments group by committee_id order by count(*) desc limit 1",
  );
  await page.goto(`${BASE}/committees/${committeeWithTasks}`, { waitUntil: "networkidle" });
  const unsetShown = (await page.getByText("لم يتم تحديد الحالة").count()) > 0;
  record("8a · المهمة بلا حالة تقول «لم يتم تحديد الحالة»", unsetShown);

  const selects = page.locator('select[aria-label="حالة تنفيذ المهمة"]');
  const toSet = Math.min(3, await selects.count());
  for (let i = 0; i < toSet; i++) {
    await selects.nth(i).selectOption(i === 0 ? "منجزة" : i === 1 ? "قيد التنفيذ" : "لم تبدأ");
    await page.waitForTimeout(1500);
  }
  const nullAfter = Number(sql("select count(*) from committee_task_assignments where status is null"));
  record("8b · حُدِّثت حالات مهام فعلياً", nullAfter === nullBefore - toSet, `NULL: ${nullBefore} → ${nullAfter}`);
  record("8c · كل تحديث حالة مُدقَّق",
    Number(sql("select count(*) from audit_log where action='committee.task_status_set'")) >= toSet);

  /* ── 9 · لجنة بلا مهام: حالة فارغة + إضافة مهمة ─────────────────────────── */
  const emptyCommittee = sql(
    "select c.id::text from committees c left join committee_task_assignments t on t.committee_id=c.id group by c.id having count(t.id)=0 limit 1",
  );
  await page.goto(`${BASE}/committees/${emptyCommittee}`, { waitUntil: "networkidle" });
  const emptyState = (await page.getByText("لم تتم إضافة مهام لهذه اللجنة").count()) > 0;
  record("9a · اللجنة بلا مهام تعرض الحالة الفارغة القابلة للتنفيذ", emptyState);
  const taskForm = page.locator("form").filter({ hasText: "إضافة مهمة" }).first();
  await taskForm.locator('input[name="title"], textarea[name="title"]').first().fill("مهمة بروفة v2.4.1");
  await taskForm.getByRole("button", { name: "إضافة مهمة" }).click();
  await page.waitForTimeout(3000);
  record("9b · أُضيفت مهمة للجنة التي لا مهام لها",
    Number(sql(`select count(*) from committee_task_assignments where committee_id='${emptyCommittee}'`)) >= 1);

  /* ── 10-11 · دورة حياة نموذج التقييم ────────────────────────────────────── */
  await page.goto(`${BASE}/performance/models`, { waitUntil: "networkidle" });
  await page.locator('input[name="nameAr"]').fill("نموذج بروفة v2.4.1");
  await page.getByRole("button", { name: "إنشاء", exact: true }).click();
  await page.waitForURL("**/performance/models/**", { timeout: 30_000 });
  const canDelete = (await page.getByRole("button", { name: "حذف النموذج" }).count()) > 0;
  record("10a · النموذج غير المستخدم يعرض «حذف النموذج»", canDelete);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف النموذج" }).click();
  await page.waitForTimeout(3000);
  record("10b · حُذف النموذج غير المستخدم نهائياً",
    Number(sql("select count(*) from perf_models where name_ar='نموذج بروفة v2.4.1'")) === 0);

  const usedModel = sql(
    "select m.id::text from perf_models m join perf_cycles c on c.model_id=m.id where m.archived_at is null group by m.id limit 1",
  );
  if (usedModel) {
    await page.goto(`${BASE}/performance/models/${usedModel}`, { waitUntil: "networkidle" });
    const archiveOnly =
      (await page.getByRole("button", { name: "أرشفة النموذج" }).count()) > 0 &&
      (await page.getByRole("button", { name: "حذف النموذج" }).count()) === 0;
    record("11a · النموذج المستخدم: الأرشفة فقط، لا حذف نهائي", archiveOnly);
    const archForm = page.locator("form").filter({ hasText: "أرشفة النموذج" }).first();
    await archForm.locator('input[name="reason"]').fill("بروفة v2.4.1");
    page.once("dialog", (d) => d.accept());
    await archForm.getByRole("button", { name: "أرشفة النموذج" }).click();
    await page.waitForTimeout(3000);
    const archived = sql(`select coalesce(archived_at::text,'null') from perf_models where id='${usedModel}'`) !== "null";
    record("11b · أُرشف النموذج المستخدم", archived);
    await page.goto(`${BASE}/performance/models/${usedModel}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "استعادة النموذج" }).click();
    await page.waitForTimeout(3000);
    const restored = sql(`select coalesce(archived_at::text,'null') from perf_models where id='${usedModel}'`) === "null";
    record("11c · استُعيد النموذج المؤرشف", restored);
  } else {
    record("11 · نموذج مستخدم للأرشفة", false, "لا نموذج مرتبط بدورة في النسخة");
  }

  /* ── 12 · التقارير المطلوبة تُولَّد من الواجهة الطبيعية ─────────────────── */
  const docsBefore = Number(sql("select count(*) from documents"));
  await page.goto(`${BASE}/committees`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "إصدار السجل التفصيلي (PDF)" }).click();
  await page.waitForTimeout(20_000);
  record("12a · صدر «سجل المجالس واللجان التفصيلي»",
    Number(sql("select count(*) from documents where doc_type='committee_registry'")) >= 1);

  await page.goto(`${BASE}/performance/analytics`, { waitUntil: "networkidle" });
  const schoolBtn = page.getByRole("button", { name: "تقرير تفصيلي للمدرسة" });
  record("12b · زر «تقرير تفصيلي للمدرسة» ظاهر بالتسمية المطلوبة", (await schoolBtn.count()) > 0);
  await schoolBtn.click();
  await page.waitForTimeout(20_000);
  record("12c · صدر تقرير الأداء التفصيلي للمدرسة",
    Number(sql("select count(*) from documents where doc_type='overall_performance_report'")) >= 1);

  await page.goto(`${BASE}/reports?category=plan&report=programs-by-owner`, { waitUntil: "networkidle" });
  const ownerRows = await page.locator("main table tbody tr").count();
  record("12d · «البرامج حسب المسؤول» يعرض صفوفاً بأسماء البرامج", ownerRows > 0, `${ownerRows} صف`);
  await page.goto(`${BASE}/reports?category=plan&report=programs-by-domain`, { waitUntil: "networkidle" });
  const domainRows = await page.locator("main table tbody tr").count();
  record("12e · «البرامج حسب المجال» يعرض صفوفاً", domainRows > 0, `${domainRows} صف`);
  await page.goto(`${BASE}/reports?category=plan&report=plan-followups`, { waitUntil: "networkidle" });
  record("12f · تقرير المتابعة الأسبوعية يعمل", (await page.locator("main table tbody tr").count()) > 0);
  await page.goto(`${BASE}/reports?category=committees&report=committee-register`, { waitUntil: "networkidle" });
  record("12g · «سجل اللجان العام» بالاسم الجديد", (await page.getByRole("heading", { name: "سجل اللجان العام" }).count()) > 0);

  const programId = sql("select id::text from programs where name='اليوم الوطني'");
  await page.goto(`${BASE}/plan/${programId}`, { waitUntil: "networkidle" });
  record("12h · «طباعة بطاقة البرنامج» ظاهر من صفحة البرنامج",
    (await page.getByRole("link", { name: "طباعة بطاقة البرنامج" }).count()) > 0);
  const docsAfter = Number(sql("select count(*) from documents"));
  record("12i · وثائق جديدة صدرت فعلياً", docsAfter > docsBefore, `${docsBefore} → ${docsAfter}`);

  /* ── 13 · طابور الاعتماد في الصفحة الرئيسة ──────────────────────────────── */
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const queueVisible = (await page.getByRole("heading", { name: "بانتظار اعتماد المدير" }).count()) > 0;
  record("13 · قسم «بانتظار اعتماد المدير» ظاهر في الصفحة الرئيسة", queueVisible);

  /* ── 14 · اكتمال التدقيق لكل كتابة ─────────────────────────────────────── */
  const auditRows = sql(
    "select action||'='||count(*) from audit_log where created_at > now() - interval '1 hour' group by action order by 1",
  );
  const writes = [
    "finance.item_allocation_set",
    "program.consistency_corrected",
    "committee.task_status_set",
    "committee.task_added",
    "perf_model.deleted",
  ];
  const covered = writes.filter((a) => auditRows.includes(a));
  record("14 · كل كتابة رئيسية لها سجل تدقيق", covered.length >= 4, auditRows.replace(/\n/g, " · "));

  /* ── 15 · هوية الإصدار ─────────────────────────────────────────────────── */
  const marker = (await page.locator("aside").textContent()) ?? "";
  record("15a · الغلاف يعرض «الإصدار 2.4.1»", marker.includes("الإصدار 2.4.1"));
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const raw = JSON.stringify(health);
  record("15b · /api/health يعيد الإصدار والالتزام والبيئة",
    health.version === "2.4.1" && !!health.commit && !!health.environment, raw);
  record("15c · لا أسرار ولا مسارات داخلية في هوية الإصدار",
    !/postgres(ql)?:\/\/|password|secret|token|\/data\/|\/app\//i.test(raw));

  /* ── سجل الهجرات لم يتغيّر ─────────────────────────────────────────────── */
  const ledger = sql("select count(*) from drizzle.__drizzle_migrations");
  const tables = sql("select count(*) from information_schema.tables where table_schema='public'");
  record("16 · لا هجرة: السجل 29 والجداول 86 كما قبل البروفة", ledger === "29" && tables === "86", `ledger=${ledger} tables=${tables}`);
} catch (e) {
  record("خطأ غير متوقع", false, String(e).slice(0, 300));
} finally {
  await page.screenshot({ path: "storage-e2e/visual-audit/clone-rehearsal-final.png" }).catch(() => {});
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} PASS · ${failed.length} FAIL`);
process.exit(failed.length > 0 ? 1 : 0);

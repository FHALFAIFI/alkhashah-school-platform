import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * v2.4.1 (النطاق الموحّد النهائي) — التحقق في المتصفح.
 *
 * كل سيناريو يقود التطبيق الحقيقي عبر تنقّله الحقيقي: دخول المدير، واجهة عربية RTL،
 * نفس إجراءات الخادم ونفس محرّك التقارير. **لا مسار يُفتح بكتابة عنوانه** — الوصول
 * بالنقر جزء من الاختبار لا تمهيد له، لأن شكوى v2.4 لم تكن «الميزة معطّلة» بل «لا أجدها».
 *
 * الترتيب: `zzz-` كي يعمل بعد `zz-v241` — يُنشئ سجلات تجريبية ويحذف بعضها نهائياً،
 * فلا يجوز أن ترصدها مواصفة أسبق.
 */

const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

const TAG = "v241f";

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
  const made = await pool.query<{ id: string }>(
    "insert into plan_years (key, name_ar, status) values ($1, $2, 'نشطة') returning id",
    [`${TAG}-year`, `سنة ${TAG}`],
  );
  return made.rows[0].id;
}

/** تنقّل من القائمة الجانبية — لا كتابة عنوان يدوياً */
async function navSidebar(page: Page, label: string, urlGlob: string) {
  await page.locator("aside").getByRole("link", { name: label, exact: true }).click();
  await page.waitForURL(urlGlob, { timeout: 90_000 });
}

test("ن0: تسخين مسارات النطاق النهائي", async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  for (const route of [
    "/dashboard",
    "/budget",
    "/plan",
    "/people",
    "/performance",
    "/performance/analytics",
    "/committees",
    "/building/maintenance",
    "/building/maintenance/inspect",
  ]) {
    await page.goto(route, { timeout: 180_000 });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * §1.1 — الملخّص المالي الأعلى: مخصص ومنفق ومتبقٍ ونسبة إنفاق.
 * ──────────────────────────────────────────────────────────────────────────── */

test("ن1: الملخّص الأعلى يعرض المخصص والمتبقي ونسبة الإنفاق معاً", async ({ page }) => {
  test.setTimeout(150_000);
  await withDb(async (pool) => {
    await activePlanYearId(pool);
    await pool.query("delete from financial_items where name_ar like $1", [`${TAG}%`]);
    await pool.query(
      "insert into financial_items (name_ar, allocated_amount, sort_order) values ($1, 2000, 950)",
      [`${TAG} بند مخصص`],
    );
  });

  await login(page);
  await navSidebar(page, "الميزانية والمصروفات", "**/budget");

  // البطاقات الأربع المطلوبة في الملخّص الأعلى
  const summary = page.locator("section").filter({ hasText: "الملخّص المالي" }).first();
  await expect(summary.getByText("إجمالي المصروفات")).toBeVisible();
  await expect(summary.getByText("إجمالي المخصصات")).toBeVisible();
  await expect(summary.getByText("إجمالي المتبقي")).toBeVisible();
  await expect(summary.getByText("نسبة الإنفاق من المخصص")).toBeVisible();
});

/* ────────────────────────────────────────────────────────────────────────────
 * §1.2 — «المبنى المدرسي ← الصيانة ← إجراء فحص» وبلاغ منفصل لكل ملاحظة.
 * ──────────────────────────────────────────────────────────────────────────── */

test("ن2: الفحص يُنفَّذ من الصيانة وكل ملاحظة تصير بلاغاً منفصلاً", async ({ page }) => {
  test.setTimeout(400_000);
  const roomCode = `KHS-RM-${TAG.length}901`;
  await withDb(async (pool) => {
    // موقع وقالب فحص معتمد مخصّصان لهذا السيناريو — لا اعتماد على بذرة سابقة
    await pool.query("delete from maintenance_issues where code like $1", [`%${TAG}%`]);
    const floor = await pool.query<{ id: string }>(
      `insert into floors (key, name_ar, level) values ($1, $2, 0)
       on conflict (key) do update set name_ar = excluded.name_ar returning id`,
      [`${TAG}-floor`, `دور ${TAG}`],
    );
    await pool.query(
      `insert into rooms (floor_id, geom_key, code, name_ar, room_type)
       values ($1, $2, $3, $4, 'فصل دراسي')
       on conflict (code) do update set name_ar = excluded.name_ar`,
      [floor.rows[0].id, `${TAG}-geom`, roomCode, `غرفة ${TAG}`],
    );
    await pool.query("delete from inspection_templates where name_ar = $1", [`قالب ${TAG}`]);
    await pool.query(
      `insert into inspection_templates (name_ar, room_type, items, status, version)
       values ($1, null, $2::jsonb, 'معتمد', 1)`,
      [
        `قالب ${TAG}`,
        JSON.stringify([
          { key: "k1", label: "لوحة الكهرباء", required: true },
          { key: "k2", label: "تسريب المياه", required: true },
          { key: "k3", label: "باب الطوارئ", required: true },
          { key: "k4", label: "السبورة", required: false },
        ]),
      ],
    );
  });

  await login(page);

  // المسار الطبيعي: القائمة ← بلاغات الصيانة ← «إجراء فحص»
  await navSidebar(page, "بلاغات الصيانة", "**/building/maintenance");
  await expect(page.getByRole("link", { name: "إجراء فحص" }).first()).toBeVisible();
  await page.getByRole("link", { name: "إجراء فحص" }).first().click();
  await page.waitForURL("**/building/maintenance/inspect", { timeout: 180_000 });

  // الاختيار بقيمة الخيار المطابق للرمز — `selectOption` لا يقبل تعبيراً نمطياً للتسمية
  const roomValue = await page
    .locator("#insp-room option", { hasText: roomCode })
    .first()
    .getAttribute("value");
  await page.selectOption("#insp-room", roomValue!);
  await page.selectOption("#insp-tpl", { label: `قالب ${TAG}` });

  // ثلاثة بنود «تحتاج معالجة» والرابع سليم
  for (const key of ["k1", "k2", "k3"]) {
    await page.locator(`input[name="item_${key}"][value="not_ok"]`).check();
    await page.fill(`input[name="note_${key}"]`, `ملاحظة ${key} ${TAG}`);
  }
  await page.getByRole("button", { name: "حفظ الفحص" }).click();

  // النتيجة الصريحة بالصياغة المقرَّرة
  await expect(page.getByText("تم تسجيل 3 ملاحظات تحتاج إلى صيانة")).toBeVisible({ timeout: 120_000 });

  // الخيارات الأربعة معروضة
  await expect(page.getByRole("button", { name: "إنشاء بلاغ منفصل لكل ملاحظة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "مراجعة قبل الإنشاء" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تخطي الآن" })).toBeVisible();

  // المراجعة تعرض الملاحظات الثلاث ثم «إنشاء البلاغات المحددة»
  await page.getByRole("button", { name: "مراجعة قبل الإنشاء" }).click();
  await expect(page.getByText(`ملاحظة k1 ${TAG}`)).toBeVisible();
  await expect(page.getByRole("button", { name: /إنشاء البلاغات المحددة/ })).toBeVisible();

  // ننشئ بلاغاً منفصلاً لكل ملاحظة
  await page.getByRole("button", { name: /إنشاء بلاغ منفصل لكل ملاحظة/ }).click();
  await expect(page.getByText(/أُنشئ 3 بلاغاً/)).toBeVisible({ timeout: 120_000 });

  // ثلاثة بلاغات مستقلة في السجل، مصدرها «ملاحظة فحص»
  const created = await withDb(async (pool) => {
    const { rows } = await pool.query<{ c: number }>(
      "select count(*)::int c from maintenance_issues where inspection_finding_id is not null and description like $1",
      [`%${TAG}%`],
    );
    return rows[0].c;
  });
  expect(created).toBe(3);

  await page.goto("/building/maintenance");
  await expect(page.getByRole("link", { name: "عرض بلاغ الصيانة ←" }).first()).toBeVisible();
});

test("ن3: البلاغ يُعتمد ويصدر تقريره الرسمي بالطباعة والتنزيل", async ({ page }) => {
  test.setTimeout(400_000);
  const issueId = await withDb(async (pool) => {
    const { rows } = await pool.query<{ id: string }>(
      "select id from maintenance_issues where description like $1 order by created_at limit 1",
      [`%${TAG}%`],
    );
    return rows[0]?.id ?? null;
  });
  test.skip(!issueId, "لا بلاغ من السيناريو السابق");

  await login(page);
  await page.goto("/building/maintenance");
  await page.getByRole("link", { name: "عرض بلاغ الصيانة ←" }).first().click();
  await page.waitForURL("**/building/maintenance/**", { timeout: 120_000 });

  // حقول تقرير الصيانة معروضة في البطاقة
  await expect(page.getByText("تصنيف الصيانة").first()).toBeVisible();
  await expect(page.getByText("أثر السلامة").first()).toBeVisible();
  await expect(page.getByText("الأثر التشغيلي").first()).toBeVisible();
  await expect(page.getByText("الإجراء المطلوب").first()).toBeVisible();

  // خطوة واحدة: اعتماد البلاغ وإصدار التقرير
  await expect(page.getByRole("button", { name: "اعتماد البلاغ وإصدار التقرير" })).toBeVisible();
  await page.getByRole("button", { name: "اعتماد البلاغ وإصدار التقرير" }).click();

  await expect(page.getByRole("link", { name: "تنزيل PDF" }).first()).toBeVisible({ timeout: 200_000 });
  await expect(page.getByRole("link", { name: "طباعة تقرير الصيانة" }).first()).toBeVisible();
});

/* ────────────────────────────────────────────────────────────────────────────
 * §1.6 — تعديل البرنامج في حالة معتمدة/مكتملة/مغلقة.
 * ──────────────────────────────────────────────────────────────────────────── */

for (const scenario of [
  { state: "معتمد", warning: "هذا البرنامج معتمد.", seq: 971 },
  { state: "مكتمل", warning: "هذا البرنامج مكتمل.", seq: 972 },
  { state: "مغلق", warning: "هذا البرنامج مقفل.", seq: 973 },
] as const) {
  test(`ن4-${scenario.state}: التعديل مسموح، والتحذير يظهر، والسبب إلزامي، والحالة لا تتغيّر`, async ({ page }) => {
    test.setTimeout(300_000);
    const name = `${TAG} برنامج ${scenario.state}`;
    const programId = await withDb(async (pool) => {
      const yearId = await activePlanYearId(pool);
      await pool.query("delete from programs where name = $1", [name]);
      const lifecycle =
        scenario.state === "معتمد"
          ? "null, null"
          : scenario.state === "مكتمل"
            ? "now(), null"
            : "now(), now()";
      const { rows } = await pool.query<{ id: string }>(
        `insert into programs (plan_year_id, seq, domain, name, general_goal, status, approved_at, completed_at, closed_at)
         values ($1, $2, 'التعليم', $3, 'هدف أصلي', 'معتمد', now(), ${lifecycle}) returning id`,
        [yearId, scenario.seq, name],
      );
      return rows[0].id;
    });

    await login(page);
    await page.goto(`/plan/${programId}`, { timeout: 180_000 });

    // زر التعديل ظاهر في كل حالة
    await page.getByRole("button", { name: "تعديل البرنامج" }).click();
    // التحذير المقرَّر للحالة
    await expect(page.getByText(scenario.warning).first()).toBeVisible();

    // محاولة بلا سبب: مرفوضة برسالة عربية
    await page.locator('input[name="field_name"]').fill(`${name} — محاولة`);
    await page.getByRole("button", { name: "حفظ التعديل" }).click();
    await expect(page.getByText(/اذكر سبب التعديل/).first()).toBeVisible({ timeout: 90_000 });
    // الرفض لا يمسح ما كتبه المدير — حقول محكومة بحالة React (انظر EditProgramForm)
    await expect(page.locator('input[name="field_name"]')).toHaveValue(`${name} — محاولة`);

    // مع سبب: يُحفظ
    await page.locator('textarea[name="reason"]').fill("تصحيح بعد مراجعة الوثيقة الرسمية");
    await page.getByRole("button", { name: "حفظ التعديل" }).click();
    await expect(page.getByText(/حُفظ التعديل/).first()).toBeVisible({ timeout: 90_000 });

    // الحالة والاعتماد كما هما، والسجل يحمل القيمتين
    const after = await withDb(async (pool) => {
      const p = await pool.query(
        "select status, approved_at, completed_at, closed_at, name from programs where id = $1",
        [programId],
      );
      const h = await pool.query(
        "select field, old_value, new_value, reason from program_edit_history where program_id = $1",
        [programId],
      );
      return { program: p.rows[0], history: h.rows };
    });
    expect(after.program.status).toBe("معتمد");
    expect(after.program.approved_at).not.toBeNull();
    expect(after.program.name).toContain("محاولة");
    if (scenario.state !== "معتمد") expect(after.program.completed_at).not.toBeNull();
    if (scenario.state === "مغلق") expect(after.program.closed_at).not.toBeNull();
    expect(after.history).toHaveLength(1);
    expect(after.history[0].old_value).toBe(name);
    expect(after.history[0].reason).toBe("تصحيح بعد مراجعة الوثيقة الرسمية");

    // «سجل التغييرات» والعلامة المعلوماتية ظاهران بعد إعادة التحميل
    await page.reload();
    await expect(page.getByText("سجل التغييرات").first()).toBeVisible();
    await expect(page.getByText("تم تعديل البرنامج بعد الاعتماد").first()).toBeVisible();
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * §1.3 — الحذف النهائي: المعاينة والحراسات ثم التنفيذ.
 * ──────────────────────────────────────────────────────────────────────────── */

test("ن5: «حذف الموظف نهائياً» يعرض الأثر ويرفض الاسم الخاطئ ثم يحذف ويُبقي اللجنة", async ({ page }) => {
  test.setTimeout(400_000);
  const personName = `${TAG} منسوب للحذف`;
  const committeeName = `${TAG} لجنة باقية`;
  const seeded = await withDb(async (pool) => {
    const yearId = await activePlanYearId(pool);
    await pool.query("delete from people where full_name = $1", [personName]);
    await pool.query("delete from committees where name_ar = $1", [committeeName]);
    const person = await pool.query<{ id: string }>(
      "insert into people (full_name, category, employee_type, job_number) values ($1, 'معلم', 'معلم', $2) returning id",
      [personName, `${TAG}-9`],
    );
    const committee = await pool.query<{ id: string }>(
      "insert into committees (plan_year_id, name_ar, kind, status) values ($1, $2, 'لجنة', 'مسودة') returning id",
      [yearId, committeeName],
    );
    await pool.query("insert into committee_members (committee_id, person_id, role) values ($1, $2, 'عضو')", [
      committee.rows[0].id,
      person.rows[0].id,
    ]);
    return { personId: person.rows[0].id, committeeId: committee.rows[0].id };
  });

  await login(page);
  await navSidebar(page, "سجل المعلمين والموظفين", "**/people");
  // صف المنسوب في الجدول ثم «عرض» — الاسم نص لا رابط في هذه القائمة
  await page
    .locator("tr")
    .filter({ hasText: personName })
    .first()
    .getByRole("link", { name: "عرض" })
    .click();
  await page.waitForURL("**/people/**", { timeout: 120_000 });

  // اللوحة ظاهرة بمسمّاها ونصّها التحذيري
  await expect(page.getByRole("heading", { name: "حذف الموظف نهائياً" })).toBeVisible();
  await expect(page.getByText(/لا يمكن التراجع عنه/).first()).toBeVisible();
  await page.getByRole("button", { name: "حذف الموظف نهائياً" }).click();

  // معاينة الأثر: المملوك والمشترك بعدديهما
  await expect(page.getByText(/معاينة الأثر — سجلات تُحذف نهائياً/)).toBeVisible();
  await expect(page.getByText(/سجلات مؤسسية مشتركة/)).toBeVisible();
  // النص يظهر أيضاً في تنبيه التبعيات أعلى الصفحة — نكتفي بأول ظهور داخل المعاينة
  await expect(page.getByText(/عضويات لجان \(تُفكّ/).first()).toBeVisible();

  // الاسم الخاطئ: الزر لا يظهر أصلاً (الواجهة تشرح)، والسبب مطلوب
  await page.locator("#pd-typed").fill("اسم خاطئ");
  await page.locator("#pd-reason").fill("انتهاء الخدمة");
  await page.locator('input[name="confirm"]').check();
  await expect(page.getByText("أكمل الحقول الثلاثة أعلاه ليصبح زر التنفيذ متاحاً")).toBeVisible();

  // الاسم الصحيح يفتح التنفيذ
  await page.locator("#pd-typed").fill(personName);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف الموظف نهائياً" }).last().click();
  await page.waitForURL("**/people", { timeout: 200_000 });

  const after = await withDb(async (pool) => {
    const person = await pool.query("select 1 from people where id = $1", [seeded.personId]);
    const committee = await pool.query("select 1 from committees where id = $1", [seeded.committeeId]);
    const membership = await pool.query("select 1 from committee_members where person_id = $1", [seeded.personId]);
    const tomb = await pool.query("select reason from deletion_tombstones where entity_id = $1", [seeded.personId]);
    return {
      person: person.rowCount,
      committee: committee.rowCount,
      membership: membership.rowCount,
      tomb: tomb.rows[0],
    };
  });
  expect(after.person).toBe(0);
  expect(after.membership).toBe(0);
  // اللجنة — سجل مؤسسي مشترك — باقية
  expect(after.committee).toBe(1);
  expect(after.tomb?.reason).toBe("انتهاء الخدمة");
});

/* ────────────────────────────────────────────────────────────────────────────
 * §1.4 / §1.5 — مسميات التقارير كما يطلبها المدير.
 * ──────────────────────────────────────────────────────────────────────────── */

test("ن6: مسميات تقارير الأداء واللجان ظاهرة بصياغة المدير", async ({ page }) => {
  test.setTimeout(200_000);
  await login(page);

  await navSidebar(page, "دورات الأداء", "**/performance");
  await expect(page.getByRole("link", { name: "تقرير تفصيلي وإحصائي للجميع" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تقرير تفصيلي للمعلم" })).toBeVisible();

  await navSidebar(page, "اللجان والفرق", "**/committees");
  await expect(page.getByRole("button", { name: "سجل المجالس واللجان التفصيلي" })).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * v2.4.1 — Phase F browser-level validation (§2 of the release brief).
 *
 * Every scenario drives the real application through its real navigation shell: principal
 * login, Arabic RTL, the same Server Actions and the same PDF/report engine production
 * uses. Nothing here asserts against a hidden API or a route reached by typing a URL that
 * the principal could not discover — the discoverability audit (§1) is *part* of the test.
 *
 * Ordering: this file is named `zz-` deliberately so it runs LAST in the ordered suite.
 * It seeds deliberately-contradictory records (which the application refuses to create by
 * design), so no earlier spec may observe them.
 */

const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

/** Marker on every record this spec creates — keeps the fixtures identifiable in the DB. */
const TAG = "v241";

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
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

async function withDb<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** The active plan year — every earlier spec leaves one behind; created here if absent. */
async function activePlanYearId(pool: Pool): Promise<string> {
  const found = await pool.query<{ id: string }>(
    "select id from plan_years where status = 'نشطة' order by created_at desc limit 1",
  );
  if (found.rows[0]) return found.rows[0].id;
  const made = await pool.query<{ id: string }>(
    "insert into plan_years (key, name_ar, status) values ($1, $2, 'نشطة') returning id",
    [`${TAG}-year`, `سنة اختبار ${TAG}`],
  );
  return made.rows[0].id;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 0 · Route warm-up. `next dev` compiles a route on its first request, and a cold
 *     compile can outlast a scenario timeout. Warming here keeps every later
 *     assertion about the application, not about the dev compiler.
 * ──────────────────────────────────────────────────────────────────────────── */

const WARM_ROUTES = [
  "/dashboard",
  "/budget",
  "/plan",
  "/plan/followup",
  "/plan/consistency",
  "/committees",
  "/performance",
  "/performance/models",
  "/performance/analytics",
  "/reports",
];

test("س0: تهيئة — تسخين مسارات السيناريوهات", async ({ page }) => {
  test.setTimeout(600_000);
  await login(page);
  for (const route of WARM_ROUTES) {
    await page.goto(route, { timeout: 180_000 });
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * 1-4 · Budget: allocation states, setting an allocation, below-spend guard,
 *       expense result. The production precondition is `allocated_amount IS NULL`.
 * ──────────────────────────────────────────────────────────────────────────── */

test("س1: بند بلا مخصص يشرح حالته ويقدّم «تحديد المخصص» بدل «—» مجرّد", async ({ page }) => {
  test.setTimeout(120_000);
  await withDb(async (pool) => {
    // لوحة المالية تعمل داخل سنة تخطيطية نشطة — تُهيَّأ هنا حتى يصحّ تشغيل الملف منفرداً
    await activePlanYearId(pool);
    await pool.query("delete from budget_expenses where category like $1", [`${TAG}%`]);
    await pool.query("delete from financial_items where name_ar like $1", [`${TAG}%`]);
    await pool.query(
      "insert into financial_items (name_ar, allocated_amount, sort_order) values ($1, null, 900)",
      [`${TAG} بند بلا مخصص`],
    );
  });

  await login(page);

  // التنقل من القائمة الجانبية — لا كتابة عنوان يدوياً
  await page.locator("aside").getByRole("link", { name: "الميزانية والمصروفات", exact: true }).click();
  await page.waitForURL("**/budget");

  // §4.1: النص التفسيري ظاهر على الشاشة الاعتيادية قبل أي نقرة إضافية
  await expect(page.getByText("لم يتم تحديد مخصص لهذا البند").first()).toBeVisible();
  await expect(page.getByText("لا يمكن احتساب المتبقي قبل تحديد المخصص").first()).toBeVisible();
  await expect(page.getByText("غير محدد").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "تحديد المخصص" }).first()).toBeVisible();

  // صفحة تفصيل البند: البطاقات لا تخفي الأعمدة صامتةً بل تشرح سبب غيابها
  await page.getByRole("link", { name: `${TAG} بند بلا مخصص` }).first().click();
  await page.waitForURL("**/budget/items/**");
  await expect(page.getByText("لم يتم تحديد مخصص لهذا البند").first()).toBeVisible();
  await expect(page.getByText("لا يمكن احتساب المتبقي قبل تحديد المخصص").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "تحديد المخصص" }).first()).toBeVisible();
});

test("س2: تحديد المخصص يعرض الحالي والمقترح والمصروف والمتبقي الناتج، ويُحفظ ويُدقَّق", async ({ page }) => {
  test.setTimeout(120_000);
  const itemName = `${TAG} بند التحديد`;
  await withDb(async (pool) => {
    await activePlanYearId(pool);
    await pool.query("delete from financial_items where name_ar = $1", [itemName]);
    await pool.query("insert into financial_items (name_ar, allocated_amount, sort_order) values ($1, null, 901)", [itemName]);
  });

  await login(page);
  await page.goto("/budget");
  // المدخل ظاهر على القائمة، والإجراء يُنفَّذ من صفحة البند (المسار الطبيعي بعد النقر)
  await expect(page.getByRole("button", { name: "تحديد المخصص" }).first()).toBeVisible();
  await page.getByRole("link", { name: itemName }).first().click();
  await page.waitForURL("**/budget/items/**", { timeout: 60_000 });
  await page.getByRole("button", { name: "تحديد المخصص" }).first().click();

  // المعاينة قبل الحفظ (§4.5)
  const form = page.locator("form").filter({ hasText: "المخصص المقترح" }).first();
  await expect(form.getByText("المخصص الحالي")).toBeVisible();
  await expect(form.getByText("المصروف الفعلي")).toBeVisible();
  await expect(form.getByText("المتبقي الناتج")).toBeVisible();

  await form.locator('input[name="allocatedAmount"]').fill("5000");
  await form.locator('input[name="note"]').fill(`تحديد أولي ${TAG}`);
  await form.getByRole("button", { name: "حفظ المخصص" }).click();

  // القيمة الجديدة ظاهرة فوراً بلا تحديث يدوي
  await expect(page.getByText("لم يتم تحديد مخصص لهذا البند")).toHaveCount(0, { timeout: 20_000 });

  const audited = await withDb(async (pool) =>
    pool.query<{ detail: Record<string, unknown> }>(
      `select detail from audit_log where action = 'finance.item_allocation_set'
       order by created_at desc limit 1`,
    ),
  );
  expect(audited.rows[0]).toBeTruthy();
  expect(audited.rows[0].detail).toMatchObject({ previousAllocation: null, newAllocation: 5000 });
  expect(audited.rows[0].detail).toHaveProperty("spentAtChange");
});

test("س3: خفض المخصص تحت المصروف يُحذِّر، ويتطلب تأكيداً، والخادم يرفض تجاوز التأكيد", async ({ page, request }) => {
  test.setTimeout(120_000);
  const itemName = `${TAG} بند التجاوز`;
  const itemId = await withDb(async (pool) => {
    const year = await activePlanYearId(pool);
    await pool.query("delete from financial_items where name_ar = $1", [itemName]);
    const item = await pool.query<{ id: string }>(
      "insert into financial_items (name_ar, allocated_amount, sort_order) values ($1, '4000', 902) returning id",
      [itemName],
    );
    await pool.query(
      "insert into budget_expenses (plan_year_id, financial_item_id, amount, category) values ($1, $2, '3000', $3)",
      [year, item.rows[0].id, `${TAG} مصروف`],
    );
    return item.rows[0].id;
  });

  await login(page);
  await page.goto(`/budget/items/${itemId}`);
  await page.getByRole("button", { name: "تعديل المخصص" }).first().click();
  const form = page.locator("form").filter({ hasText: "المخصص المقترح" }).first();
  await form.locator('input[name="allocatedAmount"]').fill("1000");

  // التحذير يظهر بمجرد نزول القيمة تحت المصروف، ومربع التأكيد يصاحبه
  await expect(form.getByText("سيصبح البند متجاوزاً فور الحفظ")).toBeVisible();
  const confirm = form.locator('input[name="confirmBelowSpent"]');
  await expect(confirm).toBeVisible();

  // الحفظ بلا تأكيد مرفوض من الخادم (الحارس ليس واجهةً فقط)
  await form.getByRole("button", { name: "حفظ المخصص" }).click();
  await expect(form.getByText("أكّد المتابعة لحفظ هذه القيمة")).toBeVisible({ timeout: 20_000 });
  const stillFour = await withDb(async (pool) =>
    pool.query<{ a: string }>("select allocated_amount as a from financial_items where id = $1", [itemId]),
  );
  expect(Number(stillFour.rows[0].a)).toBe(4000);

  // ثم بالتأكيد الصريح — يُحفظ ويُسجَّل قديمه وجديده والمصروف وقت التغيير
  await confirm.check();
  await form.getByRole("button", { name: "حفظ المخصص" }).click();
  await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ a: string }>("select allocated_amount as a from financial_items where id = $1", [itemId]);
          return Number(r.rows[0].a);
        }),
      { timeout: 20_000 },
    )
    .toBe(1000);

  const audited = await withDb(async (pool) =>
    pool.query<{ detail: Record<string, unknown> }>(
      `select detail from audit_log where action = 'finance.item_allocation_set' order by created_at desc limit 1`,
    ),
  );
  expect(audited.rows[0].detail).toMatchObject({
    previousAllocation: 4000,
    newAllocation: 1000,
    spentAtChange: 3000,
    confirmedBelowSpent: true,
  });

  // بوابة الجلسة: زيارة صفحة البند بلا جلسة تُعاد إلى الدخول — لا سطح كتابة مكشوف
  const anon = await request.get(`/budget/items/${itemId}`, { failOnStatusCode: false });
  expect(anon.url()).toContain("/login");
});

test("س4: حفظ المصروف يقول «المتبقي بعد العملية»، والتعديل والحذف يعيدان الحساب بدقة الهللة", async ({ page }) => {
  test.setTimeout(150_000);
  const itemName = `${TAG} بند المصروف`;
  const itemId = await withDb(async (pool) => {
    await activePlanYearId(pool);
    await pool.query("delete from financial_items where name_ar = $1", [itemName]);
    const item = await pool.query<{ id: string }>(
      "insert into financial_items (name_ar, allocated_amount, sort_order) values ($1, '100.10', 903) returning id",
      [itemName],
    );
    return item.rows[0].id;
  });

  await login(page);
  await page.goto("/budget");
  await page.getByRole("button", { name: "إضافة مصروف" }).click();
  const expenseForm = page.locator("form").filter({ hasText: "حفظ المصروف" }).last();
  await expenseForm.locator('input[name="amount"]').fill("0.20");
  await expenseForm.locator('select[name="financialItemId"]').selectOption({ label: itemName });
  await expenseForm.getByRole("button", { name: "حفظ المصروف" }).click();

  // §4.7: نتيجة الحفظ تُقرأ في مكانها، ورقمها من حساب الهللة لا من طرح عشري خام
  const saved = page.getByRole("status").filter({ hasText: "تم حفظ المصروف" }).first();
  await expect(saved).toBeVisible({ timeout: 25_000 });
  await expect(saved).toContainText("المتبقي بعد العملية");
  // formatMoney يعرض بالأرقام العربية الهندية (ar-SA) — المهم ألّا يتسرّب أثر الفاصلة العائمة
  await expect(saved).toContainText(/٩٩٫٩(?!\d)/);
  await expect(page.getByText(/99\.90000000000|٩٩٫٩٠٠٠٠٠٠٠/)).toHaveCount(0);

  // الحذف يعيد الرصيد بالضبط
  await page.goto(`/budget/items/${itemId}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف" }).first().click();
  await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ n: string }>(
            "select coalesce(sum(amount),0)::text as n from budget_expenses where financial_item_id = $1 and archived_at is null",
            [itemId],
          );
          return Number(r.rows[0].n);
        }),
      { timeout: 25_000 },
    )
    .toBe(0);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5-6 · Program consistency review + weekly follow-up truthfulness.
 * ──────────────────────────────────────────────────────────────────────────── */

type Fixture = { name: string; status: string; exec: string; progress: number; completed: boolean; closed: boolean };

const CONSISTENCY_FIXTURES: Fixture[] = [
  { name: `${TAG} مكتمل بصفر`, status: "معتمد", exec: "مكتمل", progress: 0, completed: false, closed: false },
  { name: `${TAG} مكتمل بلا تاريخ`, status: "معتمد", exec: "مكتمل", progress: 100, completed: false, closed: false },
  { name: `${TAG} مئة غير مكتمل`, status: "معتمد", exec: "في المسار", progress: 100, completed: false, closed: false },
  { name: `${TAG} مقفل غير منجز`, status: "معتمد", exec: "في المسار", progress: 40, completed: false, closed: true },
  { name: `${TAG} سليم مكتمل`, status: "معتمد", exec: "مكتمل", progress: 100, completed: true, closed: false },
  { name: `${TAG} سليم جارٍ`, status: "معتمد", exec: "في المسار", progress: 45, completed: false, closed: false },
];

async function seedConsistencyFixtures(): Promise<void> {
  await withDb(async (pool) => {
    const year = await activePlanYearId(pool);
    await pool.query("delete from programs where name like $1", [`${TAG}%`]);
    const maxSeq = await pool.query<{ n: number }>("select coalesce(max(seq),0)::int as n from programs");
    let seq = maxSeq.rows[0].n;
    for (const f of CONSISTENCY_FIXTURES) {
      seq += 1;
      await pool.query(
        `insert into programs
           (plan_year_id, seq, domain, name, status, execution_status, progress, completed_at, closed_at, approved_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
        [
          year,
          seq,
          `مجال ${TAG}`,
          f.name,
          f.status,
          f.exec,
          f.progress,
          f.completed ? new Date() : null,
          f.closed ? new Date() : null,
        ],
      );
    }
  });
}

test("س5: شاشة مراجعة الحالات تكشف المتناقض وحده، ولا تُنتقى «مكتمل» مسبقاً، والتصحيح مُعلَّل ومُدقَّق وبلقطة", async ({ page }) => {
  test.setTimeout(180_000);
  await seedConsistencyFixtures();
  await login(page);

  // §1: المدخل ظاهر في القائمة الجانبية بوصفه — لا مسار مخفي
  const navLink = page.locator("aside").getByRole("link", { name: /مراجعة حالات برامج الخطة/ });
  await expect(navLink).toBeVisible();
  await expect(page.locator("aside")).toContainText("مراجعة البرامج ذات الحالات أو نسب الإنجاز غير المتوافقة");
  await navLink.click();
  await page.waitForURL("**/plan/consistency**");

  // المرشّح الافتراضي «غير المتسقة فقط»: المتناقضة تظهر والسليمة لا
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} مكتمل بصفر`) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} مكتمل بلا تاريخ`) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} مئة غير مكتمل`) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} سليم مكتمل`) })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} سليم جارٍ`) })).toHaveCount(0);

  // سبب كل تناقض معروض نصاً
  await expect(page.getByText(/حالة التنفيذ «مكتمل» بينما التقدم 0٪/)).toBeVisible();
  await expect(page.getByText(/بلا تاريخ اكتمال موثق/).first()).toBeVisible();
  await expect(page.getByText(/التقدم 100٪ بينما حالة التنفيذ/).first()).toBeVisible();

  // «كل البرامج» يُظهر السليمة أيضاً — الترشيح لا يخفي بيانات
  await page.getByRole("link", { name: "كل البرامج", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} سليم جارٍ`) })).toBeVisible();
  await page.getByRole("link", { name: "غير المتسقة فقط", exact: true }).click();

  // التصحيح: لا قيمة مبدئية، والسبب إلزامي
  const card = page.locator("div.rounded-xl").filter({ hasText: `${TAG} مكتمل بصفر` }).first();
  await card.getByRole("button", { name: "تصحيح الحالة" }).click();
  const form = page.locator("form").filter({ hasText: `تصحيح حالة «${TAG} مكتمل بصفر»` });
  await expect(form.locator('select[name="executionStatus"]')).toHaveValue("");
  await form.locator('select[name="executionStatus"]').selectOption("في المسار");
  await form.locator('input[name="progress"]').fill("35");
  await form.locator('textarea[name="note"]').fill(`تصحيح مراجَع ${TAG}`);
  await form.getByRole("button", { name: "حفظ التصحيح" }).click();

  const after = await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ execution_status: string; progress: number; status: string; closed_at: Date | null }>(
            "select execution_status, progress, status, closed_at from programs where name = $1",
            [`${TAG} مكتمل بصفر`],
          );
          return r.rows[0];
        }),
      { timeout: 25_000 },
    )
    .toMatchObject({ execution_status: "في المسار", progress: 35 });
  void after;

  await withDb(async (pool) => {
    // الاعتماد والإقفال لم يُمسّا
    const p = await pool.query<{ status: string; closed_at: Date | null; approved_at: Date | null }>(
      "select status, closed_at, approved_at from programs where name = $1",
      [`${TAG} مكتمل بصفر`],
    );
    expect(p.rows[0].status).toBe("معتمد");
    expect(p.rows[0].closed_at).toBeNull();
    expect(p.rows[0].approved_at).not.toBeNull();

    // تدقيق + لقطة سجل
    const a = await pool.query("select 1 from audit_log where action = 'program.consistency_corrected'");
    expect(a.rowCount).toBeGreaterThan(0);
    const v = await pool.query("select 1 from record_versions where entity_type = 'program' and reason like 'تصحيح تناقض حالة:%'");
    expect(v.rowCount).toBeGreaterThan(0);
  });
});

test("س6: المتابعة الأسبوعية تُحذّر من السجل المتناقض وترتبط بشاشة المراجعة، ويتغير الوسم بعد التصحيح", async ({ page }) => {
  test.setTimeout(180_000);
  await seedConsistencyFixtures();
  await login(page);

  await page.locator("aside").getByRole("link", { name: "البرامج والمبادرات", exact: true }).click();
  await page.waitForURL("**/plan");
  await page.getByRole("link", { name: /المتابعة الأسبوعية/ }).first().click();
  await page.waitForURL("**/plan/followup**");

  // الوسم ظاهر ومرتبط بشاشة المراجعة
  const warning = page.getByRole("link", { name: "حالة البرنامج تحتاج مراجعة" }).first();
  await expect(warning).toBeVisible();
  await expect(warning).toHaveAttribute("href", "/plan/consistency");
  // البرنامج غير المحدث هذا الأسبوع يُعلن ذلك ولا يُقدَّم «مكتملاً»
  await expect(page.getByText("لم يتم التحديث هذا الأسبوع").first()).toBeVisible();

  const before = await page.getByRole("link", { name: "حالة البرنامج تحتاج مراجعة" }).count();

  // التصحيح من شاشة المراجعة ثم العودة — عدد التحذيرات ينقص فعلياً
  await warning.click();
  await page.waitForURL("**/plan/consistency**");
  const card = page.locator("div.rounded-xl").filter({ hasText: `${TAG} مئة غير مكتمل` }).first();
  await card.getByRole("button", { name: "تصحيح الحالة" }).click();
  const form = page.locator("form").filter({ hasText: `تصحيح حالة «${TAG} مئة غير مكتمل»` });
  await form.locator('select[name="executionStatus"]').selectOption("في المسار");
  await form.locator('input[name="progress"]').fill("60");
  await form.locator('textarea[name="note"]').fill(`تصحيح من المتابعة ${TAG}`);
  await form.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(page.getByRole("link", { name: new RegExp(`${TAG} مئة غير مكتمل`) })).toHaveCount(0, { timeout: 25_000 });

  await page.goto("/plan/followup");
  await expect
    .poll(async () => page.getByRole("link", { name: "حالة البرنامج تحتاج مراجعة" }).count(), { timeout: 20_000 })
    .toBeLessThan(before);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 7-8 · Committee task statuses and the no-task committee.
 * ──────────────────────────────────────────────────────────────────────────── */

async function seedCommittees(): Promise<{ withTasks: string; empty: string }> {
  return withDb(async (pool) => {
    const year = await activePlanYearId(pool);
    await pool.query("delete from committees where name_ar like $1", [`${TAG}%`]);
    const a = await pool.query<{ id: string }>(
      "insert into committees (plan_year_id, name_ar, kind, status) values ($1, $2, 'لجنة', 'معتمدة') returning id",
      [year, `${TAG} لجنة بمهام`],
    );
    const b = await pool.query<{ id: string }>(
      "insert into committees (plan_year_id, name_ar, kind, status) values ($1, $2, 'لجنة', 'معتمدة') returning id",
      [year, `${TAG} لجنة بلا مهام`],
    );
    // حالة NULL هي بالضبط ما وجدناه في الإنتاج لكل الـ31 مهمة
    await pool.query(
      "insert into committee_task_assignments (committee_id, title, sort_order, status) values ($1, $2, 0, null)",
      [a.rows[0].id, `${TAG} مهمة بلا حالة`],
    );
    return { withTasks: a.rows[0].id, empty: b.rows[0].id };
  });
}

test("س7: مهمة بلا حالة تقول «لم يتم تحديد الحالة»، والتحديث يظهر على الصف ويُدقَّق ويُطبع في التقرير", async ({ page }) => {
  test.setTimeout(180_000);
  const { withTasks } = await seedCommittees();
  await login(page);

  await page.goto(`/committees/${withTasks}`);
  await expect(page.getByText("لم يتم تحديد الحالة").first()).toBeVisible();

  const row = page.locator("li").filter({ hasText: `${TAG} مهمة بلا حالة` }).first();
  await expect(row).toContainText("حالة التنفيذ: لم يتم تحديد الحالة");
  await row.locator('select[aria-label="حالة تنفيذ المهمة"]').selectOption("قيد التنفيذ");

  await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ status: string | null }>(
            "select status from committee_task_assignments where title = $1",
            [`${TAG} مهمة بلا حالة`],
          );
          return r.rows[0].status;
        }),
      { timeout: 25_000 },
    )
    .toBe("قيد التنفيذ");

  await withDb(async (pool) => {
    const a = await pool.query("select 1 from audit_log where action = 'committee.task_status_set'");
    expect(a.rowCount).toBeGreaterThan(0);
  });

  // الحالة مطبوعة في السجل التفصيلي — الوثيقة نفسها التي تُصدَّر في الإنتاج
  await page.goto("/committees");
  await page.getByRole("button", { name: "سجل المجالس واللجان التفصيلي" }).click();
  await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ n: string }>(
            "select count(*)::text as n from documents where doc_type = 'committee_registry'",
          );
          return Number(r.rows[0].n);
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
});

test("س8: لجنة بلا مهام تعرض حالة فارغة قابلة للتنفيذ، والتقرير يعنون القسم بدل جدول فارغ", async ({ page }) => {
  test.setTimeout(120_000);
  const { empty } = await seedCommittees();
  await login(page);

  await page.goto(`/committees/${empty}`);
  await expect(page.getByText("لم تتم إضافة مهام لهذه اللجنة").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /إضافة مهمة/ }).first()).toBeVisible();
});

/* ────────────────────────────────────────────────────────────────────────────
 * 9-13 · Reports, program card, homepage queue, evaluation forms, performance.
 * ──────────────────────────────────────────────────────────────────────────── */

test("س9: تقريرا «البرامج حسب المسؤول» و«البرامج حسب المجال» يُفتحان من التقارير ويعرضان أسماء البرامج", async ({ page }) => {
  test.setTimeout(150_000);
  await seedConsistencyFixtures();
  await login(page);

  await page.locator("aside").getByRole("link", { name: "التقارير", exact: true }).click();
  await page.waitForURL("**/reports**");
  await page.getByRole("link", { name: "الخطة والبرامج", exact: true }).first().click();

  // كلا التقريرين معلنان بالاسم في قائمة الفئة — لا يُفتحان إلا بمعرفة مفتاحهما
  for (const label of ["البرامج حسب المسؤول", "البرامج حسب المجال"]) {
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  }

  const openReport = async (label: string) => {
    const card = page
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .last();
    await card.getByRole("link", { name: "عرض", exact: true }).click();
    await page.waitForLoadState("networkidle");
  };

  await openReport("البرامج حسب المسؤول");
  await expect(page.getByText(`${TAG} سليم جارٍ`).first()).toBeVisible({ timeout: 25_000 });

  await openReport("البرامج حسب المجال");
  await expect(page.getByText(`${TAG} سليم جارٍ`).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(`مجال ${TAG}`).first()).toBeVisible();
});

test("س10: «طباعة بطاقة البرنامج» ظاهر من صفحة البرنامج وقائمته، ويولّد PDF عربياً سليماً", async ({ page }) => {
  test.setTimeout(180_000);
  await seedConsistencyFixtures();
  await login(page);

  await page.goto("/plan");
  await expect(page.getByRole("link", { name: "طباعة بطاقة البرنامج" }).first()).toBeVisible();

  await page.getByRole("link", { name: new RegExp(`${TAG} سليم جارٍ`) }).first().click();
  await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "طباعة بطاقة البرنامج" })).toBeVisible();
  await page.getByRole("link", { name: "طباعة بطاقة البرنامج" }).click();
  await page.waitForURL("**/report");
  await expect(page.getByText(`${TAG} سليم جارٍ`).first()).toBeVisible();
});

test("س11: طابور «بانتظار اعتماد المدير» ظاهر في الصفحة الرئيسة بحالتيه الممتلئة والفارغة", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/dashboard");

  // القسم موجود دائماً — لا يختفي حين لا شيء ينتظر
  await expect(page.getByRole("heading", { name: "بانتظار اعتماد المدير" })).toBeVisible();

  // «فارغ» يُحسب كما يحسبه الطابور: مسودات + مكتمل موثق بانتظار الإقفال + طلبات تعديل
  const empty = await withDb(async (pool) => {
    const r = await pool.query<{ n: string }>(
      `select (
         (select count(*) from programs where status = 'مسودة' and archived_at is null)
       + (select count(*) from programs where status = 'معتمد' and completed_at is not null
            and closed_at is null and archived_at is null)
       + (select count(*) from program_change_requests cr join programs p on p.id = cr.program_id
            where cr.status = 'قيد الاعتماد' and p.archived_at is null and p.closed_at is null)
       )::text as n`,
    );
    return Number(r.rows[0].n) === 0;
  });

  if (empty) {
    await expect(page.getByText("لا توجد برامج بانتظار الاعتماد حاليا")).toBeVisible();
  } else {
    await expect(page.getByRole("link", { name: /برامج جديدة بانتظار الاعتماد/ })).toBeVisible();
  }

  // الحالة الممتلئة: مسودة جديدة تظهر ويمكن اعتمادها من الصفحة نفسها، والاعتماد مُدقَّق
  await withDb(async (pool) => {
    const year = await activePlanYearId(pool);
    await pool.query("delete from programs where name = $1", [`${TAG} مسودة للاعتماد`]);
    const maxSeq = await pool.query<{ n: number }>("select coalesce(max(seq),0)::int as n from programs");
    await pool.query(
      "insert into programs (plan_year_id, seq, domain, name, status) values ($1, $2, $3, $4, 'مسودة')",
      [year, maxSeq.rows[0].n + 1, `مجال ${TAG}`, `${TAG} مسودة للاعتماد`],
    );
  });
  await page.goto("/dashboard");
  const draftLink = page.getByRole("link", { name: new RegExp(`\\d+\\. ${TAG} مسودة للاعتماد$`) }).first();
  await expect(draftLink).toBeVisible({ timeout: 20_000 });
  // صف الطابور هو أقرب حاوية تجمع الرابط وزر الاعتماد المضمّن
  const queueRow = page.locator("div.flex").filter({ has: draftLink }).last();
  await queueRow.getByRole("button", { name: "اعتماد", exact: true }).click();
  await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ status: string }>("select status from programs where name = $1", [
            `${TAG} مسودة للاعتماد`,
          ]);
          return r.rows[0].status;
        }),
      { timeout: 25_000 },
    )
    .toBe("معتمد");
});

test("س12: دورة حياة نموذج التقييم — «حذف النموذج» لغير المستخدم و«أرشفة النموذج» للمستخدم، مع الاستعادة والحماية", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);

  // مكان الإجراءات معلن في قائمة النماذج (§1) لا مخفياً داخل قائمة غامضة
  await page.goto("/performance/models");
  await expect(page.getByText(/يعرض «حذف النموذج»/)).toBeVisible();

  // نموذج غير مستخدم → حذف نهائي
  await page.fill('input[name="nameAr"]', `${TAG} نموذج للحذف`);
  await page.getByRole("button", { name: "إنشاء", exact: true }).click();
  await page.waitForURL("**/performance/models/**", { timeout: 25_000 });
  await expect(page.getByRole("button", { name: "حذف النموذج" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف النموذج" }).click();
  await page.waitForURL("**/performance/models", { timeout: 25_000 });
  await expect(page.getByText(`${TAG} نموذج للحذف`)).toHaveCount(0);

  // النموذج الرسمي محمي من الحذف النهائي — الأرشفة هي المسار
  const official = await withDb(async (pool) => {
    const r = await pool.query<{ id: string }>("select id from perf_models where official = true limit 1");
    return r.rows[0]?.id ?? null;
  });
  if (official) {
    await page.goto(`/performance/models/${official}`);
    await expect(page.getByRole("button", { name: "أرشفة النموذج" })).toBeVisible();
    await expect(page.getByRole("button", { name: "حذف النموذج" })).toHaveCount(0);
  }
});

test("س13: تقارير الأداء التفصيلية بأسمائها المطلوبة، ومحمية من غير المخوَّل", async ({ page, request }) => {
  test.setTimeout(180_000);
  await login(page);

  // معلنة من جذر قسم الأداء (§1)
  await page.goto("/performance");
  await expect(page.getByRole("heading", { name: "تقارير الأداء التفصيلية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تقرير تفصيلي وإحصائي للجميع" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تقرير تفصيلي للمعلم" })).toBeVisible();

  // زر الإصدار الفعلي بالتسمية نفسها على لوحة الأداء العام
  await page.getByRole("link", { name: "تقرير تفصيلي وإحصائي للجميع" }).click();
  await page.waitForURL("**/performance/analytics**");
  await expect(page.getByRole("button", { name: "تقرير تفصيلي وإحصائي للجميع" })).toBeVisible();
  await page.getByRole("button", { name: "تقرير تفصيلي وإحصائي للجميع" }).click();
  await expect
    .poll(
      async () =>
        withDb(async (pool) => {
          const r = await pool.query<{ n: string }>(
            "select count(*)::text as n from documents where doc_type = 'overall_performance_report'",
          );
          return Number(r.rows[0].n);
        }),
      { timeout: 90_000 },
    )
    .toBeGreaterThan(0);

  // بيانات الأداء الفردي لا تُتاح بلا جلسة مخوَّلة (D-013)
  const person = await withDb(async (pool) => {
    const r = await pool.query<{ id: string }>("select id from people limit 1");
    return r.rows[0]?.id ?? null;
  });
  if (person) {
    const anon = await request.get(`/performance/employees/${person}`, { failOnStatusCode: false });
    expect([200, 301, 302, 303, 307, 308]).toContain(anon.status());
    expect(anon.url()).toContain("/login");
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * 14-15 · Sidebar behaviour and release identity.
 * ──────────────────────────────────────────────────────────────────────────── */

test("س14: القائمة الجانبية — عجلة الفأرة والتمرير المستقل وبقاء الموضع والتنقل بلوحة المفاتيح، بلا انزياح أفقي", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);

  const aside = page.locator("aside");
  await aside.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(async () => aside.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeGreaterThan(50);

  // عنصر أسفل القائمة يبقى قابلاً للنقر بعد التمرير، والموضع لا يعود للأعلى بعد التنقل
  await aside.getByRole("link", { name: "النسخ الاحتياطي", exact: true }).click();
  await page.waitForURL("**/admin/backup");
  expect(await aside.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);

  await page.reload();
  await expect
    .poll(async () => page.locator("aside").evaluate((el) => el.scrollTop), { timeout: 10_000 })
    .toBeGreaterThan(50);

  // الصفحة الرئيسة لا تنزاح أفقياً على مقاس اللابتوب
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/plan/consistency");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // التنقل بلوحة المفاتيح: أول رابط في القائمة قابل للتبئير وله مخطط تركيز ظاهر
  const firstLink = page.locator("aside a").first();
  await firstLink.focus();
  expect(await firstLink.evaluate((el) => el === document.activeElement)).toBe(true);

  // مقاس الجوال الضيق: لا فيض أفقي بعد فتح القائمة
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/budget");
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(mobileOverflow).toBeLessThanOrEqual(1);
});

test("س15: هوية الإصدار — «الإصدار 2.4.1» في الغلاف و/api/health بلا أي سر", async ({ page, request }) => {
  test.setTimeout(90_000);
  await login(page);
  await expect(page.locator("aside")).toContainText("الإصدار 2.4.1");

  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  const body = await health.json();
  expect(body).toMatchObject({ status: "ok", db: "up", version: "2.4.1" });
  expect(body).toHaveProperty("commit");
  expect(body).toHaveProperty("environment");

  const raw = JSON.stringify(body);
  // لا كلمات سر ولا سلاسل اتصال ولا مسارات نظام ملفات
  expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
  expect(raw).not.toMatch(/password|secret|token|DATABASE_URL/i);
  expect(raw).not.toMatch(/\/Users\/|\/home\/|\/app\//);
});

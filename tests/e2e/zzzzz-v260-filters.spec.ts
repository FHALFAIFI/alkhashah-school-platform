import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * D-066 — رفع قيمة من مرشّح متعدّد يُحدّث النتائج فوراً، بلا إعادة تحميل.
 *
 * ── ما كان يقع ───────────────────────────────────────────────────────────
 * كانت قيم المرشّح المتعدّد تُكتب مفاتيح مكرّرة (`?domain=أ&domain=ب`). ويبني موجّه Next
 * مفتاح جزء الصفحة من `Object.fromEntries(new URLSearchParams(search))`، وهي عملية تُبقي
 * آخر تكرار وتُسقط ما قبله — فـ`?domain=أ&domain=ب` و`?domain=ب` يتقاسمان المفتاح نفسه.
 * فحين يرفع المدير «أ» يتغيّر العنوان وتتغيّر الشرائح والمربّعات، ولا يُرسَل طلب تصيير
 * إطلاقاً، فيبقى الجدول و«عدد النتائج» على الاختيار القديم حتى إعادة تحميل الصفحة.
 * وتنطبق العلّة على كل تغيير لا يمسّ آخر تكرار: رفع القيمة الأولى، ورفع الوسطى، وإعادة
 * ترتيب عمودين في منشئ التقارير.
 *
 * ── ما يثبته هذا الملف ───────────────────────────────────────────────────
 * كل انتقال يقوده نقر المستخدم على ما يراه (الشريحة أو مربّع الاختيار)، ثم يُفحص الأثر
 * كاملاً: العنوان، والمربّعات، والشرائح، وصفوف الجدول، وعدد النتائج. ولا شيء منه مسموح
 * أن يمر بإعادة تحميل الصفحة: تُعدّ أحداث `load` في المتصفّح ويجب ألّا يزيد عددها.
 *
 * الانتظار كله على الحالة لا على الزمن. وآخر ما يُنتظر بعد كل نقرة **عدد النتائج**، وهو
 * رقم يأتي من الخادم: وصوله يعني أن التصيير الجديد حلّ محل القديم فعلاً، فلا تقع النقرة
 * التالية على شجرة تُستبدل في اللحظة نفسها.
 */

const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

/** فاصل قيم المرشّح المتعدّد — مثبَّت مقابل `LIST_SEPARATOR` في `tests/unit/report-filter-list-params` */
const SEP = "\u001f";

const RUN = Math.random().toString(36).slice(2, 8);
const OWNER = [0, 1, 2].map((i) => `مسؤول د٠٦٦-${i} ${RUN}`);
const DOMAIN = [0, 1, 2].map((i) => `مجال د٠٦٦-${i} ${RUN}`);
const PROGRAM = [0, 1, 2].map((i) => `برنامج د٠٦٦-${i} ${RUN}`);
const REPORT_BY_DOMAIN = "/reports?category=plan&report=programs-by-domain";
const REPORT_BY_OWNER = "/reports?category=plan&report=programs-by-owner";
const WAIT = { timeout: 30_000 };

/* ─────────────────────────── تمهيد ─────────────────────────── */

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}

/**
 * عدّاد تحميلات المستند. إعادة التحميل تُخفي العطل بدل أن تُصلحه، فمنعها شرطٌ في كل
 * تأكيد هنا: `open()` تضبط خط الأساس بعد كل انتقال مقصود، و`expectNoReload` تتحقق أن
 * العدّاد لم يتحرّك منذها.
 */
const loads = new WeakMap<Page, { total: number; baseline: number }>();

async function open(page: Page, url: string) {
  if (!loads.has(page)) {
    const state = { total: 0, baseline: 0 };
    loads.set(page, state);
    page.on("load", () => {
      state.total += 1;
    });
  }
  await page.goto(url);
  resetLoadBaseline(page);
}

function resetLoadBaseline(page: Page) {
  const state = loads.get(page)!;
  state.baseline = state.total;
}

function expectNoReload(page: Page) {
  const state = loads.get(page)!;
  expect(state.total, "أُعيد تحميل الصفحة — التحديث لم يقع داخل التطبيق").toBe(state.baseline);
}

async function login(page: Page) {
  const c = principalCredentials();
  await open(page, "/login");
  await page.fill("#username", c.username);
  await page.fill("#password", c.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", WAIT);
  resetLoadBaseline(page);
}

async function withDb<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/**
 * ثلاثة برامج يخصّ كلٌّ منها مجالاً ومسؤولاً لا يشاركه فيهما أحد في هذا التشغيل. فيصير
 * كل عدد متوقَّع معروفاً بالضبط بدل «أكبر من أو يساوي» التي تمرّ ولو لم يعمل الترشيح.
 */
async function seedPrograms() {
  await withDb(async (pool) => {
    const active = await pool.query<{ id: string }>(
      "select id from plan_years where status = 'نشطة' order by created_at desc limit 1",
    );
    const yearId =
      active.rows[0]?.id ??
      (
        await pool.query<{ id: string }>(
          "insert into plan_years (key, name_ar, status) values ($1, $2, 'نشطة') returning id",
          [`d066-${RUN}`, `سنة د٠٦٦ ${RUN}`],
        )
      ).rows[0].id;
    for (let i = 0; i < 3; i++) {
      const seq = await pool.query<{ next: number }>("select coalesce(max(seq), 0) + 1 as next from programs");
      await pool.query(
        `insert into programs (plan_year_id, seq, domain, name, owner_position, status, progress, execution_status)
         values ($1, $2, $3, $4, $5, 'معتمد', 30, 'في المسار')`,
        [yearId, seq.rows[0].next, DOMAIN[i], PROGRAM[i], OWNER[i]],
      );
    }
  });
}

/* ─────────────────── قراءة الشاشة والعنوان ─────────────────── */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function readNumber(text: string): number {
  const digits = [...text]
    .map((c) => (ARABIC_INDIC.includes(c) ? String(ARABIC_INDIC.indexOf(c)) : c))
    .filter((c) => c >= "0" && c <= "9")
    .join("");
  return digits === "" ? NaN : Number(digits);
}

const filterSection = (page: Page) => page.locator('section[aria-label="مرشّحات العرض"]');

/** عدد النتائج كما تعرضه لوحة المرشّحات — رقم يأتي من الخادم، فهو إشارة وصول التصيير */
async function resultCount(page: Page): Promise<number> {
  const text = await filterSection(page).innerText();
  const found = /عدد النتائج:\s*([\d٠-٩,،]+)/.exec(text);
  return found ? readNumber(found[1]) : NaN;
}

/** القيم المختارة كما يحملها العنوان — بعد فكّ الفاصل */
function selectedInUrl(page: Page, param: string): string[] {
  return new URL(page.url()).searchParams.getAll(param).flatMap((v) => v.split(SEP)).filter(Boolean);
}

/** مؤشّرات برامج هذا التشغيل الظاهرة في الجدول */
async function rowsShown(page: Page): Promise<number[]> {
  const table = page.locator("table").first();
  if (!(await table.isVisible().catch(() => false))) return [];
  const text = await table.innerText();
  return PROGRAM.map((p, i) => (text.includes(p) ? i : -1)).filter((i) => i >= 0);
}

const PARAM_OF: Record<string, string> = { "المجال": "domain", "مسؤول التنفيذ": "owner" };

/** يفتح مجموعة مرشّح بالنقر على ما يراه المستخدم */
async function openFilterGroup(page: Page, label: string) {
  const section = filterSection(page);
  const group = section.locator("details").filter({ has: page.locator("summary", { hasText: label }) }).first();
  if (!(await group.isVisible())) {
    await section.getByRole("button", { name: /المرشّحات/ }).first().click();
    await expect(group).toBeVisible();
  }
  if (!(await group.evaluate((el) => (el as HTMLDetailsElement).open))) await group.locator("summary").click();
  return group;
}

type Outcome = {
  /** القيم التي يجب أن يحملها هذا المرشّح بعد التفاعل، بترتيبها */
  values: string[];
  /** مؤشّرات برامج هذا التشغيل التي يجب أن تظهر في الجدول */
  rows: number[];
  /** عدد النتائج المعروض — يُترك فارغاً حين تشمل النتيجة بيانات خارج هذا التشغيل */
  count?: number;
};

/**
 * الأثر الكامل لتفاعل مرشّح، بترتيب وصوله: العنوان، فالمربّعات والشرائح (تصيير اللوحة)،
 * فالجدول وعدد النتائج (تصيير الخادم). ولا إعادة تحميل في أي منها.
 */
async function expectSettled(page: Page, groupLabel: string, outcome: Outcome) {
  const param = PARAM_OF[groupLabel];
  await expect.poll(() => selectedInUrl(page, param), WAIT).toEqual(outcome.values);
  // العنوان لا يحمل مفتاحاً مكرَّراً — شرط عمل الموجّه لا تفصيل تجميلي (D-066)
  expect(new URL(page.url()).searchParams.getAll(param).length).toBeLessThanOrEqual(1);

  const group = await openFilterGroup(page, groupLabel);
  for (const value of groupLabel === "المجال" ? DOMAIN : OWNER) {
    const selected = outcome.values.includes(value);
    await expect(
      group.locator("label").filter({ hasText: value }).first().locator('input[type="checkbox"]'),
      `مربّع «${value}»`,
    ).toBeChecked({ checked: selected, ...WAIT });
    await expect(
      page.getByRole("button", { name: `${groupLabel}: ${value}` }),
      `شريحة «${value}»`,
    ).toHaveCount(selected ? 1 : 0, WAIT);
  }

  await expect.poll(() => rowsShown(page), WAIT).toEqual(outcome.rows);
  if (outcome.count !== undefined) await expect.poll(() => resultCount(page), WAIT).toBe(outcome.count);
  expectNoReload(page);
}

/**
 * ينقر، فإن لم يتغيّر العنوان خلال ثماني ثوانٍ — والانتقال قد انتهى قطعاً في هذه المدة —
 * ينقر مرة أخرى واحدة، ثم لا شيء بعدها.
 *
 * ليست إخفاءً لعطل ولا إضعافاً لتأكيد: `expectSettled` بعدها تفحص العنوان والمربّعات
 * والشرائح والجدول وعدد النتائج وعدم إعادة التحميل، كلها كما هي. وهي لا تعوّض بطئاً —
 * ثماني ثوانٍ أضعاف زمن أي انتقال هنا — بل حدث مؤشّر يضيع حين تُستبدل الشجرة المُصيَّرة
 * في اللحظة نفسها، وهو ما يظهر في نقرات بسرعة الآلة لا بسرعة مستخدم. ولو كان العنصر لا
 * يعمل حقاً لبقي العنوان على حاله بعد المحاولتين ولسقط الاختبار كما يجب.
 */
async function clickOnce(page: Page, click: () => Promise<void>) {
  const before = new URL(page.url()).search;
  await click();
  const changed = await page
    .waitForFunction((q) => new URL(location.href).search !== q, before, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!changed) await click();
}

/** ينقر خيار المرشّح كما ينقره المستخدم — سطر القائمة المرئي لا `check()` المُجبِرة */
async function clickOption(page: Page, groupLabel: string, value: string, outcome: Outcome) {
  const group = await openFilterGroup(page, groupLabel);
  const option = group.locator("label").filter({ hasText: value }).first();
  await expect(option).toBeVisible();
  await clickOnce(page, () => option.click());
  await expectSettled(page, groupLabel, outcome);
}

/** يرفع القيمة من شريحتها — الشريحة عنصر تحكّم لا زينة */
async function clickChip(page: Page, groupLabel: string, value: string, outcome: Outcome) {
  const chip = page.getByRole("button", { name: `${groupLabel}: ${value}` });
  await clickOnce(page, () => chip.click());
  await expectSettled(page, groupLabel, outcome);
}

/* ─────────────────────────── السيناريوهات ─────────────────────────── */

test.describe("D-066 — المرشّحات المتعدّدة تُحدّث النتائج فوراً", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await seedPrograms();
  });

  test("١. المجال: واحد ← صفر", async ({ page }) => {
    await login(page);
    await open(page, REPORT_BY_DOMAIN);
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[0]], rows: [0], count: 1 });
    await clickChip(page, "المجال", DOMAIN[0], { values: [], rows: [0, 1, 2] });
    // ولا تبقى شريحة واحدة — ولا شريحة «التصنيف» الوهمية التي كانت تولد من معامل التنقّل (D-068)
    await expect(page.getByText("المرشّحات المطبَّقة")).toHaveCount(0);
  });

  test("٢. المجال: اثنان ← واحد برفع **الأولى** — الحالة التي كانت تفشل", async ({ page }) => {
    await login(page);
    await open(page, REPORT_BY_DOMAIN);
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[0]], rows: [0], count: 1 });
    await clickOption(page, "المجال", DOMAIN[1], { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });
    // القيمة الباقية تبقى مختارة، والنتيجة تصير سطراً واحداً بلا إعادة تحميل
    await clickChip(page, "المجال", DOMAIN[0], { values: [DOMAIN[1]], rows: [1], count: 1 });
  });

  test("٣. المجال: ثلاثة ← اثنان برفع **الوسطى**، ثم اثنان ← صفر", async ({ page }) => {
    await login(page);
    await open(page, REPORT_BY_DOMAIN);
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[0]], rows: [0], count: 1 });
    await clickOption(page, "المجال", DOMAIN[1], { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });
    await clickOption(page, "المجال", DOMAIN[2], { values: DOMAIN, rows: [0, 1, 2], count: 3 });

    await clickChip(page, "المجال", DOMAIN[1], { values: [DOMAIN[0], DOMAIN[2]], rows: [0, 2], count: 2 });

    // «مسح الكل» داخل المجموعة: اثنان ← صفر في خطوة واحدة
    const group = await openFilterGroup(page, "المجال");
    await group.getByRole("button", { name: "مسح الكل" }).click();
    await expectSettled(page, "المجال", { values: [], rows: [0, 1, 2] });
  });

  test("٤. المسؤول: واحد ← صفر، واثنان ← واحد، واثنان ← صفر", async ({ page }) => {
    const owner = "مسؤول التنفيذ";
    await login(page);
    await open(page, REPORT_BY_OWNER);
    await clickOption(page, owner, OWNER[0], { values: [OWNER[0]], rows: [0], count: 1 });
    await clickChip(page, owner, OWNER[0], { values: [], rows: [0, 1, 2] });

    await clickOption(page, owner, OWNER[1], { values: [OWNER[1]], rows: [1], count: 1 });
    await clickOption(page, owner, OWNER[2], { values: [OWNER[1], OWNER[2]], rows: [1, 2], count: 2 });
    // اثنان ← واحد برفع الأولى
    await clickChip(page, owner, OWNER[1], { values: [OWNER[2]], rows: [2], count: 1 });

    // واحد ← اثنان ← صفر عبر «مسح الفلاتر»
    await clickOption(page, owner, OWNER[0], { values: [OWNER[2], OWNER[0]], rows: [0, 2], count: 2 });
    await filterSection(page).getByRole("button", { name: "مسح الفلاتر" }).click();
    await expectSettled(page, owner, { values: [], rows: [0, 1, 2] });
  });

  test("٥. رفع القيمة من **مربّع الاختيار** لا من الشريحة", async ({ page }) => {
    await login(page);
    await open(page, REPORT_BY_DOMAIN);
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[0]], rows: [0], count: 1 });
    await clickOption(page, "المجال", DOMAIN[1], { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });
    // إلغاء التحديد من المربّع نفسه — و`expectSettled` تتحقق من كل المربّعات والشرائح
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[1]], rows: [1], count: 1 });
  });

  test("٦. مرشّحان معاً: مجال ومسؤول — رفع أحدهما لا يمسّ الآخر", async ({ page }) => {
    const owner = "مسؤول التنفيذ";
    await login(page);
    await open(page, REPORT_BY_DOMAIN);
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[0]], rows: [0], count: 1 });
    await clickOption(page, "المجال", DOMAIN[1], { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });
    // المرشّحان يتقاطعان: البرنامجان ٠ و١ يحملان مجاليهما ومسؤوليهما معاً
    await clickOption(page, owner, OWNER[0], { values: [OWNER[0]], rows: [0], count: 1 });
    await clickOption(page, owner, OWNER[1], { values: [OWNER[0], OWNER[1]], rows: [0, 1], count: 2 });

    await clickChip(page, "المجال", DOMAIN[0], { values: [DOMAIN[1]], rows: [1], count: 1 });
    // المرشّح الآخر لم يُمَس
    expect(selectedInUrl(page, "owner")).toEqual([OWNER[0], OWNER[1]]);

    await clickChip(page, owner, OWNER[0], { values: [OWNER[1]], rows: [1], count: 1 });
    expect(selectedInUrl(page, "domain")).toEqual([DOMAIN[1]]);
    expectNoReload(page);
  });

  test("٧. الرجوع والتقدّم يعيدان المرشّحات **ونتائجها**", async ({ page }) => {
    await login(page);
    await open(page, REPORT_BY_DOMAIN);
    await clickOption(page, "المجال", DOMAIN[0], { values: [DOMAIN[0]], rows: [0], count: 1 });
    await clickOption(page, "المجال", DOMAIN[1], { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });
    await clickChip(page, "المجال", DOMAIN[0], { values: [DOMAIN[1]], rows: [1], count: 1 });

    await page.goBack();
    await expectSettled(page, "المجال", { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });

    await page.goBack();
    await expectSettled(page, "المجال", { values: [DOMAIN[0]], rows: [0], count: 1 });

    await page.goForward();
    await expectSettled(page, "المجال", { values: [DOMAIN[0], DOMAIN[1]], rows: [0, 1], count: 2 });

    await page.goForward();
    await expectSettled(page, "المجال", { values: [DOMAIN[1]], rows: [1], count: 1 });
  });

  test("٨. فتح عنوان مرشَّح مباشرةً — بالشكل الجديد وبالشكل القديم المكرَّر", async ({ page }) => {
    await login(page);

    // الشكل الذي تكتبه المنصة: معامل واحد مفصول
    await open(page, `${REPORT_BY_DOMAIN}&domain=${encodeURIComponent(DOMAIN[0] + SEP + DOMAIN[2])}`);
    await expectSettled(page, "المجال", { values: [DOMAIN[0], DOMAIN[2]], rows: [0, 2], count: 2 });

    /*
     * رابط قديم بمفاتيح مكرّرة (إشارة مرجعية أو قالب من قبل D-066): يُقرأ كما هو، ويوحّده
     * الخادم قبل التصيير — وإلا بقي أول رفعٍ لقيمة واقعاً في العطل نفسه.
     */
    await open(
      page,
      `${REPORT_BY_DOMAIN}&domain=${encodeURIComponent(DOMAIN[0])}&domain=${encodeURIComponent(DOMAIN[2])}`,
    );
    // التوحيد نفسه انتقالٌ كامل من الخادم — فلا يُحاسَب على عدّاد التحميل
    await expect.poll(() => new URL(page.url()).searchParams.getAll("domain").length, WAIT).toBe(1);
    await expect.poll(() => selectedInUrl(page, "domain"), WAIT).toEqual([DOMAIN[0], DOMAIN[2]]);
    await expect.poll(() => rowsShown(page), WAIT).toEqual([0, 2]);
    await expect.poll(() => resultCount(page), WAIT).toBe(2);
    resetLoadBaseline(page);

    // ومن هذا العنوان الموروث، رفع القيمة الأولى يعمل كما يجب — وبلا إعادة تحميل
    await clickChip(page, "المجال", DOMAIN[0], { values: [DOMAIN[2]], rows: [2], count: 1 });
  });

  test("٩. منشئ التقارير: إعادة ترتيب الأعمدة وإخفاء عمود ليس الأخير", async ({ page }) => {
    await login(page);
    await open(page, "/reports/builder?report=programs-by-domain");

    const list = page.locator("ul").filter({ has: page.getByRole("button", { name: /^تأخير / }) }).first();
    const order = async () => (await list.locator("li > span").allInnerTexts()).map((t) => t.trim());
    // القائمة تُصيَّر من الخادم — تُنتظر بحالتها لا بمهلة
    await expect.poll(async () => (await order()).length, WAIT).toBeGreaterThanOrEqual(3);
    const before = await order();

    // تأخير العمود الأول: تغيير لا يمسّ آخر قيمة في القائمة — وهو ما كان يبدو بلا أثر
    await list.getByRole("button", { name: `تأخير ${before[0]}` }).click();
    await expect.poll(async () => (await order()).slice(0, 2), WAIT).toEqual([before[1], before[0]]);
    expectNoReload(page);

    // وإخفاء عمود ليس الأخير — الشكل نفسه من العطل
    const afterMove = await order();
    await list.getByRole("button", { name: `إخفاء ${afterMove[0]}` }).click();
    await expect.poll(async () => (await order()).length, WAIT).toBe(before.length - 1);
    expect(await order()).not.toContain(afterMove[0]);
    expectNoReload(page);
  });
});

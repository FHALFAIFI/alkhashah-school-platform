import { test, expect, devices, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { syntheticPeopleWorkbook, syntheticPlanWorkbook } from "../helpers/fixtures";

/**
 * سيناريوهات سير العمل الشاملة (E2E) — تحاكي عمل مدير المدرسة عبر الوحدات كلها:
 * الاستيراد ← الخطة التشغيلية ← اللجان ← الأداء الوظيفي ← التوأم الرقمي.
 *
 * قواعد إلزامية:
 * - دفعة فارس الحقيقية «بيانات الموظفين في فارس.xlsx» لا تُفتح ولا تُلمس إطلاقاً،
 *   والسيناريو الأخير يتحقق أنها بقيت بحالة «معاينة».
 * - كل السجلات المنشأة تحمل «تجريبي آلي» + وسماً فريداً لكل تشغيل (TAG) لتفادي حراس «مرة واحدة».
 */

// أرقام فقط: أسماء السجلات الاصطناعية تظهر في الواجهة، واختبار A1 يرفض أي كلمات لاتينية ظاهرة
const TAG = Date.now().toString().slice(-8);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FAKE_PDF = { name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake\n%%EOF") };
const FARES_FILE = "بيانات الموظفين في فارس.xlsx";

const todayIso = new Date().toISOString().slice(0, 10);
const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

/** حالة مشتركة بين سيناريوهات سطح المكتب وإعادة العرض على الجوال (ملف واحد = عامل واحد) */
const state: {
  peopleBatch1Id?: string;
  person1Id?: string;
  person2Id?: string;
  programId?: string;
  programName?: string;
  committeeId?: string;
  meetingId?: string;
  decisionText?: string;
  cycleId?: string;
  finalSessionId?: string;
  roomCode?: string;
  roomId?: string;
  issueTitle?: string;
} = {};

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  const password = line.split("كلمة المرور المؤقتة:")[1].trim();
  return { username: "principal", password };
}

/**
 * كعكات الجلسة تعاد فيها الاستخدام بين الاختبارات — الدخول من النموذج مرة واحدة فقط:
 * تسجيل الدخول محدود المعدل في التطبيق (10 محاولات/دقيقة لكل عنوان)، و15 دخولاً
 * متتالياً في تشغيل واحد يتجاوز الحد فيعلق الاختبار على «محاولات كثيرة».
 */
let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | null = null;

async function login(page: Page) {
  if (sessionCookies) {
    await page.context().addCookies(sessionCookies);
    await page.goto("/dashboard");
    if (page.url().includes("/dashboard")) return;
    sessionCookies = null; // انتهت الجلسة — دخول جديد من النموذج
  }
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");
  sessionCookies = await page.context().cookies();
}

/** تنقّل عبر القائمة الجانبية (سطح المكتب — القائمة ظاهرة عند 1280px) */
async function nav(page: Page, label: string, urlPart: string) {
  await page.locator("aside").getByRole("link", { name: label, exact: true }).click();
  await page.waitForURL(`**${urlPart}`);
}

async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - doc.clientWidth);
  });
}

/** مصنف الخطة موسوم لكل تشغيل: تسلسلات فريدة (قيد programs_year_seq_unique) وأسماء موسومة */
async function taggedPlanWorkbook(): Promise<{ buffer: Buffer; prog1: string; prog2: string }> {
  const base = await syntheticPlanWorkbook();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(base as unknown as ArrayBuffer);
  const seqBase = Math.floor(Date.now() / 1000) % 900000;
  const prog1 = `برنامج تجريبي آلي أول ${TAG}`;
  const prog2 = `برنامج تجريبي آلي ثانٍ ${TAG}`;

  const main = wb.getWorksheet("الخطة التشغيلية")!;
  main.getCell("A5").value = seqBase;
  main.getCell("E5").value = prog1;
  main.getCell("A6").value = seqBase + 1;
  main.getCell("E6").value = prog2;

  const details = wb.getWorksheet("تفاصيل البرامج التنفيذية")!;
  details.getCell("A5").value = seqBase;
  details.getCell("E5").value = prog1;
  details.getCell("A6").value = seqBase + 1;
  details.getCell("E6").value = prog2;

  const deliv = wb.getWorksheet("سجل المخرجات والشواهد")!;
  deliv.getCell("A4").value = seqBase;
  deliv.getCell("C4").value = prog1;

  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), prog1, prog2 };
}

/** يرفع ملف أشخاص، يستبعد صف المراجعة، ينفذ الموافقة الصريحة، ويعيد معرف الدفعة */
async function importPeopleBatch(page: Page, fileName: string): Promise<string> {
  await nav(page, "الاستيراد", "/imports");
  await page.getByRole("link", { name: "استيراد أشخاص" }).click();
  await page.waitForURL("**/imports/new?type=people");
  await page.setInputFiles("#file", { name: fileName, mimeType: XLSX_MIME, buffer: await syntheticPeopleWorkbook() });
  await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const batchId = page.url().split("/").pop()!;

  // المعاينة: مؤشر المراحل + لوحة المراجعة الكهرمانية لصف واحد
  await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();
  await expect(page.getByText("صفاً تحتاج مراجعة قبل التنفيذ")).toBeVisible();
  const reviewRow = page.locator("tr", { hasText: "تجريبي سادس مثال" });
  await expect(reviewRow.getByText("يحتاج مراجعة")).toBeVisible();
  await expect(reviewRow.getByText("رقم وظيفة مكرر")).toBeVisible();

  // استبعاد الصف المكرر
  await reviewRow.getByRole("button", { name: "استبعاد" }).click();
  await expect(reviewRow.getByText("مستبعد", { exact: true })).toBeVisible({ timeout: 20_000 });

  // الموافقة الصريحة مع لوحة الملخص المفصلة (عنوان التأكيد نوعيّ: دفعة موظفين)
  await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
  await expect(page.getByText("تأكيد استيراد بيانات الموظفين")).toBeVisible();
  await expect(page.locator("li", { hasText: "عدد الصفوف الجاهزة" })).toContainText("5");
  // «موجه طلابي» يصنف معلماً وفق دلالات الكادر التعليمي — لذلك 3 معلمين و2 موظفين
  await expect(page.locator("li", { hasText: "عدد المعلمين" })).toContainText("3");
  await expect(page.locator("li", { hasText: "عدد الموظفين" })).toContainText("2");
  await expect(page.locator("li", { hasText: "عدد المستبعدين" })).toContainText("1");
  await page.getByRole("button", { name: "تأكيد التنفيذ", exact: true }).click();
  await expect(page.getByText("تم الاستيراد", { exact: true })).toBeVisible({ timeout: 30_000 });
  return batchId;
}

/** تقييم كل مؤشرات الجلسة ثم الحفظ */
async function rateAllIndicators(page: Page) {
  const selects = page.locator('select[name^="rating_"]');
  await selects.first().waitFor({ state: "visible", timeout: 30_000 });
  const n = await selects.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await selects.nth(i).selectOption(String((i % 2) + 4)); // تقديرات 4 و5
  }
  await page.getByRole("button", { name: "حفظ التقديرات (تحسب النتيجة تلقائياً)" }).click();
  await expect(page.getByText("حفظت التقديرات وحسبت النتيجة")).toBeVisible({ timeout: 20_000 });
}

/** إصدار تقرير الجلسة (PDF) ثم رفع النسخة الموقعة */
async function issueAndSignSessionReport(page: Page) {
  await page.getByRole("button", { name: "إصدار تقرير الجلسة (PDF)" }).click();
  await expect(page.getByRole("button", { name: "إعادة إصدار تقرير الجلسة (PDF)" })).toBeVisible({ timeout: 120_000 });
  // إجراءات التقرير المجمّعة: طباعة/تنزيل Word/تنزيل Excel/فتح مسودة بريد
  await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تنزيل Word" })).toBeVisible();
  await expect(page.getByRole("link", { name: "تنزيل Excel" })).toBeVisible();
  await expect(page.getByText("فتح مسودة بريد")).toBeVisible();
  await page.setInputFiles('input[name="file"]', FAKE_PDF);
  await page.getByRole("button", { name: "رفع", exact: true }).click();
  await expect(page.getByText("✓ التقرير الموقع مرفوع")).toBeVisible({ timeout: 20_000 });
}

// ————————————————————————— سطح المكتب —————————————————————————

test.describe("سيناريوهات سير العمل — سطح المكتب", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 800 } });

  test("س1: استيراد الموظفين — معاينة وتصحيح وتنفيذ، ثم دفعة ثانية وتراجع كامل", async ({ page }) => {
    test.setTimeout(240_000);
    page.on("dialog", (d) => void d.accept());
    await login(page);

    // الدفعة الأولى: رفع ← معاينة ← استبعاد ← موافقة صريحة ← تنفيذ
    state.peopleBatch1Id = await importPeopleBatch(page, `موظفون تجريبي آلي ${TAG}.xlsx`);

    // التقاط معرفات الأشخاص من روابط الصفوف المنفذة
    const href1 = await page
      .locator("tr", { hasText: "تجريبي أول مثال" })
      .locator('a[href^="/people/"]')
      .getAttribute("href");
    const href2 = await page
      .locator("tr", { hasText: "تجريبي ثانٍ مثال" })
      .locator('a[href^="/people/"]')
      .getAttribute("href");
    state.person1Id = href1!.split("/").pop()!;
    state.person2Id = href2!.split("/").pop()!;

    // بطاقة النجاح ← عرض الموظفين المستوردين ← /people?دفعة=
    await page.getByRole("link", { name: "عرض الموظفين المستوردين" }).click();
    await page.waitForURL("**/people?**");
    for (const name of ["تجريبي أول مثال", "تجريبي ثانٍ مثال", "تجريبي ثالث مثال", "تجريبي رابع مثال", "تجريبي خامس مثال"]) {
      await expect(page.locator("tr", { hasText: name }).first()).toBeVisible();
    }
    await expect(page.locator("tbody tr")).toHaveCount(5);

    // فتح صفحة شخص واحد
    await page.locator("tr", { hasText: "تجريبي أول مثال" }).getByRole("link", { name: "عرض" }).click();
    await page.waitForURL(`**/people/${state.person1Id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("تجريبي أول مثال");

    // الدفعة الثانية ثم التراجع الكامل عنها
    const batch2Id = await importPeopleBatch(page, `موظفون تجريبي آلي ${TAG} ب2.xlsx`);
    await page.getByRole("button", { name: "تراجع كامل عن الدفعة" }).click();
    await expect(page.getByText("متراجع عنها", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // الأشخاص المنشأون من الدفعة الثانية اختفوا
    await page.goto(`/people?دفعة=${batch2Id}`);
    await expect(page.getByText("لا يوجد أشخاص بعد")).toBeVisible();
  });

  test("س2: الخطة التشغيلية — استيراد واعتماد ومتابعة وطلب تغيير وتقرير تنفيذي", async ({ page }) => {
    test.setTimeout(300_000);
    page.on("dialog", (d) => void d.accept());
    await login(page);

    // استيراد الخطة التشغيلية (مصنف موسوم لكل تشغيل — تسلسلات فريدة)
    const plan = await taggedPlanWorkbook();
    state.programName = plan.prog1;
    await nav(page, "الاستيراد", "/imports");
    await page.getByRole("link", { name: "استيراد الخطة التشغيلية" }).click();
    await page.waitForURL("**/imports/new?type=operational_plan");
    await page.setInputFiles("#file", { name: `خطة تجريبي آلي ${TAG}.xlsx`, mimeType: XLSX_MIME, buffer: plan.buffer });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /البرامج والمبادرات/ })).toBeVisible();

    // الموافقة الصريحة والتنفيذ (ينشئ السنة النشطة والبرنامجين)
    await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
    // عنوان التأكيد نوعيّ: دفعة خطة تشغيلية (عدّادات الخطة لا تسميات موظفين)
    await expect(page.getByText("تأكيد استيراد الخطة التشغيلية")).toBeVisible();
    await page.getByRole("button", { name: "تأكيد التنفيذ", exact: true }).click();
    await expect(page.getByText("منفذة", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // /plan ← فتح البرنامج الأول
    await nav(page, "البرامج والمبادرات", "/plan");
    await expect(page.getByRole("heading", { name: /الخطة التشغيلية/ })).toBeVisible();
    await page.getByRole("link", { name: plan.prog1 }).click();
    await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/);
    state.programId = page.url().split("/").pop()!;

    // البرنامج وحدة التنفيذ المباشرة (D-024): لا أنشطة ولا أوزان ولا جاهزية إقفال في الواجهة
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();
    await expect(page.getByText("الأنشطة — أساس حساب تقدم التنفيذ")).toHaveCount(0);
    await expect(page.getByText("جاهزية الإقفال")).toHaveCount(0);
    await expect(page.getByText("مجموع الأوزان")).toHaveCount(0);

    // تحديث التقدم وحالة التنفيذ مباشرةً على البرنامج ومشاهدة الأثر (لا اشتقاق من أنشطة)
    await expect(page.getByRole("heading", { name: "تحديث تقدم البرنامج وحالته" })).toBeVisible();
    const execForm = page.locator('form:has(input[name="progress"])').first();
    await execForm.locator('input[name="progress"]').fill("40");
    await execForm.locator('select[name="executionStatus"]').selectOption("في المسار");
    await execForm.getByRole("button", { name: "حفظ التقدم والحالة" }).click();
    await expect(page.getByText("حُدّث تقدم البرنامج وحالته")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("40٪").first()).toBeVisible();

    // معاينة النماذج المعطّلة على المسودة: المتابعة الأسبوعية وطلب التغيير (تظهر قبل الاعتماد)
    await expect(page.getByText("معاينة نموذج المتابعة الأسبوعية")).toBeVisible();
    await expect(page.getByText("معاينة نموذج طلب التغيير")).toBeVisible();

    // اعتماد البرنامج (D-034) — الحالة تُعرض «معتمد» وإعادة الفتح «إعادة فتح بسبب موثق»
    await page.getByRole("button", { name: "اعتماد", exact: true }).first().click();
    await expect(page.getByText("معتمد", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "إعادة فتح بسبب موثق" })).toBeVisible();

    // §2/D-025: الشواهد معلوماتية فقط — الحالة الفعلية بلا هدف أو نسبة أو «متبقٍّ» أو حاجز إكمال.
    // صفر شواهد: العبارة الفعلية + العدّاد (0)
    await expect(page.getByText("لم يتم رفع أي شاهد حتى الآن")).toBeVisible();
    await expect(page.getByText("الشواهد المرتبطة (0)")).toBeVisible();
    await expect(page.getByText("عدد الشواهد معلوماتي فقط ولا يحدد إمكانية إكمال البرنامج.")).toBeVisible();

    const addTextEvidence = async (n: number) => {
      const openBtn = page.getByRole("button", { name: "رفع شاهد جديد" });
      if (await openBtn.isVisible().catch(() => false)) await openBtn.click();
      const evForm = page.locator('form:has(input[name="entityType"])');
      await evForm.getByRole("radio", { name: "نص" }).check();
      await evForm.locator("#title").fill(`شاهد ${n} تجريبي آلي ${TAG}`);
      await evForm.locator('select[name="role"]').selectOption("تنفيذ");
      await evForm.locator('textarea[name="textContent"]').fill(`نص شاهد ${n} تجريبي آلي ${TAG}`);
      await evForm.getByRole("button", { name: "حفظ الشاهد" }).click();
    };

    // شاهد واحد: العدّاد يتحدّث فوراً دون مغادرة الصفحة (إصلاح router.refresh)
    await addTextEvidence(1);
    await expect(page.getByText("الشواهد المرتبطة (1)")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("تم رفع شاهد واحد")).toBeVisible();

    // شاهدان: الصياغة العربية للمثنى، والتحديث فوري أيضاً
    await addTextEvidence(2);
    await expect(page.getByText("الشواهد المرتبطة (2)")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("تم رفع شاهدان")).toBeVisible();

    // لا هدف/نسبة/متبقٍّ/شاهد مطلوب/حاجز إكمال في أي مكان على الصفحة
    await expect(page.getByText(/متبقٍّ|المتبقية|نسبة الجاهزية|شاهد مطلوب|٪ من الشواهد|شواهد مطلوبة\b/)).toHaveCount(0);

    // المتابعة الأسبوعية
    await page.getByRole("link", { name: "المتابعة الأسبوعية", exact: true }).first().click();
    await page.waitForURL("**/plan/followup");
    const fuNote = `متابعة تجريبي آلي ${TAG} — سير منتظم`;
    await page.fill(`#fu-note-${state.programId}`, fuNote);
    await page.selectOption(`#fu-status-${state.programId}`, "في المسار");
    const fuCard = page.locator("div.rounded-xl", { hasText: plan.prog1 });
    await fuCard.getByRole("button", { name: "تسجيل المتابعة" }).click();
    // v2.4: بعد التسجيل ينتقل البرنامج لمجموعته الصادقة («في المسار») ويظهر سجل الأسبوع نفسه
    await expect(page.getByText(fuNote)).toBeVisible({ timeout: 20_000 });

    // سجل المتابعة يظهر على صفحة البرنامج
    await page.locator(`a[href="/plan/${state.programId}"]`).first().click();
    await page.waitForURL(`**/plan/${state.programId}`);
    await expect(page.getByText(fuNote)).toBeVisible();
    await expect(page.getByText("في المسار", { exact: true }).first()).toBeVisible();

    // طلب تغيير على برنامج معتمد ثم اعتماده
    const crForm = page.locator('form:has(input[name="fieldLabel"])');
    const newValue = `آلية معدلة تجريبي آلي ${TAG}`;
    await crForm.locator('select[name="field"]').selectOption("mechanism");
    await crForm.locator('input[name="newValue"]').fill(newValue);
    await crForm.locator('input[name="reason"]').fill(`سبب تغيير تجريبي آلي ${TAG}`);
    await crForm.getByRole("button", { name: "طلب تغيير" }).click();
    await expect(page.getByText("سجل طلب التغيير")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "اعتماد التغيير" }).click();
    const crItem = page.locator("div.rounded-lg", { hasText: newValue }).first();
    await expect(crItem.locator("span.rounded-full", { hasText: "معتمد" })).toBeVisible({ timeout: 20_000 });
    // القيمة الجديدة طبقت على بطاقة البرنامج
    await expect(page.getByText(newValue).first()).toBeVisible();

    // شاشة تقرير البرنامج تجمع الإجراءات الأربعة: طباعة/تنزيل Word/تنزيل Excel/فتح مسودة بريد
    await page.goto(`/plan/${state.programId}/report`);
    await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تنزيل Word" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تنزيل Excel" })).toBeVisible();
    await expect(page.getByText("فتح مسودة بريد")).toBeVisible();

    // التقرير التنفيذي — يصدر وثيقة PDF برقم
    await nav(page, "التقارير", "/reports");
    await page.getByRole("link", { name: "إصدار التقرير التنفيذي" }).click();
    await page.waitForURL("**/reports/executive");
    await expect(page.getByRole("heading", { name: "الإصدارات السابقة" })).toBeVisible({ timeout: 20_000 });
    const rowsBefore = await page.locator("tbody tr").count();
    await page.getByRole("button", { name: "إصدار التقرير (PDF)" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(rowsBefore + 1, { timeout: 150_000 });
    await expect(page.locator("tbody tr").first().locator("td").first()).toHaveText(/\d{4,}/);
  });

  test("س2ب: الميزانية — تسمية «البند»، رفع إيصال إيراد ومصروف مباشرةً، والإيصال اختياري (D-026)", async ({ page }) => {
    test.setTimeout(300_000);
    page.on("dialog", (d) => void d.accept());
    await login(page);
    await page.goto("/budget");
    // v2.2 §B: صارت «المالية المدرسية» بعد فصل المالية عن البرامج
    await expect(page.getByRole("heading", { name: "المالية المدرسية" })).toBeVisible();

    // إيراد بلا إيصال أولاً (اختياري) — التحقق من تسمية الحقل «البند» (لا «الغرض/التخصيص»)
    await page.getByRole("button", { name: "إضافة إيراد" }).click();
    const incForm = page.locator('form:has(input[name="source"])');
    // v2.2 §B3: «بند الصرف» صار اختياراً من بنود مدرسية بمفتاح أجنبي لا نصاً حراً
    await expect(incForm.getByText("بند الصرف (اختياري)")).toBeVisible();
    await expect(page.getByText("الغرض/التخصيص")).toHaveCount(0);
    const incSource = `إيراد تجريبي آلي ${TAG}`;
    await incForm.locator('input[name="source"]').fill(incSource);
    await incForm.locator('input[name="amount"]').fill("5000");
    await incForm.locator('input[name="purpose"]').fill(`غرض إيراد ${TAG}`);
    await incForm.getByRole("button", { name: "حفظ الإيراد" }).click();
    await expect(page.getByText("أُضيف الإيراد")).toBeVisible({ timeout: 20_000 });

    // فتح لوحة إيصال الإيراد عبر رابط «الإيصال»، ثم رفع إيصال مباشرةً (العدّاد يتحدّث فوراً)
    const incRow = page.locator("tr", { hasText: incSource });
    await incRow.getByRole("link", { name: "الإيصال" }).click();
    await page.waitForURL(/\/budget\?/);
    await expect(page.getByText(/إيصال\/شاهد/)).toBeVisible({ timeout: 20_000 });
    // إمكانية ربط شاهد قائم موجودة (بلا رفع مكرر)، وإمكانية رفع جديد
    await expect(page.getByRole("button", { name: "ربط شاهد قائم" })).toBeVisible();
    await page.getByRole("button", { name: "رفع شاهد جديد" }).click();
    let evForm = page.locator('form:has(input[name="entityType"])');
    await evForm.getByRole("radio", { name: "ملف" }).check();
    await evForm.locator("#title").fill(`إيصال إيراد ${TAG}`);
    await evForm.locator('input[name="file"]').setInputFiles(FAKE_PDF);
    await evForm.getByRole("button", { name: "حفظ الشاهد" }).click();
    await expect(page.getByText("الشواهد المرتبطة (1)")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "تنزيل" }).first()).toBeVisible();

    // مصروف: «البند» صار قائمة (المستلزمات/النشاط)، و«رقم الفاتورة» بدل «مرجع الدفع»، ورابط «الفاتورة» بدل «الإيصال»
    await page.goto("/budget");
    await page.getByRole("button", { name: "إضافة مصروف" }).click();
    const exForm = page.locator('form:has(input[name="amount"])').last();
    await expect(exForm.getByText("بند الصرف (اختياري)")).toBeVisible();
    await expect(page.getByText("المستلزمات/البنود")).toHaveCount(0);
    // B1: «رقم الفاتورة» حاضرة و«مرجع الدفع» أُزيلت من كل الواجهة
    await expect(exForm.getByText("رقم الفاتورة", { exact: true })).toBeVisible();
    await expect(page.getByText("مرجع الدفع")).toHaveCount(0);
    await exForm.locator('input[name="amount"]').fill("300");
    // v2.2 §B4: البند مفتاح أجنبي إلى بنود الصرف المدرسية؛ نختار أول بند متاح إن وُجد
    const itemSelect = exForm.locator('select[name="financialItemId"]');
    const itemOptions = await itemSelect.locator("option").count();
    if (itemOptions > 1) await itemSelect.selectOption({ index: 1 });
    await exForm.locator('input[name="category"]').fill(`تصنيف ${TAG}`);
    await exForm.locator('input[name="paymentReference"]').fill(`INV-${TAG}`);
    await exForm.getByRole("button", { name: "حفظ المصروف" }).click();
    // v2.4.1 §4.7: رسالة الحفظ صارت تحمل نتيجة العملية («المتبقي بعد العملية» أو سبب تعذّره)
    await expect(page.getByText(/تم حفظ المصروف/)).toBeVisible({ timeout: 20_000 });
    // B1: رقم الفاتورة ظاهر في جدول المصروفات (كان يُخزَّن ولا يُعرض سابقاً)
    const exRow = page.locator("tr", { hasText: `INV-${TAG}` });
    await expect(exRow).toBeVisible({ timeout: 20_000 });
    // B2: رابط رفع الفاتورة اسمه «الفاتورة» (لا «الإيصال») والإيصال اختياري
    await exRow.getByRole("link", { name: "الفاتورة" }).click();
    await page.waitForURL(/\/budget\?/);
    await page.getByRole("button", { name: "رفع شاهد جديد" }).click();
    evForm = page.locator('form:has(input[name="entityType"])');
    await evForm.getByRole("radio", { name: "ملف" }).check();
    await evForm.locator("#title").fill(`فاتورة مصروف ${TAG}`);
    await evForm.locator('input[name="file"]').setInputFiles(FAKE_PDF);
    await evForm.getByRole("button", { name: "حفظ الشاهد" }).click();
    await expect(page.getByText("الشواهد المرتبطة (1)")).toBeVisible({ timeout: 20_000 });
  });

  test("س3: اللجان — تشكيل واعتماد واجتماع وقرار إلزامي ومحضر واكتمال ولوحة العمل", async ({ page }) => {
    test.setTimeout(300_000);
    page.on("dialog", (d) => void d.accept());
    test.skip(!state.person1Id || !state.person2Id, "يتطلب أشخاص السيناريو الأول");
    await login(page);

    await nav(page, "اللجان والفرق", "/committees");
    await expect(page.getByRole("heading", { name: "اللجان والمجالس ومجتمعات التعلم" })).toBeVisible();
    let formBtns = page.getByRole("button", { name: /^تشكيل: / });
    // انتظار قصير حتى تكتمل هيدرة الصفحة قبل حسم وجود أزرار التشكيل
    await formBtns.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    if ((await formBtns.count()) === 0) {
      // كل القوالب مشكلة من تشغيلات سابقة — أقفل أول لجنة معتمدة لإتاحة قالبها من جديد
      await page.locator('a[href^="/committees/"]').filter({ hasText: "معتمدة" }).first().click();
      await page.waitForURL(/\/committees\/[0-9a-f-]{36}$/);
      await page.getByRole("button", { name: "إقفال وأرشفة" }).click();
      await expect(page.getByText("مقفلة", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      await nav(page, "اللجان والفرق", "/committees");
      formBtns = page.getByRole("button", { name: /^تشكيل: / });
    }
    await formBtns.first().click();
    await page.waitForURL(/\/committees\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.committeeId = page.url().split("/").pop()!;
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();

    // بلا نسخ عضويات الأعوام السابقة: التشكيل الجديد يبدأ بلا أعضاء + لا حضور/غياب/نصاب
    await expect(page.getByRole("heading", { name: /^الأعضاء \(0\)/ })).toBeVisible();
    await expect(page.getByText("لا حضور ولا غياب ولا نصاب")).toBeVisible();

    // إضافة رئيس ومقرر من سجل المنسوبين (أشخاص هذا التشغيل حصراً)
    await page.selectOption('select[name="personId"]', state.person1Id!);
    await page.selectOption('select[name="role"]', "رئيس");
    await page.getByRole("button", { name: "إضافة عضو" }).click();
    await expect(page.locator("tr", { hasText: "تجريبي أول مثال" }).getByText("رئيس", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.selectOption('select[name="personId"]', state.person2Id!);
    await page.selectOption('select[name="role"]', "مقرر");
    await page.getByRole("button", { name: "إضافة عضو" }).click();
    await expect(page.locator("tr", { hasText: "تجريبي ثانٍ مثال" }).getByText("مقرر", { exact: true })).toBeVisible({ timeout: 20_000 });

    // اعتماد التشكيل (D-034) — الحالة تُعرض «معتمدة»
    await page.getByRole("button", { name: "اعتماد التشكيل" }).first().click();
    await expect(page.getByText("معتمدة", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // §4/v2.1 (F): توزيع المهام — تحميل المهام المعرّفة مسبقاً، إسناد لعضو، ثم توليد نموذج التكليف الذي
    // صار قائمتين مستقلتين: «أعضاء اللجنة» (بعمود «التوقيع») و«مهام اللجنة».
    await expect(page.getByRole("heading", { name: "توزيع المهام", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "تحميل المهام المعرّفة مسبقاً" }).click();
    await expect(page.getByText(/حُمّلت \d+ مهمة معرّفة مسبقاً/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("combobox", { name: "إسناد المهمة لعضو" }).first().selectOption({ index: 1 });
    await page.getByRole("button", { name: "توليد نموذج التكليف" }).click();
    await expect(page.getByText(/صدر نموذج التكليف/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("link", { name: "تنزيل نموذج التكليف" })).toBeVisible({ timeout: 120_000 });

    // اجتماع جديد — نوع الاجتماع إلزامي
    await page.fill("#title", `اجتماع تجريبي آلي ${TAG}`);
    await page.selectOption('select[name="typeId"]', { label: "دوري" });
    await page.fill("#meetingDate-input", todayIso);
    await page.fill("#agenda", "بند تجريبي أول\nبند تجريبي ثانٍ");
    await page.getByRole("button", { name: "إنشاء اجتماع" }).click();
    await page.waitForURL(/\/meetings\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.meetingId = page.url().split("/").pop()!;
    // نوع الاجتماع «دوري» يظهر على صفحة الاجتماع
    await expect(page.getByText("دوري", { exact: true }).first()).toBeVisible();

    // مرفق اجتماع خاص بفئة (ليس حضوراً)
    const attForm = page.locator('form:has(select[name="category"])');
    await attForm.locator('input[name="title"]').fill(`مرفق تجريبي آلي ${TAG}`);
    await attForm.locator('select[name="category"]').selectOption("مستندات داعمة");
    await attForm.locator('input[name="file"]').setInputFiles(FAKE_PDF);
    await attForm.getByRole("button", { name: "إضافة المرفق" }).click();
    await expect(page.getByRole("heading", { name: /^مرفقات الاجتماع \(1\)/ })).toBeVisible({ timeout: 20_000 });

    // نتيجة «قرار» تنشئ إجراءً إلزامياً — بمكلف وموعد متأخر (أمس)
    state.decisionText = `قرار تجريبي آلي ${TAG} — متابعة تنفيذ التوصيات`;
    await page.fill("#text", state.decisionText);
    await page.selectOption('select[name="ownerPersonId"]', state.person1Id!);
    await page.fill("#dueDate-input", yesterdayIso);
    await page.getByRole("button", { name: "تسجيل النتيجة" }).click();
    await expect(page.getByText("سجلت النتيجة")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("tr", { hasText: state.decisionText }).getByText("إلزامي")).toBeVisible();

    // إعادة إدخال نص القرار نفسه ترفض
    await page.fill("#text", state.decisionText);
    await page.getByRole("button", { name: "تسجيل النتيجة" }).click();
    await expect(page.getByText("هذه النتيجة مسجلة مسبقاً في هذا الاجتماع")).toBeVisible({ timeout: 20_000 });

    // D-027: نوع «دوري» غير مُهيّأ ليتطلب توقيعاً — لا قاعدة عامة تفرض التوقيع، فالاكتمال متاح
    // مباشرةً دون رفع محضر موقّع، والزر مُفعّل.
    await expect(page.getByText("لا يتطلب توقيعاً لاكتماله").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "اعتماد الاكتمال" }).first()).toBeEnabled();

    // إصدار المحضر الرسمي (PDF) — اختياري، لكنه يثبت عمل الزر — ثم اعتماد الاكتمال مباشرةً
    await page.getByRole("button", { name: "إصدار المحضر الرسمي (PDF)" }).click();
    await expect(page.getByRole("link", { name: /تنزيل المحضر/ })).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "اعتماد الاكتمال" }).first().click();
    await expect(page.getByText("اكتمل الاجتماع واعتمد").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();

    // G3/v2.1: «النتائج والأثر» أُزيلت من سير عمل اللجنة — لم يعد لها نموذج تسجيل ولا شرط إقفال
    // (القيم التاريخية تبقى مخزّنة لكنها لا تظهر تشغيلياً).
    await page.goto(`/committees/${state.committeeId}`);
    await expect(page.locator('form:has(textarea[name="result"])')).toHaveCount(0);

    // تقرير اللجنة: يُصدر PDF رسمي برقم وثيقة (بلا قسم النتائج/الأثر)
    await page.goto(`/committees/${state.committeeId}/report`);
    await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تنزيل Word" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تنزيل Excel" })).toBeVisible();
    await expect(page.getByText("فتح مسودة بريد")).toBeVisible();
    await page.getByRole("button", { name: "بطاقة مجلس أو لجنة (PDF)" }).click();
    await expect(page.getByText(/KHS-DOC-/).first()).toBeVisible({ timeout: 150_000 });

    // /tasks: المهمة الإلزامية بمصدر يعود للاجتماع وبشارة تأخر
    await nav(page, "المهام والإجراءات", "/tasks");
    const taskRow = page.locator("tr", { hasText: state.decisionText }).first();
    await expect(taskRow.getByText("إلزامي")).toBeVisible();
    await expect(taskRow.getByText("متأخر", { exact: true })).toBeVisible();
    await expect(taskRow.getByRole("link", { name: "قرار اجتماع" })).toHaveAttribute(
      "href",
      `/committees/${state.committeeId}/meetings/${state.meetingId}`,
    );

    // لوحة مركز العمل: قرارات اللجان المفتوحة + مهام متأخرة، والنقر يقود لصفحة الاجتماع
    await nav(page, "مركز عمل مدير المدرسة", "/dashboard");
    const decisionsCard = page.locator('div.rounded-xl:has(h2:has-text("قرارات اللجان المفتوحة"))');
    const overdueCard = page.locator('div.rounded-xl:has(h2:has-text("مهام متأخرة"))');
    // كل قسم يعرض 8 عناصر كحد أقصى — عند تراكم تشغيلات سابقة نقبل رابط «عرض المزيد»
    for (const card of [decisionsCard, overdueCard]) {
      await expect(card).toBeVisible();
      await card.getByText(state.decisionText!).first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      if (await card.getByText(state.decisionText).count()) {
        await expect(card.getByText(state.decisionText).first()).toBeVisible();
      } else {
        await expect(card.getByText(/عرض \d+ عنصراً إضافياً/)).toBeVisible();
      }
    }
    await page.locator(`a[href="/committees/${state.committeeId}/meetings/${state.meetingId}"]`).first().click();
    await page.waitForURL(`**/committees/${state.committeeId}/meetings/${state.meetingId}`);
    await expect(page.getByText("اكتمل الاجتماع واعتمد").first()).toBeVisible();
  });

  test("س4: الأداء الوظيفي — دورة معلم: تخطيط ثم تقييم نهائي بشواهد لكل مؤشر حتى اكتمال الدورة", async ({ page }) => {
    test.setTimeout(420_000);
    page.on("dialog", (d) => void d.accept());
    test.skip(!state.person1Id, "يتطلب أشخاص السيناريو الأول");
    await login(page);

    // دورة جديدة لمعلم هذا التشغيل بالنموذج الرسمي للمعلم والسنة الافتراضية
    await nav(page, "دورات الأداء", "/performance");
    await page.selectOption('select[name="personId"]', state.person1Id!);
    await page.selectOption('select[name="modelId"]', { label: "نموذج تقييم أداء المعلم (رسمي)" });
    await page.getByRole("button", { name: "إنشاء الدورة" }).click();
    await page.waitForURL(/\/performance\/cycles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.cycleId = page.url().split("/").pop()!;
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();

    // جلسة التخطيط: تقييم كل المؤشرات ← إصدار التقرير ← رفع الموقع ← اكتمال
    await page.selectOption('select[name="sessionType"]', "تخطيط");
    await page.locator('form:has(select[name="sessionType"])').locator("#sessionDate-input").fill(todayIso);
    await page.getByRole("button", { name: "إنشاء جلسة" }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await rateAllIndicators(page);
    await issueAndSignSessionReport(page);
    await page.getByRole("button", { name: "اعتماد اكتمال الجلسة" }).click();
    await expect(page.getByText("مكتملة", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // العودة للدورة عبر قائمة الدورات (أحدث دورة أولاً)
    await nav(page, "دورات الأداء", "/performance");
    await page.locator(`a[href="/performance/cycles/${state.cycleId}"]`).first().click();
    await page.waitForURL(`**/performance/cycles/${state.cycleId}`);

    // §5/D-028: بعد جلسة التخطيط فقط (وهي مقيّمة)، نتيجة الدورة تعرض «لم يبدأ التقييم بعد» لا 0٪ —
    // التخطيط لا يُحتسب في أي متوسط أو نسبة، وصفّه في الجدول يبيّن «تخطيط — لا يُحتسب».
    await expect(page.getByText("لم يبدأ التقييم بعد")).toBeVisible();
    await expect(page.getByText("تخطيط — لا يُحتسب").first()).toBeVisible();

    // جلسة التقييم النهائي
    await page.selectOption('select[name="sessionType"]', "نهائي");
    await page.locator('form:has(select[name="sessionType"])').locator("#sessionDate-input").fill(todayIso);
    await page.getByRole("button", { name: "إنشاء جلسة" }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.finalSessionId = page.url().split("/").pop()!;
    await rateAllIndicators(page);

    // ربط شاهد نصي بكل مؤشر عبر لوحة الشواهد (حقل «المؤشر المرتبط»)
    await page.getByRole("button", { name: "رفع شاهد جديد" }).click();
    const evForm = page.locator('form:has(input[name="entityType"])');
    const subKeys = (
      await evForm.locator("#subKey option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
    ).filter((v) => v);
    expect(subKeys.length).toBeGreaterThan(0);
    for (let i = 0; i < subKeys.length; i++) {
      // يعاد تحديد النوع «نص» في كل دورة — النموذج يعاد تركيبه بعد كل حفظ
      await evForm.getByRole("radio", { name: "نص" }).check();
      await evForm.locator("#subKey").selectOption(subKeys[i]);
      await evForm.locator("#title").fill(`شاهد مؤشر ${i + 1} تجريبي آلي ${TAG}`);
      await evForm.locator('select[name="role"]').selectOption("تنفيذ");
      await evForm.locator('textarea[name="textContent"]').fill(`نص شاهد مؤشر ${i + 1} تجريبي آلي ${TAG}`);
      await evForm.getByRole("button", { name: "حفظ الشاهد" }).click();
      await expect(page.getByText(`الشواهد المرتبطة (${i + 1})`)).toBeVisible({ timeout: 20_000 });
    }
    // قائمة التحقق لكل المؤشرات أصبحت ✓ (لا «ينقص شاهد»)
    await expect(page.getByText("ينقص شاهد")).toHaveCount(0);

    // إصدار التقرير ورفع الموقع ثم الإقفال النهائي
    await issueAndSignSessionReport(page);
    await page.getByRole("button", { name: "اعتماد التقييم النهائي" }).click();
    await expect(page.getByText("مقفلة", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // الدورة مكتملة على صفحتها
    await page.goto(`/performance/cycles/${state.cycleId}`);
    await expect(page.getByText("مكتملة", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("الدورة مكتملة — أقفل التقييم النهائي بتقرير موقع.")).toBeVisible();
  });

  test("س5: التوأم الرقمي — نشر المخطط وسجل الغرف وفحص وبلاغ صيانة حتى الإغلاق المتحقق", async ({ page }) => {
    test.setTimeout(300_000);
    page.on("dialog", (d) => void d.accept());
    test.skip(!state.person1Id, "يتطلب أشخاص السيناريو الأول");
    await login(page);

    // محرر الدور الأرضي عبر الواجهة ثم نشر المسودة القائمة
    await nav(page, "مخطط المبنى", "/building");
    await page.getByRole("link", { name: "الدور الأرضي" }).click();
    await page.waitForURL((u) => decodeURIComponent(u.toString()).includes("دور=ground"));
    await page.getByRole("link", { name: "فتح المحرر" }).click();
    await page.waitForURL("**/building/editor/ground");
    // المحرر اليدوي الجديد (Phase 6): تُنشر مسودة الهندسة المبذورة من «سجل نسخ الهندسة»
    const publishBtn = page.getByRole("button", { name: "نشر هذه النسخة" }).first();
    await expect(publishBtn).toBeVisible({ timeout: 30_000 });
    await publishBtn.click(); // حوار التأكيد يُقبل تلقائياً
    await expect(page.locator("span.rounded-full", { hasText: "منشورة" }).first()).toBeVisible({ timeout: 60_000 });

    // سجل الغرف أنشئ برموز KHS-RM — التقط رمز أول غرفة
    await nav(page, "مخطط المبنى", "/building");
    await page.getByRole("link", { name: "الدور الأرضي" }).click();
    await expect(page.getByRole("heading", { name: /غرف الدور الأرضي/ })).toBeVisible({ timeout: 30_000 });
    const code = (await page.locator("tbody tr").first().locator("td").first().textContent())!.trim();
    expect(code).toMatch(/^KHS-RM-\d+/);
    state.roomCode = code;

    // فتح غرفة بالرمز
    await page.fill("#room-code", code);
    await page.getByRole("button", { name: "فتح", exact: true }).click();
    await page.waitForURL(/\/building\/rooms\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.roomId = page.url().split("/").pop()!;

    // «حدّث البيانات»: تعديل الاسم ← حفظ ← تلميح مسودة المخطط
    await page.getByRole("link", { name: "حدّث البيانات" }).click();
    await page.getByRole("button", { name: "تعديل بيانات الغرفة" }).click();
    await page.fill("#nameAr", `غرفة تجريبي آلي ${TAG}`);
    await page.locator("form#edit-room").getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(page.getByText("حُفظت بيانات الغرفة")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("التعديل محفوظ في مسودة المخطط")).toBeVisible({ timeout: 20_000 });

    // قوالب الفحص المرجعية (Phase 3) مُفعّلة مسبقاً كقوالب نظام — «السلامة العامة» يطابق كل الأنواع
    await nav(page, "الفحص والجاهزية", "/building/inspections");
    await expect(page.locator("tr", { hasText: "السلامة العامة" }).first()).toBeVisible({ timeout: 20_000 });

    // العودة للغرفة بالرمز وتنفيذ فحص
    await nav(page, "مخطط المبنى", "/building");
    await page.fill("#room-code", state.roomCode!);
    await page.getByRole("button", { name: "فتح", exact: true }).click();
    await page.waitForURL(`**/building/rooms/${state.roomId}`);
    await page.getByRole("button", { name: "تنفيذ فحص جديد" }).click();
    const insForm = page.locator('form:has(select[name="templateId"])');
    await insForm.locator('input[name="notes"]').fill(`فحص تجريبي آلي ${TAG}`);
    await insForm.getByRole("button", { name: "حفظ الفحص" }).click();
    await expect(page.getByText("سجل الفحص")).toBeVisible({ timeout: 20_000 });

    // بلاغ صيانة من الغرفة نفسها بمكلف من السجل (الصورة اختيارية — تترك)
    state.issueTitle = `عطل تجريبي آلي ${TAG}`;
    await page.getByRole("button", { name: "بلاغ صيانة لهذه الغرفة" }).click();
    const issueForm = page.locator("form#report-issue");
    await issueForm.locator("#title").fill(state.issueTitle);
    await issueForm.locator('select[name="ownerPersonId"]').selectOption(state.person1Id!);
    await issueForm.getByRole("button", { name: "تسجيل البلاغ" }).click();
    await expect(page.getByText(/سجل البلاغ KHS-MNT-/)).toBeVisible({ timeout: 20_000 });

    // صفحة بلاغات الصيانة: البلاغ الجديد «مسودة» والدورة تُدار من صفحة البلاغ (v2.3 §18, D-036)
    await nav(page, "بلاغات الصيانة", "/building/maintenance");
    const row = page.locator("tr", { hasText: state.issueTitle });
    await expect(row.getByText("تجريبي أول مثال")).toBeVisible();
    await expect(row.locator("span.rounded-full", { hasText: "مسودة" })).toBeVisible();
    await row.getByRole("link", { name: "عرض بلاغ الصيانة ←" }).click();
    await page.waitForURL(/\/building\/maintenance\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    // مسودة ← معتمد (زر مباشر بلا نموذج)
    await page.getByRole("button", { name: "اعتماد البلاغ", exact: true }).click();
    await expect(page.getByText("انتقل البلاغ إلى «معتمد»")).toBeVisible({ timeout: 20_000 });

    // معتمد ← تم الإرسال — نموذج بجهة مستلمة إلزامية (التاريخ يفترض اليوم إن تُرك)
    await page.getByRole("button", { name: "تسجيل الإرسال" }).click();
    await page.fill("#sentTo", `جهة صيانة تجريبي آلي ${TAG}`);
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    await expect(page.getByText("انتقل البلاغ إلى «تم الإرسال»")).toBeVisible({ timeout: 20_000 });

    // تم الإرسال ← تحت المعالجة (زر مباشر)
    await page.getByRole("button", { name: "بدء المعالجة" }).click();
    await expect(page.getByText("انتقل البلاغ إلى «تحت المعالجة»")).toBeVisible({ timeout: 20_000 });

    // تحت المعالجة ← تم الإصلاح — نموذج الإجراء المتخذ وملاحظة الإصلاح
    await page.getByRole("button", { name: "تسجيل الإصلاح" }).click();
    await page.fill("#actionTaken", `إجراء تجريبي آلي ${TAG}`);
    await page.fill("#repairNote", `أصلح تجريبي آلي ${TAG}`);
    await page.getByRole("button", { name: "تأكيد", exact: true }).click();
    await expect(page.getByText("انتقل البلاغ إلى «تم الإصلاح»")).toBeVisible({ timeout: 20_000 });

    // تم الإصلاح ← مغلق — الحالة نهائية: شارة «مغلق» ولا أزرار انتقال بعدها
    await page.getByRole("button", { name: "إغلاق البلاغ" }).click();
    await expect(page.locator("span.rounded-full", { hasText: "مغلق" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "إغلاق البلاغ" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "اعتماد البلاغ", exact: true })).toHaveCount(0);

    // تقرير المبنى: الإجراءات المجمّعة (طباعة/تنزيل Word/تنزيل Excel/فتح مسودة بريد) دون تمرير أفقي
    await page.goto("/building/report");
    await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تنزيل Word" })).toBeVisible();
    await expect(page.getByRole("link", { name: "تنزيل Excel" })).toBeVisible();
    await expect(page.getByText("فتح مسودة بريد")).toBeVisible();

    // لوحة مركز العمل: البلاغ المغلق لا يظهر ضمن «بلاغات الصيانة»
    await nav(page, "مركز عمل مدير المدرسة", "/dashboard");
    const maintCard = page.locator('div.rounded-xl:has(h2:has-text("بلاغات الصيانة"))');
    await expect(maintCard).toBeVisible();
    await expect(maintCard.getByText(state.issueTitle)).toHaveCount(0);
  });

  // س6 (المساعد الذكي) حُذف — إزالة وقت تشغيل الذكاء الاصطناعي بالكامل (v2.3 §12, D-035)

  test("س7: حرمة دفعة فارس — تبقى بحالة «معاينة» دون أي مساس", async ({ page }) => {
    await login(page);
    await nav(page, "الاستيراد", "/imports");
    const faresRow = page.locator("tr", { hasText: FARES_FILE });
    await expect(faresRow).toHaveCount(1);
    await expect(faresRow.locator("span.rounded-full", { hasText: "معاينة" })).toBeVisible();
  });
});

// ————————————————————————— الجوال 390×844 —————————————————————————

test.describe("سيناريوهات سير العمل — 390×844", () => {
  test.describe.configure({ mode: "serial" });
  // defaultBrowserType لا يقبل داخل describe — يستبعد من إعدادات الجهاز
  const { defaultBrowserType: _ignored, ...iphone12 } = devices["iPhone 12"];
  test.use({
    ...iphone12,
    viewport: { width: 390, height: 844 },
    locale: "ar-SA",
  });

  async function expectNoOverflow(page: Page, label: string) {
    await page.waitForLoadState("networkidle");
    expect(await pageOverflow(page), `تمرير أفقي في ${label}`).toBeLessThanOrEqual(0);
  }

  test("ج1: مركز العمل يعرض دون تمرير أفقي", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("heading", { name: "مركز عمل مدير المدرسة" })).toBeVisible();
    await expectNoOverflow(page, "/dashboard");
  });

  test("ج2: صفحة دفعة الاستيراد المنفذة من قائمة الدفعات", async ({ page }) => {
    test.skip(!state.peopleBatch1Id, "يتطلب دفعة السيناريو الأول");
    await login(page);
    await page.goto("/imports");
    await expectNoOverflow(page, "/imports");
    await page.locator(`a[href="/imports/${state.peopleBatch1Id}"]`).first().click();
    await page.waitForURL(`**/imports/${state.peopleBatch1Id}`);
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();
    await expect(page.getByText("منفذة", { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page, "/imports/[id]");
  });

  test("ج3: صفحة البرنامج عبر الخطة مع مؤشر المراحل", async ({ page }) => {
    test.skip(!state.programId, "يتطلب برنامج السيناريو الثاني");
    await login(page);
    await page.goto("/plan");
    await expectNoOverflow(page, "/plan");
    await page.locator(`a[href="/plan/${state.programId}"]`).first().click();
    await page.waitForURL(`**/plan/${state.programId}`);
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();
    // البرنامج معتمد من السيناريو الثاني — الحالة «معتمد» تظهر على الجوال دون تمرير أفقي
    await expect(page.getByText("معتمد", { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page, "/plan/[id]");
    // شاشة تقرير البرنامج على الجوال: الإجراءات الأربعة مجمّعة دون تمرير أفقي
    await page.goto(`/plan/${state.programId}/report`);
    await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
    await expect(page.getByText("فتح مسودة بريد")).toBeVisible();
    await expectNoOverflow(page, "/plan/[id]/report");
  });

  test("ج4: المتابعة الأسبوعية — تسجيل متابعة من الجوال (تحديث أسبوع قائم)", async ({ page }) => {
    test.skip(!state.programId, "يتطلب برنامج السيناريو الثاني");
    await login(page);
    await page.goto("/plan/followup");
    await expectNoOverflow(page, "/plan/followup");
    const note = `متابعة جوال تجريبي آلي ${TAG}`;
    await page.fill(`#fu-note-${state.programId}`, note);
    await page.selectOption(`#fu-status-${state.programId}`, "في المسار");
    const card = page.locator("div.rounded-xl", { hasText: state.programName! });
    await card.getByRole("button", { name: "تسجيل المتابعة" }).click();
    // v2.4: يظهر سجل الأسبوع المحفوظ (البطاقة تنتقل لمجموعتها الصادقة)
    await expect(page.getByText(note)).toBeVisible({ timeout: 20_000 });
    await expectNoOverflow(page, "/plan/followup بعد التسجيل");
  });

  test("ج5: صفحتا اللجنة والاجتماع عبر قائمة اللجان", async ({ page }) => {
    test.skip(!state.committeeId || !state.meetingId, "يتطلب لجنة السيناريو الثالث");
    await login(page);
    await page.goto("/committees");
    await expectNoOverflow(page, "/committees");
    await page.locator(`a[href="/committees/${state.committeeId}"]`).first().click();
    await page.waitForURL(`**/committees/${state.committeeId}`);
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();
    await expectNoOverflow(page, "/committees/[id]");
    await page.locator(`a[href="/committees/${state.committeeId}/meetings/${state.meetingId}"]`).first().click();
    await page.waitForURL(`**/meetings/${state.meetingId}`);
    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page, "صفحة الاجتماع");
    // تقرير اللجنة على الجوال: الإجراءات مجمّعة دون تمرير أفقي
    await page.goto(`/committees/${state.committeeId}/report`);
    await expect(page.getByRole("button", { name: "طباعة" })).toBeVisible();
    await expect(page.getByText("فتح مسودة بريد")).toBeVisible();
    await expectNoOverflow(page, "/committees/[id]/report");
  });

  test("ج6: دورة الأداء وجلستها عبر قائمة الدورات", async ({ page }) => {
    test.skip(!state.cycleId || !state.finalSessionId, "يتطلب دورة السيناريو الرابع");
    await login(page);
    await page.goto("/performance");
    await expectNoOverflow(page, "/performance");
    await page.locator(`a[href="/performance/cycles/${state.cycleId}"]`).first().click();
    await page.waitForURL(`**/performance/cycles/${state.cycleId}`);
    await expect(page.getByText("مكتملة", { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page, "صفحة الدورة");
    await page
      .locator(`a[href="/performance/cycles/${state.cycleId}/sessions/${state.finalSessionId}"]`)
      .first()
      .click();
    await page.waitForURL(`**/sessions/${state.finalSessionId}`);
    await expect(page.getByText("مقفلة", { exact: true }).first()).toBeVisible();
    await expectNoOverflow(page, "صفحة الجلسة");
  });

  test("ج7: فتح غرفة بالرمز من صفحة المبنى", async ({ page }) => {
    test.skip(!state.roomCode || !state.roomId, "يتطلب غرفة السيناريو الخامس");
    await login(page);
    await page.goto("/building");
    await expectNoOverflow(page, "/building");
    await page.fill("#room-code", state.roomCode!);
    await page.getByRole("button", { name: "فتح", exact: true }).click();
    await page.waitForURL(`**/building/rooms/${state.roomId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(state.roomCode!);
    await expectNoOverflow(page, "صفحة الغرفة");
  });

  test("ج8: قائمة بلاغات الصيانة تعرض البلاغ المغلق", async ({ page }) => {
    test.skip(!state.issueTitle, "يتطلب بلاغ السيناريو الخامس");
    await login(page);
    await page.goto("/building/maintenance");
    const row = page.locator("tr", { hasText: state.issueTitle! });
    await expect(row.locator("span.rounded-full", { hasText: "مغلق" })).toBeVisible();
    await expect(row.getByText("تم الإصلاح")).toBeVisible();
    await expectNoOverflow(page, "/building/maintenance");
  });
});

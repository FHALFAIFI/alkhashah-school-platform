import { test, expect, devices, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { syntheticPeopleWorkbook, syntheticPlanWorkbook } from "../helpers/fixtures";

/**
 * سيناريوهات سير العمل الشاملة (E2E) — تحاكي عمل مدير المدرسة عبر الوحدات كلها:
 * الاستيراد ← الخطة التشغيلية ← اللجان ← الأداء الوظيفي ← التوأم الرقمي ← المساعد الذكي.
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

  // الموافقة الصريحة مع لوحة الملخص المفصلة
  await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
  await expect(page.getByText("تأكيد التنفيذ — راجع ملخص الدفعة")).toBeVisible();
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
    await expect(page.getByText("تأكيد التنفيذ — راجع ملخص الدفعة")).toBeVisible();
    await page.getByRole("button", { name: "تأكيد التنفيذ", exact: true }).click();
    await expect(page.getByText("منفذة", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // /plan ← فتح البرنامج الأول
    await nav(page, "البرامج والمبادرات", "/plan");
    await expect(page.getByRole("heading", { name: /الخطة التشغيلية/ })).toBeVisible();
    await page.getByRole("link", { name: plan.prog1 }).click();
    await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/);
    state.programId = page.url().split("/").pop()!;

    // مؤشر المراحل + المعالم المشتقة بأوزان مجموعها 100
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible();
    await expect(page.getByText("مجموع الأوزان: 100٪")).toBeVisible();

    // اعتماد البرنامج
    await page.getByRole("button", { name: "اعتماد وإقفال", exact: true }).first().click();
    await expect(page.getByText("معتمد", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // إرفاق شاهد (نوع نص، دور تنفيذ) من لوحة شواهد البرنامج
    await page.getByRole("button", { name: "إضافة شاهد" }).click();
    const evForm = page.locator('form:has(input[name="entityType"])');
    await evForm.locator("#title").fill(`شاهد تنفيذ تجريبي آلي ${TAG}`);
    await evForm.locator('select[name="role"]').selectOption("تنفيذ");
    await evForm.getByRole("radio", { name: "نص" }).check();
    await evForm.locator('textarea[name="textContent"]').fill(`نص شاهد تجريبي آلي ${TAG}`);
    await evForm.getByRole("button", { name: "حفظ الشاهد" }).click();
    await expect(page.getByText("الشواهد المرتبطة (1)")).toBeVisible({ timeout: 20_000 });

    // المتابعة الأسبوعية
    await page.getByRole("link", { name: "المتابعة الأسبوعية", exact: true }).first().click();
    await page.waitForURL("**/plan/followup");
    const fuNote = `متابعة تجريبي آلي ${TAG} — سير منتظم`;
    await page.fill(`#fu-note-${state.programId}`, fuNote);
    await page.selectOption(`#fu-status-${state.programId}`, "في المسار");
    const fuCard = page.locator("div.rounded-xl", { hasText: plan.prog1 });
    await fuCard.getByRole("button", { name: "تسجيل المتابعة" }).click();
    await expect(page.getByText("سجلت المتابعة الأسبوعية")).toBeVisible({ timeout: 20_000 });

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

    // التقرير التنفيذي — يصدر وثيقة PDF برقم
    await nav(page, "التقارير", "/reports");
    await page.getByRole("link", { name: "إصدار", exact: true }).click();
    await page.waitForURL("**/reports/executive");
    await expect(page.getByRole("heading", { name: "الإصدارات السابقة" })).toBeVisible({ timeout: 20_000 });
    const rowsBefore = await page.locator("tbody tr").count();
    await page.getByRole("button", { name: "إصدار التقرير (PDF)" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(rowsBefore + 1, { timeout: 150_000 });
    await expect(page.locator("tbody tr").first().locator("td").first()).toHaveText(/\d{4,}/);
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

    // إضافة رئيس ومقرر من سجل المنسوبين (أشخاص هذا التشغيل حصراً)
    await page.selectOption('select[name="personId"]', state.person1Id!);
    await page.selectOption('select[name="role"]', "رئيس");
    await page.getByRole("button", { name: "إضافة عضو" }).click();
    await expect(page.locator("tr", { hasText: "تجريبي أول مثال" }).getByText("رئيس", { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.selectOption('select[name="personId"]', state.person2Id!);
    await page.selectOption('select[name="role"]', "مقرر");
    await page.getByRole("button", { name: "إضافة عضو" }).click();
    await expect(page.locator("tr", { hasText: "تجريبي ثانٍ مثال" }).getByText("مقرر", { exact: true })).toBeVisible({ timeout: 20_000 });

    // اعتماد التشكيل
    await page.getByRole("button", { name: "اعتماد التشكيل وإقفاله" }).first().click();
    await expect(page.getByText("معتمدة", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // اجتماع جديد
    await page.fill("#title", `اجتماع تجريبي آلي ${TAG}`);
    await page.fill("#meetingDate", todayIso);
    await page.fill("#agenda", "بند تجريبي أول\nبند تجريبي ثانٍ");
    await page.getByRole("button", { name: "إنشاء اجتماع" }).click();
    await page.waitForURL(/\/meetings\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.meetingId = page.url().split("/").pop()!;

    // نتيجة «قرار» تنشئ إجراءً إلزامياً — بمكلف وموعد متأخر (أمس)
    state.decisionText = `قرار تجريبي آلي ${TAG} — متابعة تنفيذ التوصيات`;
    await page.fill("#text", state.decisionText);
    await page.selectOption('select[name="ownerPersonId"]', state.person1Id!);
    await page.fill("#dueDate", yesterdayIso);
    await page.getByRole("button", { name: "تسجيل النتيجة" }).click();
    await expect(page.getByText("سجلت النتيجة")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("tr", { hasText: state.decisionText }).getByText("إلزامي")).toBeVisible();

    // إعادة إدخال نص القرار نفسه ترفض
    await page.fill("#text", state.decisionText);
    await page.getByRole("button", { name: "تسجيل النتيجة" }).click();
    await expect(page.getByText("هذه النتيجة مسجلة مسبقاً في هذا الاجتماع")).toBeVisible({ timeout: 20_000 });

    // إصدار المحضر الرسمي (PDF) ثم رفع المحضر الموقع ثم اعتماد الاكتمال
    await page.getByRole("button", { name: "إصدار المحضر الرسمي (PDF)" }).click();
    await expect(page.getByRole("link", { name: /تنزيل المحضر/ })).toBeVisible({ timeout: 120_000 });
    await page.setInputFiles('input[name="file"]', FAKE_PDF);
    await page.getByRole("button", { name: "رفع", exact: true }).click();
    await expect(page.getByText("✓ المحضر الموقع مرفوع")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "اعتماد الاكتمال" }).first().click();
    await expect(page.getByText("اكتمل الاجتماع واعتمد").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();

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
    await page.locator('form:has(select[name="sessionType"])').locator("#sessionDate").fill(todayIso);
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

    // جلسة التقييم النهائي
    await page.selectOption('select[name="sessionType"]', "نهائي");
    await page.locator('form:has(select[name="sessionType"])').locator("#sessionDate").fill(todayIso);
    await page.getByRole("button", { name: "إنشاء جلسة" }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    state.finalSessionId = page.url().split("/").pop()!;
    await rateAllIndicators(page);

    // ربط شاهد نصي بكل مؤشر عبر لوحة الشواهد (حقل «المؤشر المرتبط»)
    await page.getByRole("button", { name: "إضافة شاهد" }).click();
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
    await page.getByRole("button", { name: "اعتماد وإقفال التقييم النهائي" }).click();
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
    const publishBtn = page.getByRole("button", { name: /^نشر النسخة/ });
    await expect(publishBtn.or(page.getByText("لا مسودة بانتظار النشر"))).toBeVisible({ timeout: 30_000 });
    if (await publishBtn.count()) {
      await publishBtn.click();
      await expect(page.getByText("لا مسودة بانتظار النشر")).toBeVisible({ timeout: 60_000 });
    }

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

    // اعتماد قالب فحص (حوار تأكيد) — «فحص السلامة العام» يطابق كل الأنواع
    await nav(page, "الفحص والجاهزية", "/building/inspections");
    const generalRow = page.locator("tr", { hasText: "فحص السلامة العام" });
    await expect(generalRow).toBeVisible({ timeout: 20_000 });
    if (await generalRow.getByRole("button", { name: "اعتماد" }).count()) {
      await generalRow.getByRole("button", { name: "اعتماد" }).click();
      await expect(generalRow.locator("span.rounded-full", { hasText: "معتمد" })).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(generalRow.locator("span.rounded-full", { hasText: "معتمد" })).toBeVisible();
    }

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

    // صفحة الصيانة: البلاغ بالمكلف ← قيد الإصلاح ← تم الإصلاح ← مغلق ومتحقق
    await nav(page, "الصيانة", "/building/maintenance");
    const row = page.locator("tr", { hasText: state.issueTitle });
    await expect(row.getByText("تجريبي أول مثال")).toBeVisible();

    await row.locator('select[name="status"]').selectOption("قيد الإصلاح");
    await row.getByRole("button", { name: "حفظ" }).click();
    await expect(row.locator("span.rounded-full", { hasText: "قيد الإصلاح" })).toBeVisible({ timeout: 20_000 });

    await row.locator('select[name="status"]').selectOption("تم الإصلاح");
    await row.locator('input[name="repairNote"]').fill(`أصلح تجريبي آلي ${TAG}`);
    await row.getByRole("button", { name: "حفظ" }).click();
    await expect(row.locator("span.rounded-full", { hasText: "تم الإصلاح" })).toBeVisible({ timeout: 20_000 });

    await row.locator('select[name="status"]').selectOption("مغلق ومتحقق");
    await row.getByRole("button", { name: "حفظ" }).click(); // حوار التأكيد يقبل تلقائياً
    await expect(row.locator("span.rounded-full", { hasText: "مغلق ومتحقق" })).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('select[name="status"]')).toHaveCount(0);

    // لوحة مركز العمل: البلاغ المغلق لا يظهر ضمن «بلاغات الصيانة»
    await nav(page, "مركز عمل مدير المدرسة", "/dashboard");
    const maintCard = page.locator('div.rounded-xl:has(h2:has-text("بلاغات الصيانة"))');
    await expect(maintCard).toBeVisible();
    await expect(maintCard.getByText(state.issueTitle)).toHaveCount(0);
  });

  test("س6: المساعد الذكي — دخول سياقي من صفحة البرنامج بمقترحات عربية", async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!state.programId, "يتطلب برنامج السيناريو الثاني");
    await login(page);

    await nav(page, "البرامج والمبادرات", "/plan");
    await page.locator(`a[href="/plan/${state.programId}"]`).first().click();
    await page.waitForURL(`**/plan/${state.programId}`);
    await expect(page.getByLabel("مراحل سير العمل")).toBeVisible({ timeout: 20_000 });

    const contextual = page.getByRole("link", { name: "اسأل المساعد" });
    if ((await contextual.count()) === 0) {
      // لا مدخل سياقي — الذكاء الاصطناعي غير متاح لهذا المستخدم
      await expect(contextual).toHaveCount(0);
      test.skip(true, "المدخل السياقي للمساعد غير ظاهر (الصلاحية/الإعداد) — تخطٍّ مقصود دون تفعيل يدوي");
    }
    await contextual.click();
    await page.waitForURL("**/assistant?**");
    expect(decodeURIComponent(page.url())).toContain("نوع=program");
    expect(decodeURIComponent(page.url())).toContain(`معرف=${state.programId}`);

    if (await page.getByText("المساعد معطل حالياً").count()) {
      test.skip(true, "المساعد معطل في الإعدادات — لا يفعل آلياً من الاختبار");
    }
    await expect(page.getByText("السياق:")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "افحص اكتمال شواهد هذا البرنامج" })).toBeVisible();
    await expect(page.getByRole("button", { name: "لخّص حالة هذا البرنامج" })).toBeVisible();
  });

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
    await expectNoOverflow(page, "/plan/[id]");
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
    await expect(page.getByText("سجلت المتابعة الأسبوعية")).toBeVisible({ timeout: 20_000 });
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
    await expect(row.locator("span.rounded-full", { hasText: "مغلق ومتحقق" })).toBeVisible();
    await expectNoOverflow(page, "/building/maintenance");
  });
});

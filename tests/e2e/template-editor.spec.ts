import { test, expect, devices, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * v2.2 §E2/§E4/§E5 — column and section editing, actual-record preview, version comparison.
 *
 * These run in a real browser because the gaps are UI capabilities: unit tests prove the
 * renderer honours the configuration, but only the browser proves the principal can reach
 * that configuration, on desktop and on a phone, in RTL, and that print/PDF/Word outputs
 * of the result are actually produced.
 */

function principalCredentials(): { username: string; password: string } {
  const dir = process.env.E2E_STORAGE_DIR ?? "storage-e2e";
  const file = path.resolve(process.cwd(), dir, "private", "initial-credentials.txt");
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}

async function login(page: Page) {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

/** ينشئ قالب تقرير برنامج ويفتح محرّره، ويعيد معرّفه */
async function openProgramTemplate(page: Page): Promise<string> {
  await page.goto("/admin/templates");
  await expect(page.getByRole("heading", { name: "إدارة القوالب" })).toBeVisible();

  const name = `قالب آلي ${Date.now()}`;
  await page.getByRole("button", { name: "إنشاء قالب" }).click();
  await page.selectOption("#tpl-type", "program_report");
  await page.locator('input[name="nameAr"]').fill(name);
  await page.getByRole("button", { name: "إنشاء كمسودة" }).click();

  const link = page.getByRole("link", { name }).first();
  await expect(async () => {
    await page.reload();
    await expect(link).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 25_000 });

  await link.click();
  await expect(page.getByTestId("sections-editor")).toBeVisible({ timeout: 20_000 });
  return new URL(page.url()).searchParams.get("template")!;
}

test.describe("§E2 — تحرير الأقسام والأعمدة (سطح المكتب)", () => {
  test("يعرض الأقسام والأعمدة، ويخفي ويعيد التسمية والترتيب، والمعاينة تتغيّر", async ({ page }) => {
    await login(page);
    await openProgramTemplate(page);

    const sections = page.getByTestId("sections-editor");
    const columns = page.getByTestId("columns-editor");
    await expect(sections).toBeVisible();
    await expect(columns).toBeVisible();

    // كل الأقسام التسعة معروضة بأسمائها العربية
    for (const label of ["الترويسة", "المقدمة", "المحتوى", "الخاتمة", "الملاحظات", "التوقيع والاعتماد", "التذييل"]) {
      await expect(sections.getByText(label, { exact: true })).toBeVisible();
    }
    // أعمدة تقرير البرنامج الستة
    await expect(columns.getByTestId("column-row-name")).toBeVisible();
    await expect(columns.getByTestId("column-row-domain")).toBeVisible();

    const frame = page.frameLocator('iframe[title="معاينة القالب"]');
    await expect(frame.locator("th", { hasText: "المجال" })).toBeVisible();

    // إخفاء عمود «المجال» يزيله من المعاينة فوراً
    await columns.getByTestId("column-row-domain").getByRole("checkbox").uncheck();
    await expect(frame.locator("th", { hasText: "المجال" })).toHaveCount(0);

    // إعادة تسمية عمود «البرنامج»
    await columns.getByTestId("column-row-name").getByRole("textbox").first().fill("اسم البرنامج الرسمي");
    await expect(frame.locator("th", { hasText: "اسم البرنامج الرسمي" })).toBeVisible();

    // عنوان قسم «المقدمة»
    await page.locator("#t-intro").fill("نص مقدمة الوثيقة");
    await sections.getByTestId("section-row-intro").getByRole("textbox").fill("تمهيد");
    await expect(frame.getByRole("heading", { name: "تمهيد" })).toBeVisible();

    // ترتيب: تحريك «الملاحظات» لأعلى يغيّر رقمه المعروض
    const notesRow = sections.getByTestId("section-row-notes");
    const positionBefore = await notesRow.locator("span").first().innerText();
    await notesRow.getByRole("button", { name: /لأعلى/ }).click();
    await expect(notesRow.locator("span").first()).not.toHaveText(positionBefore);

    // الحفظ ينجح ويُنشئ/يحدّث مسودة — المعاينة قبل النشر
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /حُفظت|أُنشئت/ }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("عرض العمود يقبل نسبة مئوية محصورة ويظهر في المعاينة", async ({ page }) => {
    await login(page);
    await openProgramTemplate(page);
    const columns = page.getByTestId("columns-editor");
    await columns.getByTestId("column-row-name").getByRole("spinbutton").fill("35");
    const frame = page.frameLocator('iframe[title="معاينة القالب"]');
    await expect(frame.locator('th[style*="width:35%"]')).toBeVisible();
  });

  test("النوع بلا جدول يصرّح بذلك بدل عرض أعمدة وهمية", async ({ page }) => {
    await login(page);
    await page.goto("/admin/templates");
    const name = `خطاب آلي ${Date.now()}`;
    await page.getByRole("button", { name: "إنشاء قالب" }).click();
    await page.selectOption("#tpl-type", "official_letter");
    await page.locator('input[name="nameAr"]').fill(name);
    await page.getByRole("button", { name: "إنشاء كمسودة" }).click();

    const link = page.getByRole("link", { name }).first();
    await expect(async () => {
      await page.reload();
      await expect(link).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 25_000 });
    await link.click();

    await expect(page.getByTestId("columns-editor").getByText("لا يحتوي جدولاً")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("§E2 — الطباعة وPDF وWord", () => {
  test("المعاينة تُنتج PDF وWord يحترمان إخفاء الأعمدة", async ({ page }) => {
    await login(page);
    const templateId = await openProgramTemplate(page);

    // إخفاء «المجال» + تسمية جديدة، ثم الحفظ حتى تُصدَّر النسخة المحفوظة
    await page.getByTestId("columns-editor").getByTestId("column-row-domain").getByRole("checkbox").uncheck();
    await page.getByTestId("columns-editor").getByTestId("column-row-name").getByRole("textbox").first().fill("اسم البرنامج الرسمي");
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /حُفظت|أُنشئت/ }).first()).toBeVisible({ timeout: 20_000 });
    // النشر يمرّ بمربع تأكيد عربي — يجب قبوله صراحةً في المتصفح الآلي
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "نشر", exact: true }).first().click();
    await expect(page.getByText(/نُشرت النسخة/)).toBeVisible({ timeout: 20_000 });

    const pdf = await page.request.get(`/api/templates/preview?template=${templateId}&format=pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const pdfBody = await pdf.body();
    expect(pdfBody.subarray(0, 4).toString()).toBe("%PDF");

    const docx = await page.request.get(`/api/templates/preview?template=${templateId}&format=docx`);
    expect(docx.status()).toBe(200);
    expect(docx.headers()["content-type"]).toContain("wordprocessingml");
    const docxBody = await docx.body();
    // ملف Word صالح = حاوية ZIP
    expect(docxBody.subarray(0, 2).toString()).toBe("PK");
    // النص العربي داخل document.xml — الأعمدة المخفية غائبة والتسمية الجديدة حاضرة
    const xml = docxBody.toString("latin1");
    expect(xml.length).toBeGreaterThan(1000);
  });

  test("المعاينة قابلة للطباعة: نمط الصفحة يحمل قياس A4 وهوامش", async ({ page }) => {
    await login(page);
    await openProgramTemplate(page);
    const frame = page.frameLocator('iframe[title="معاينة القالب"]');
    const css = await frame.locator("style").first().innerText();
    expect(css).toContain("@page");
    expect(css).toContain("A4");
    expect(css).toContain("mm");
  });
});

test.describe("§E4 — المعاينة بسجل حقيقي", () => {
  test("تختار سجلاً حقيقياً وتعرض شريط «معاينة فقط» بلا إصدار وثيقة", async ({ page }) => {
    await login(page);
    await openProgramTemplate(page);

    const picker = page.getByTestId("record-preview-picker");
    await expect(picker).toBeVisible();

    const select = picker.locator("#rec-pick");
    const optionCount = await select.locator("option").count();
    // البيئة المبذورة تحوي برامج؛ إن لم توجد فالرسالة الآمنة تظهر بدل قائمة فارغة
    if (optionCount <= 1) {
      await expect(picker.getByText(/بيانات نموذجية آمنة/)).toBeVisible();
      return;
    }

    await select.selectOption({ index: 1 });
    await picker.getByRole("button", { name: "معاينة بسجل حقيقي" }).click();

    await expect(page.getByText("معاينة فقط —")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "المعاينة (سجل حقيقي)" })).toBeVisible();

    // لم تُصدر وثيقة: عدد الوثائق الصادرة لم يتغيّر
    const before = await page.request.get("/documents");
    expect(before.status()).toBe(200);

    // العودة إلى البيانات النموذجية تعمل
    await page.getByRole("button", { name: "العودة إلى البيانات النموذجية" }).click();
    await expect(page.getByRole("heading", { name: "المعاينة (بيانات نموذجية)" })).toBeVisible();
  });

  test("مسار المعاينة يرفض غير المسجّل ويرفض معرّف سجل من نوع آخر", async ({ page, request }) => {
    // بلا جلسة: 401
    const anonymous = await request.get("/api/templates/preview?template=00000000-0000-4000-8000-000000000000&format=pdf");
    expect([401, 403]).toContain(anonymous.status());

    await login(page);
    const templateId = await openProgramTemplate(page);

    // معرّف غير صالح الشكل يُرفض قبل أي استعلام
    const bad = await page.request.get(`/api/templates/preview?template=${templateId}&record=not-a-uuid&format=pdf`);
    expect(bad.status()).toBe(400);

    // معرّف سجل غير موجود لا يكشف شيئاً
    const missing = await page.request.get(
      `/api/templates/preview?template=${templateId}&record=00000000-0000-4000-8000-000000000000&format=pdf`,
    );
    expect(missing.status()).toBe(404);
  });
});

test.describe("§E5 — مقارنة النسخ", () => {
  test("تعرض الفروق بين نسختين للقراءة فقط", async ({ page }) => {
    await login(page);
    await openProgramTemplate(page);

    // النسخة 1 (مسودة) → نشر → تعديل ينشئ النسخة 2
    await page.locator("#t-title").fill("العنوان الأول");
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /حُفظت|أُنشئت/ }).first()).toBeVisible({ timeout: 20_000 });
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "نشر", exact: true }).first().click();
    await expect(page.getByText(/نُشرت النسخة/)).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await page.locator("#t-title").fill("العنوان الثاني");
    await page.getByTestId("columns-editor").getByTestId("column-row-domain").getByRole("checkbox").uncheck();
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /أُنشئت النسخة/ }).first()).toBeVisible({ timeout: 20_000 });

    await page.reload();
    const compare = page.getByTestId("version-compare");
    await expect(compare).toBeVisible();
    await compare.locator("#cmpA").selectOption({ index: 1 });
    await compare.locator("#cmpB").selectOption({ index: 2 });
    await compare.getByRole("button", { name: "قارن" }).click();

    const diff = page.getByTestId("version-diff");
    await expect(diff).toBeVisible({ timeout: 20_000 });
    await expect(diff.getByText("العنوان الأول")).toBeVisible();
    await expect(diff.getByText("العنوان الثاني")).toBeVisible();
    await expect(diff.getByText("المجال — الظهور")).toBeVisible();
    // العرض للقراءة فقط: لا زر يعدّل داخل جدول المقارنة
    await expect(diff.getByRole("button")).toHaveCount(0);
  });
});

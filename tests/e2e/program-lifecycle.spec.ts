import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * سير عمل البرنامج ثلاثي الحالات عبر الواجهة الحقيقية (التصحيح التشغيلي — القضية 2):
 * «قيد التنفيذ» ← تعليم كمكتمل ← «مكتمل» ← إقفال نهائي ← «مغلق» (قراءة فقط)
 * ← إعادة فتح ← «مكتمل» ← إعادة للتنفيذ ← «قيد التنفيذ» — مع سجل تحولات كامل
 * ومرشّحات القائمة وعدم تكرار التاريخ من النقر المتكرر.
 */

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

const PROGRAM_NAME = "برنامج دورة الحالات الآلي";

// إنشاء البرنامج يفترض سنة تخطيطية نشطة؛ عند تشغيل الملف منفرداً (قبل مواصفة استيراد
// الخطة) تُبذر سنة اختبار مباشرة في قاعدة madrasa_test المعزولة — كما تفعل بذرة الواجهة.
test.beforeAll(async () => {
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";
  const pool = new Pool({ connectionString: url, max: 1 });
  const { rows } = await pool.query("SELECT id FROM plan_years WHERE status = 'نشطة' LIMIT 1");
  if (rows.length === 0) {
    await pool.query(
      "INSERT INTO plan_years (key, name_ar, status) VALUES ('e2e-lifecycle', 'سنة اختبار دورة البرنامج', 'نشطة')",
    );
  }
  await pool.end();
});

test("الدورة الكاملة: إنشاء ← اكتمال ← إقفال (قراءة فقط) ← إعادة فتح ← إعادة للتنفيذ", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("dialog", (d) => void d.accept());
  await login(page);

  // 1) إنشاء برنامج قيد التنفيذ
  await page.goto("/plan");
  await page.getByRole("button", { name: "إضافة برنامج" }).click();
  await page.locator('input[name="name"]').fill(PROGRAM_NAME);
  await page.getByRole("button", { name: "حفظ البرنامج" }).click();
  await expect(page.getByRole("status").filter({ hasText: "أُضيف البرنامج" })).toBeVisible({ timeout: 20_000 });
  await page.goto("/plan");
  await page.getByRole("link", { name: PROGRAM_NAME }).first().click();
  await page.waitForURL(/\/plan\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  const programUrl = page.url();

  // بطاقة الحالة: قيد التنفيذ والإجراء المتاح هو التعليم كمكتمل
  const stateCard = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: "حالة البرنامج" }) }).first();
  await expect(stateCard).toContainText("قيد التنفيذ");
  await expect(stateCard).toContainText("تعليم البرنامج كمكتمل");

  // 2) تعليم كمكتمل — بلا شاهد ولا مالية ولا ملاحظة (كل الحقول اختيارية فارغة).
  // نجاح الفعل يعيد عرض البطاقة بالحالة الجديدة (النموذج يُستبدل) — التحقق بالحالة الناتجة.
  await page.getByRole("button", { name: "تعليم البرنامج كمكتمل" }).click();
  await expect(page.getByText("هذا البرنامج مكتمل")).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("هذا البرنامج مكتمل")).toBeVisible({ timeout: 20_000 });
  await expect(stateCard).toContainText("تاريخ الاكتمال");
  // البرنامج المكتمل يبقى قابلاً للتحرير
  await expect(page.getByRole("heading", { name: "تحديث تقدم البرنامج وحالته" })).toBeVisible();
  // سجل التحولات: صف «اكتمال»
  await expect(stateCard.getByText("اكتمال").first()).toBeVisible();

  // 3) الإقفال النهائي بملاحظة فارغة (اختيارية)
  await page.getByRole("button", { name: "إقفال البرنامج نهائياً" }).click();
  await expect(page.getByText("هذا البرنامج مغلق نهائياً — للقراءة فقط ومرفوع من القوائم التشغيلية")).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("هذا البرنامج مغلق نهائياً — للقراءة فقط ومرفوع من القوائم التشغيلية")).toBeVisible({ timeout: 20_000 });
  await expect(stateCard).toContainText("تاريخ الإقفال");
  // قراءة فقط: نموذج تحديث التقدم مختفٍ، ولا زر إضافة شاهد
  await expect(page.getByRole("heading", { name: "تحديث تقدم البرنامج وحالته" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "تعليم البرنامج كمكتمل" })).toHaveCount(0);
  // الشواهد تبقى معروضة للاطلاع والسجل كامل
  await expect(page.getByRole("heading", { name: "شواهد البرنامج" })).toBeVisible();
  // تقرير البرنامج ما يزال متاحاً (عرض/طباعة/تصدير)
  await expect(page.getByRole("link", { name: "تقرير البرنامج" })).toBeVisible();

  // 4) القوائم: يختفي من الجدول التشغيلي ويظهر في «البرامج المغلقة» ومرشّح «مغلق»
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: /البرامج المغلقة/ })).toBeVisible({ timeout: 20_000 });
  const closedSection = page.locator("section", { has: page.getByRole("heading", { name: /البرامج المغلقة/ }) });
  await expect(closedSection.getByRole("link", { name: PROGRAM_NAME })).toBeVisible();
  // مرشّح «قيد التنفيذ» لا يعرضه
  await page.getByRole("link", { name: /^قيد التنفيذ \(/ }).click();
  await page.waitForURL((u) => decodeURIComponent(u.toString()).includes("حالة=قيد التنفيذ"));
  await expect(page.getByRole("link", { name: PROGRAM_NAME })).toHaveCount(0);
  // مرشّح «مغلق» يعرضه
  await page.getByRole("link", { name: /^مغلق \(/ }).click();
  await page.waitForURL((u) => decodeURIComponent(u.toString()).includes("حالة=مغلق"));
  await expect(page.getByRole("link", { name: PROGRAM_NAME }).first()).toBeVisible();

  // وفي تقرير «البرامج المغلقة» من مركز التقارير
  await page.goto("/reports?category=plan&report=programs-closed");
  await expect(page.getByText(PROGRAM_NAME).first()).toBeVisible({ timeout: 20_000 });

  // 5) إعادة الفتح تعيده «مكتملاً» لا «قيد التنفيذ»
  await page.goto(programUrl);
  await page.getByRole("button", { name: "إعادة فتح البرنامج" }).click();
  await expect(page.getByText("هذا البرنامج مكتمل")).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("هذا البرنامج مكتمل")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("هذا البرنامج مغلق نهائياً", { exact: false })).toHaveCount(0);
  // التحرير عاد متاحاً
  await expect(page.getByRole("heading", { name: "تحديث تقدم البرنامج وحالته" })).toBeVisible();

  // 6) إعادة للتنفيذ: مكتمل ← قيد التنفيذ
  await page.getByRole("button", { name: "إعادة البرنامج للتنفيذ" }).click();
  await expect(page.getByText("هذا البرنامج مكتمل")).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await expect(stateCard).toContainText("قيد التنفيذ");
  await expect(page.getByText("هذا البرنامج مكتمل")).toHaveCount(0);

  // 7) سجل التحولات كامل بالترتيب — أربعة صفوف لا أكثر (لا تكرار من النقرات)
  const historyItems = stateCard.locator("ul > li");
  await expect(historyItems).toHaveCount(4);
  await expect(stateCard).toContainText("إعادة للتنفيذ");
  await expect(stateCard).toContainText("إعادة فتح");
  await expect(stateCard).toContainText("إقفال");
  await expect(stateCard).toContainText("اكتمال");
});

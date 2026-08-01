import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * v2.4 — ملاحظات ما بعد القبول (الجولة السادسة):
 * تمرير القائمة الجانبية وثبات موضعها وطي أقسامها، حذف/أرشفة نماذج الأداء،
 * طابور «بانتظار اعتماد المدير» مع الاعتماد من الصفحة الرئيسة، صدق المتابعة الأسبوعية،
 * وبطاقات المتبقي الجديدة في الميزانية.
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

test("القائمة الجانبية: تمرير مستقل يبقى محفوظاً أثناء التنقل وبعد التحديث، والأقسام قابلة للطي وتتذكر حالتها", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);

  const aside = page.locator("aside");
  await expect(aside).toBeVisible();

  // التمرير والمؤشر فوق القائمة نفسها — الحاوية مستقلة عن تمرير الصفحة
  await aside.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => aside.evaluate((el) => el.scrollTop), { timeout: 5_000 })
    .toBeGreaterThan(50);
  const scrolled = await aside.evaluate((el) => el.scrollTop);

  // التنقل لعنصر أسفل القائمة لا يعيد الموضع إلى الأعلى
  await aside.getByRole("link", { name: "النسخ الاحتياطي", exact: true }).click();
  await page.waitForURL("**/admin/backup");
  const afterNav = await aside.evaluate((el) => el.scrollTop);
  expect(afterNav).toBeGreaterThan(50);

  // بعد تحديث كامل يُسترجع الموضع من تخزين الجلسة (± تمرير أدنى لإظهار العنصر النشط)
  await page.reload();
  await expect
    .poll(async () => page.locator("aside").evaluate((el) => el.scrollTop), { timeout: 10_000 })
    .toBeGreaterThan(50);
  // العنصر النشط يبقى ظاهراً داخل نطاق القائمة المرئي
  const activeVisible = await page.locator('aside a[aria-current="page"]').evaluate((el, args) => {
    const aside = el.closest("aside")!;
    const a = el.getBoundingClientRect();
    const b = aside.getBoundingClientRect();
    void args;
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  }, scrolled);
  expect(activeVisible).toBe(true);

  // طي قسم «عام» يخفي روابطه، والحالة تُتذكّر بعد التنقل والتحديث
  await page.locator('aside details[data-nav-section="general"] > summary').click();
  await expect(page.locator("aside").getByRole("link", { name: "المهام والإجراءات", exact: true })).toBeHidden();
  await page.locator("aside").getByRole("link", { name: "الإشعارات", exact: true }).isHidden();
  await page.reload();
  await expect
    .poll(async () => page.locator('aside details[data-nav-section="general"]').evaluate((el) => (el as HTMLDetailsElement).open), {
      timeout: 10_000,
    })
    .toBe(false);
  // إعادة فتحه حتى لا تتأثر بقية الفحوصات
  await page.locator('aside details[data-nav-section="general"] > summary').click();
  await expect(page.locator("aside").getByRole("link", { name: "المهام والإجراءات", exact: true })).toBeVisible();
});

test("نماذج الأداء: حذف نهائي لنموذج غير مستخدم، وأرشفة نموذج مع ظهوره في مرشح الأرشيف واستعادته", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  // إنشاء نموذج تجريبي غير مستخدم
  await page.goto("/performance/models");
  await page.fill('input[name="nameAr"]', "نموذج حذف تجريبي v24");
  await page.getByRole("button", { name: "إنشاء", exact: true }).click();
  await page.waitForURL("**/performance/models/**", { timeout: 20_000 });

  // بطاقة الإدارة تعرض السجلات المرتبطة وخيار الحذف لغير المستخدم
  await expect(page.getByRole("heading", { name: "إدارة النموذج" })).toBeVisible();
  await expect(page.getByText("غير مرتبط بأي تقييم")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف النموذج" }).click();
  // بعد الحذف يُعاد التوجيه لقائمة النماذج (لا نجاح صامت) والنموذج غير موجود فيها
  await page.waitForURL("**/performance/models", { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "نموذج حذف تجريبي v24" })).toHaveCount(0);

  // أرشفة نموذج آخر ثم استعادته من مرشح الأرشيف
  await page.fill('input[name="nameAr"]', "نموذج أرشفة تجريبي v24");
  await page.getByRole("button", { name: "إنشاء", exact: true }).click();
  await page.waitForURL("**/performance/models/**", { timeout: 20_000 });
  await page.fill('input[name="reason"]', "أرشفة تجريبية للجولة السادسة");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "أرشفة النموذج" }).click();
  // بعد الأرشفة يعاد تصيير الصفحة بلافتة الأرشفة (نموذج الأرشفة يُستبدل بزر الاستعادة)
  await expect(page.getByText(/النموذج مؤرشف منذ/)).toBeVisible({ timeout: 15_000 });

  await page.goto("/performance/models");
  const archiveSection = page.locator("details", { hasText: "النماذج المؤرشفة" });
  await expect(archiveSection).toBeVisible();
  await archiveSection.locator("summary").click();
  await archiveSection.getByRole("link", { name: "نموذج أرشفة تجريبي v24" }).click();
  await expect(page.getByText(/النموذج مؤرشف منذ/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "استعادة النموذج" }).click();
  await expect(page.getByText(/النموذج مؤرشف منذ/)).toBeHidden({ timeout: 15_000 });
});

test("طابور «بانتظار اعتماد المدير»: برنامج جديد يظهر في الصفحة الرئيسة ويُعتمد منها مباشرة، ثم يظهر بصدق في المتابعة الأسبوعية", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  // إنشاء برنامج مسودة من صفحة الخطة
  await page.goto("/plan");
  await page.getByRole("button", { name: "إضافة برنامج" }).click();
  await page.fill('input[name="name"]', "برنامج طابور الاعتماد v24");
  await page.fill('input[name="domain"]', "بيئة تجريبية");
  await page.getByRole("button", { name: "حفظ البرنامج" }).click();
  await expect(page.getByText(/أُضيف البرنامج/).first()).toBeVisible({ timeout: 15_000 });

  // الطابور في الصفحة الرئيسة: القائمة الافتراضية «برامج جديدة بانتظار الاعتماد»
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "بانتظار اعتماد المدير" })).toBeVisible({ timeout: 20_000 });
  const queueCard = page.locator("section", { has: page.getByRole("heading", { name: "بانتظار اعتماد المدير" }) });
  await expect(queueCard.getByRole("link", { name: /برنامج طابور الاعتماد v24/ })).toBeVisible();

  // اعتماد مباشر من الصفحة الرئيسة — يخرج من قائمة الجديد فوراً
  const row = queueCard
    .locator("div.justify-between")
    .filter({ hasText: "برنامج طابور الاعتماد v24" })
    .first();
  await row.getByRole("button", { name: "اعتماد", exact: true }).click();
  await expect
    .poll(async () => queueCard.getByRole("link", { name: /برنامج طابور الاعتماد v24/ }).count(), { timeout: 20_000 })
    .toBe(0);

  // المتابعة الأسبوعية: البرنامج المعتمد الجديد ضمن مجموعة «لم يبدأ» — لا «مكتمل» بغير حق
  await page.goto("/plan/followup");
  await expect(page.getByText("(الحالي)")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^لم يبدأ/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /برنامج طابور الاعتماد v24/ })).toBeVisible();
});

test("الميزانية: بطاقتا «بنود قاربت الاستنفاد» و«عمليات بلا مبلغ مُدخل» ظاهرتان في الملخص", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto("/budget");
  await expect(page.getByText("بنود قاربت الاستنفاد")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("عمليات بلا مبلغ مُدخل")).toBeVisible();
  await expect(page.getByText("إجمالي المتبقي")).toBeVisible();
});

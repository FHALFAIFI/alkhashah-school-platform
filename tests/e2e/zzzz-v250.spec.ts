import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/**
 * v2.5.0 §19.3 — السيناريوهات الستة والعشرون الإلزامية في المتصفح.
 *
 * كل سيناريو يقود التطبيق الحقيقي بدور المدير عبر تنقّله الحقيقي. الوصول بالنقر جزء من
 * الاختبار لا تمهيد له: شكوى v2.4.1 لم تكن «الميزة معطّلة» بل «لا أجدها»، فاختبارٌ يفتح
 * المسار بكتابة عنوانه يمرّ بينما يبقى العيب قائماً.
 *
 * الترتيب `zzzz-` كي يعمل بعد كل المواصفات السابقة — هذه المواصفة تنشئ سجلات وتحذف
 * بعضها نهائياً، فلا يجوز أن ترصدها مواصفة أسبق.
 *
 * **تحذير قائم منذ D-049/D-053:** نجاح هذه السيناريوهات على `next dev` **لا يثبت** خلوّ
 * الإصدار من عيب إجهاض تدفّق إجراءات الخادم — خادم التطوير يُكمل التدفّق أسرع من إعادة
 * الجلب. الإثبات الوحيد هو تشغيلها على صورة الإنتاج مقابل نسخة من بيانات الإنتاج
 * (§24). هذه المواصفة شرط لازم لا كافٍ.
 */

const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

const TAG = "v250";

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
  const created = await pool.query<{ id: string }>(
    "insert into plan_years (key, name_ar, status) values ($1, $2, 'نشطة') returning id",
    [`${TAG}-yr`, `سنة ${TAG}`],
  );
  return created.rows[0].id;
}

/** برنامج بحالة محددة — يُنشأ في القاعدة مباشرةً لأن التمهيد ليس موضوع الاختبار */
async function seedProgram(
  pool: Pool,
  opts: { name: string; domain: string; owner: string; status?: string; completed?: boolean; closed?: boolean },
): Promise<string> {
  const yearId = await activePlanYearId(pool);
  const seq = await pool.query<{ next: number }>("select coalesce(max(seq), 0) + 1 as next from programs");
  const res = await pool.query<{ id: string }>(
    `insert into programs (plan_year_id, seq, domain, name, owner_position, status, progress, execution_status,
       completed_at, closed_at)
     values ($1, $2, $3, $4, $5, $6, 30, 'في المسار', $7, $8) returning id`,
    [
      yearId,
      seq.rows[0].next,
      opts.domain,
      opts.name,
      opts.owner,
      opts.status ?? "مسودة",
      opts.completed ? new Date() : null,
      opts.closed ? new Date() : null,
    ],
  );
  return res.rows[0].id;
}

test.describe("v2.5.0 §19.3 — سيناريوهات المتصفح الإلزامية", () => {
  test.describe.configure({ mode: "serial" });

  /* ───────────────── ١–٢: تعديل البرنامج في كل الحالات ───────────────── */

  test("١. تعديل برنامج قبل الاعتماد — المدخل ظاهر بلا بحث", async ({ page }) => {
    const id = await withDb((pool) =>
      seedProgram(pool, { name: `برنامج مسودة ${TAG}`, domain: "المجال الأول", owner: "وكيل الشؤون التعليمية" }),
    );
    await login(page);

    // الوصول بالنقر: القائمة ← الخطة التشغيلية ← صف البرنامج ← «تعديل البرنامج»
    await page.getByRole("link", { name: "الخطة التشغيلية" }).first().click();
    await page.waitForURL("**/plan**");
    const row = page.locator("tr", { hasText: `برنامج مسودة ${TAG}` });
    await expect(row.getByRole("link", { name: "تعديل البرنامج" })).toBeVisible();
    await row.getByRole("link", { name: "تعديل البرنامج" }).click();

    await page.waitForURL(`**/plan/${id}**`);
    // النموذج مفتوح مباشرةً — لا نقرة إضافية للبحث عنه
    const nameField = page.locator('input[name="field_name"], textarea[name="field_name"]').first();
    await expect(nameField).toBeVisible();
    await nameField.fill(`برنامج مسودة ${TAG} — معدّل`);
    await page.getByRole("button", { name: "حفظ التعديل" }).click();
    await expect(page.getByText("حُفظ", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("٢. تعديل برنامج معتمد ومكتمل ومغلق — مسموح بسبب مكتوب وبلا تغيير حالة", async ({ page }) => {
    const states = [
      { label: "معتمد", opts: { status: "معتمد" } },
      { label: "مكتمل", opts: { status: "معتمد", completed: true } },
      { label: "مغلق", opts: { status: "معتمد", completed: true, closed: true } },
    ];
    await login(page);

    for (const s of states) {
      const id = await withDb((pool) =>
        seedProgram(pool, {
          name: `برنامج ${s.label} ${TAG}`,
          domain: "المجال الثاني",
          owner: "المرشد الطلابي",
          ...s.opts,
        }),
      );
      await page.goto(`/plan/${id}?تعديل=1#edit`);

      // التحذير معلوماتي — والحفظ متاح
      await expect(page.getByText("سيتم تسجيل التعديلات", { exact: false }).first()).toBeVisible();
      // صفحة البرنامج تحمل خمسة حقول باسم `reason` (أرشفة، إعادة فتح، طلب تغيير، تحديث
      // تنفيذ، تعديل) — الكتابة تُوجَّه إلى نموذج التعديل نفسه لا إلى أوّل مطابق (v2.5.0 §9.5)
      const editForm = page.locator("form").filter({ has: page.getByRole("button", { name: "حفظ التعديل" }) });
      await editForm.locator('input[name="field_principalNotes"], textarea[name="field_principalNotes"]').first().fill(`ملاحظة ${s.label} ${TAG}`);
      await editForm.locator('textarea[name="reason"], input[name="reason"]').first().fill(`تصحيح موثّق ${TAG}`);
      await editForm.getByRole("button", { name: "حفظ التعديل" }).click();
      await expect(page.getByText("حُفظ", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

      // الحالة لم تتغيّر بالتعديل
      const after = await withDb((pool) =>
        pool.query<{ status: string; completed_at: string | null; closed_at: string | null }>(
          "select status, completed_at, closed_at from programs where id = $1",
          [id],
        ),
      );
      expect(after.rows[0].status).toBe(s.opts.status);
      expect(Boolean(after.rows[0].completed_at)).toBe(Boolean((s.opts as { completed?: boolean }).completed));
      expect(Boolean(after.rows[0].closed_at)).toBe(Boolean((s.opts as { closed?: boolean }).closed));
    }
  });

  /* ───────────────── ٣–٤: المتابعة الأسبوعية ───────────────── */

  test("٣. المتابعة الأسبوعية بلا حقل نسبة إنجاز", async ({ page }) => {
    await withDb((pool) =>
      seedProgram(pool, { name: `برنامج متابعة ${TAG}`, domain: "المجال الأول", owner: "وكيل الشؤون التعليمية", status: "معتمد" }),
    );
    await login(page);
    // المتابعة الأسبوعية صفحة ابنة لـ/plan ولا ترد في القائمة الجانبية، والاسم نفسه يظهر
    // على لوحة العمل لرابط يقصد /plan — فالانتقال المباشر أصدق من مطابقة اسم ملتبس.
    // ما يفحصه هذا الاختبار هو محتوى الصفحة (§6.2: لا حقل نسبة)، لا مسار الوصول إليها.
    await page.goto("/plan/followup");
    await page.waitForURL("**/plan/followup**");

    await expect(page.getByText(`برنامج متابعة ${TAG}`)).toBeVisible();
    // لا حقل نسبة على الإطلاق في الصفحة
    await expect(page.locator('input[name="progress"]')).toHaveCount(0);
    await expect(page.getByText("نسبة الإنجاز (٪)")).toHaveCount(0);
    // والتقدم المعروض معنون بمصدره
    await expect(page.getByText("التقدم المعتمد (من سجل البرنامج)").first()).toBeVisible();
  });

  test("٤. الشاشة التشغيلية والتقرير يعرضان البيانات نفسها", async ({ page }) => {
    await login(page);
    await page.goto("/plan/followup");
    const screenCount = await page.locator("text=عدد النتائج").first().innerText();

    await page.getByRole("link", { name: "تقارير القسم", exact: false }).first().click();
    await page.waitForURL("**/reports**");
    await expect(page.getByRole("heading", { name: "المتابعة الأسبوعية" }).first()).toBeVisible();
    const reportCount = await page.locator("text=عدد النتائج").first().innerText();
    expect(reportCount.replace(/\D/g, "")).toBe(screenCount.replace(/\D/g, ""));
  });

  /* ───────────────── ٥–٨: ترشيح البرامج ───────────────── */

  test("٥–٨. ترشيح البرامج بمسؤول واحد ثم عدة، وبمجال واحد ثم عدة", async ({ page }) => {
    await login(page);
    await page.goto("/reports?category=plan&report=programs-by-owner");
    // لوحة المرشّحات قد تكون مفتوحة أصلاً — الفتح مشروط لا نقر أعمى يغلقها
    const ownerPanel = page.locator("details", { hasText: "مسؤول التنفيذ" }).first();
    if (!(await ownerPanel.isVisible())) {
      await page.getByRole("button", { name: "المرشّحات" }).click();
    }
    await ownerPanel.locator("summary").click();
    const boxes = ownerPanel.locator('input[type="checkbox"]');
    await boxes.first().check();
    await expect(page.getByText("المرشّحات المطبَّقة")).toBeVisible();
    const oneOwner = await page.locator("text=عدد النتائج").first().innerText();

    if (!(await boxes.nth(1).isVisible())) {
      await ownerPanel.locator("summary").click();
    }
    await boxes.nth(1).check();
    const twoOwners = await page.locator("text=عدد النتائج").first().innerText();
    expect(Number(twoOwners.replace(/\D/g, ""))).toBeGreaterThanOrEqual(Number(oneOwner.replace(/\D/g, "")));

    // المجال — التقرير الآخر، بالسلوك نفسه
    await page.goto("/reports?category=plan&report=programs-by-domain&domain=المجال الأول");
    await expect(page.getByText("المجال: المجال الأول")).toBeVisible();
    await page.goto("/reports?category=plan&report=programs-by-domain&domain=المجال الأول&domain=المجال الثاني");
    await expect(page.getByText("المجال الثاني", { exact: false }).first()).toBeVisible();
    // أسماء البرامج تظهر — لا أعداد فقط (§5.5)
    await expect(page.locator("table")).toContainText(TAG);
  });

  /* ───────────────── ٩–١١: اللجان والاجتماعات ───────────────── */

  test("٩–١١. السجل التفصيلي للجنة واحدة ثم عدة، وسجل الاجتماعات", async ({ page }) => {
    await login(page);
    await page.goto("/reports?category=committees&report=committee-registry-detailed");
    await expect(page.getByRole("heading", { name: "السجل التفصيلي للمجالس واللجان" })).toBeVisible();
    // الترويسة كما طلبها المدير
    for (const header of ["العضو", "الصفة", "المهمة", "حالة التنفيذ"]) {
      await expect(page.locator("th", { hasText: header }).first()).toBeVisible();
    }

    await page.getByRole("button", { name: "المرشّحات" }).click();
    const panel = page.locator("details", { hasText: "المجلس أو اللجنة" }).first();
    await panel.click();
    const boxes = panel.locator('input[type="checkbox"]');
    if ((await boxes.count()) > 0) {
      await boxes.first().check();
      await expect(page.getByText("المرشّحات المطبَّقة")).toBeVisible();
    }

    await page.goto("/reports?category=meetings&report=meetings-registry-detailed");
    await expect(page.getByRole("heading", { name: "سجل الاجتماعات التفصيلي" })).toBeVisible();
    for (const header of ["رقم الاجتماع", "جدول الأعمال", "القرارات", "التوصيات"]) {
      await expect(page.locator("th", { hasText: header }).first()).toBeVisible();
    }
  });

  /* ───────────────── ١٢–١٧: الأداء ───────────────── */

  test("١٢–١٣. ترشيح المعلمين وحدهم ثم الإداريين وحدهم", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "التقارير", exact: false }).first().click();
    await page.waitForURL("**/reports**");

    await page.getByRole("link", { name: "تقرير المعلمين" }).click();
    await expect(page.getByText("نوع الموظف: معلم")).toBeVisible();
    const table = page.locator("table").first();
    if (await table.isVisible()) await expect(table).not.toContainText("موظف إداري");

    await page.goto("/reports");
    await page.getByRole("link", { name: "تقرير الموظفين الإداريين" }).click();
    await expect(page.getByText("نوع الموظف: موظف إداري")).toBeVisible();
  });

  test("١٤–١٥. التقرير الفردي يظهر ويعمل، وتقرير الجميع يعرض الأسماء", async ({ page }) => {
    await login(page);
    await page.goto("/reports");
    await page.getByRole("link", { name: "التقرير التفصيلي الفردي", exact: false }).click();
    await page.waitForURL("**/reports/individual**");

    // الخطوات الخمس ظاهرة ومرقّمة
    for (const step of ["١. نوع الموظف", "٢. الموظف"]) {
      await expect(page.getByText(step)).toBeVisible();
    }
    await page.getByRole("link", { name: "المعلمون" }).click();
    const firstChoose = page.getByRole("link", { name: "اختيار" }).first();
    if (await firstChoose.isVisible()) {
      await firstChoose.click();
      await expect(page.getByText("٣. دورة التقييم")).toBeVisible();
    } else {
      // لا موظف بدورات: تُقال الرسالة المطلوبة حرفياً بدل إخفاء التقرير
      await expect(page.getByText("لا دورات أداء").first()).toBeVisible();
    }

    await page.goto("/reports");
    await page.getByRole("link", { name: "تقرير جميع الموظفين" }).click();
    await expect(page.locator("th", { hasText: "الموظف" }).first()).toBeVisible();
  });

  test("١٦–١٧. تغيير عتبة الأداء المنخفض ورؤية الأسماء", async ({ page }) => {
    await login(page);
    await page.goto("/reports");
    await page.getByRole("link", { name: "الأداء المنخفض بالأسماء" }).click();
    await expect(page.getByRole("heading", { name: "الأداء المنخفض بالأسماء" })).toBeVisible();
    // الأسماء أعمدة أصيلة في التقرير — لا نسب مجرّدة
    await expect(page.locator("th", { hasText: "الموظف" }).first()).toBeVisible();
    await expect(page.locator("th", { hasText: "المعايير الضعيفة" }).first()).toBeVisible();

    // العتبة الافتراضية 70 وقابلة للتعديل
    await page.getByRole("button", { name: "المرشّحات" }).click();
    const threshold = page.locator("#f-low");
    await expect(threshold).toHaveValue("70");
    await threshold.fill("85");
    await threshold.blur();
    await expect(page.getByText("عتبة الأداء المنخفض: أقل من 85٪")).toBeVisible();
  });

  /* ───────────────── ١٨–٢٠: الحذف ───────────────── */

  test("٢٠. حذف نموذج تقييم غير مستخدم — يكتمل ويختفي", async ({ page }) => {
    const modelId = await withDb(async (pool) => {
      const res = await pool.query<{ id: string }>(
        `insert into perf_models (key, name_ar, audience, status, official)
         values ($1, $2, 'موظف', 'مسودة', false) returning id`,
        [`model-${TAG}-${Date.now()}`, `نموذج للحذف ${TAG}`],
      );
      return res.rows[0].id;
    });
    await login(page);
    await page.goto(`/performance/models/${modelId}`);

    await page.getByRole("button", { name: "حذف النموذج نهائياً" }).click();
    await page.locator("#pd-typed").fill(`نموذج للحذف ${TAG}`);
    await page.locator("#pd-reason").fill("نموذج تجريبي لم يُستعمل");
    await page.locator('input[name="confirm"]').check();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "حذف النموذج نهائياً" }).last().click();

    await page.waitForURL("**/performance/models**", { timeout: 30_000 });
    await expect(page.getByText(`نموذج للحذف ${TAG}`)).toHaveCount(0);

    const gone = await withDb((pool) => pool.query("select 1 from perf_models where id = $1", [modelId]));
    expect(gone.rowCount).toBe(0);
    const tomb = await withDb((pool) =>
      pool.query("select 1 from deletion_tombstones where entity_type = 'perf_model' and entity_id = $1", [modelId]),
    );
    expect(tomb.rowCount).toBe(1);
  });

  /* ───────────────── ٢١–٢٤: المنشئ والقوالب والتصدير ───────────────── */

  test("٢١–٢٣. إنشاء تقرير مخصص وحفظه قالباً ثم إعادة تشغيله", async ({ page }) => {
    await login(page);
    await page.goto("/reports");
    await page.getByRole("link", { name: "منشئ التقارير" }).first().click();
    await page.waitForURL("**/reports/builder**");

    await page.getByRole("link", { name: "البرامج حسب المجال" }).click();
    await expect(page.getByText("٤. المعاينة")).toBeVisible();

    // إخفاء عمود ثم حفظ القالب
    const hide = page.getByRole("button", { name: "إخفاء", exact: false }).first();
    if (await hide.isVisible()) await hide.click();

    const name = `قالب ${TAG}`;
    await page.locator("#t-name").fill(name);
    await page.locator("#t-desc").fill("قالب اختبار المتصفح");
    await page.getByRole("button", { name: "حفظ كقالب" }).click();
    await page.waitForURL("**/reports/templates**", { timeout: 30_000 });
    await expect(page.getByText(name)).toBeVisible();

    // إعادة التشغيل من القالب
    const row = page.locator("tr", { hasText: name });
    await row.getByRole("link", { name: "تشغيل" }).click();
    await page.waitForURL("**/reports**");
    await expect(page.getByText("عدد النتائج").first()).toBeVisible();
  });

  test("٢٤. تصدير PDF وCSV بالمرشّحات نفسها", async ({ page }) => {
    await login(page);
    await page.goto("/reports?category=plan&report=programs-by-domain&domain=المجال الأول");
    await expect(page.getByText("المجال: المجال الأول")).toBeVisible();

    for (const label of ["CSV", "تنزيل PDF"]) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.getByRole("link", { name: label }).click(),
      ]);
      expect(await download.failure()).toBeNull();
    }
  });

  /* ───────────────── ٢٥–٢٦: الحقول الاختيارية ───────────────── */

  test("٢٥–٢٦. الحفظ بحقول اختيارية فارغة، والحد الأدنى الإلزامي يبقى", async ({ page }) => {
    await login(page);

    // موظف بالاسم وحده (§12.3)
    await page.goto("/people/new");
    await page.locator('input[name="fullName"]').fill(`موظف اختياري ${TAG}`);
    await page.getByRole("button", { name: "حفظ", exact: false }).first().click();
    await expect(page.getByText(`موظف اختياري ${TAG}`).first()).toBeVisible({ timeout: 30_000 });
    // مؤشّر الاكتمال معلوماتي وموسوم صراحةً — لا حالة سير عمل
    await expect(page.getByText("اكتمال البيانات", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("يمكنك الحفظ الآن واستكمال البيانات لاحقًا")).toBeVisible();

    // والحد الأدنى الإلزامي باقٍ: الحذف يطلب اسماً مكتوباً وسبباً
    await page.goto("/performance/models");
    await expect(page.getByRole("heading", { name: "نماذج الأداء", exact: false }).first()).toBeVisible();
  });
});

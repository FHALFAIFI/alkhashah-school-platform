import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { synthetic52PeopleWorkbook } from "../helpers/fixtures";

/**
 * تقوية تأكيد الاستيراد عبر الواجهة الحقيقية على الجوال (390×844):
 * - تأكيد ناجح يُنشئ 52 شخصاً بالضبط وحدثَي تدقيق (بدء + تنفيذ) واحدَين فقط.
 * - إعادة تحميل الصفحة بعد التنفيذ تُظهر النتيجة المنفذة دون إعادة محاولة ودون تكرار.
 * تعمل على قاعدة madrasa_test المعزولة فقط.
 */

test.use({ viewport: { width: 390, height: 844 }, locale: "ar-SA" });

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEST_DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

function principalCredentials(): { username: string; password: string } {
  const file = path.resolve(process.env.E2E_STORAGE_DIR ?? "storage", "private/initial-credentials.txt");
  const content = readFileSync(file, "utf8");
  const line = content.split("\n").find((l) => l.includes("principal"))!;
  return { username: "principal", password: line.split("كلمة المرور المؤقتة:")[1].trim() };
}

async function login(page: Page) {
  const creds = principalCredentials();
  await page.goto("/login");
  await page.fill("#username", creds.username);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL("**/dashboard");
}

test("تأكيد الاستيراد على الجوال: 52 شخصاً بالضبط + حدث تنفيذ واحد + إعادة التحميل لا تُكرِّر", async ({ page }) => {
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  let batchId = "";
  try {
    await login(page);

    // رفع دفعة 52 صفاً جاهزاً عبر الواجهة
    await page.goto("/imports/new?type=people");
    await page.setInputFiles("#file", { name: "commit-52.xlsx", mimeType: XLSX_MIME, buffer: await synthetic52PeopleWorkbook() });
    await page.getByRole("button", { name: "تحليل ومعاينة" }).click();
    await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    batchId = page.url().split("/").pop()!;

    // لا صفوف مراجعة — الملخص يعرض 52 صفاً جاهزاً
    await page.getByRole("button", { name: "موافقة صريحة وتنفيذ الاستيراد" }).click();
    await expect(page.getByText("تأكيد استيراد بيانات الموظفين")).toBeVisible();
    await expect(page.locator("li", { hasText: "عدد الصفوف الجاهزة" })).toContainText("52");

    // زر التنفيذ حاضر بالنص الصحيح قبل النقر
    const execBtn = page.getByRole("button", { name: "تأكيد التنفيذ", exact: true });
    await expect(execBtn).toBeVisible();
    await execBtn.click();

    // النجاح: تظهر بطاقة «تم الاستيراد»
    await expect(page.getByText("تم الاستيراد", { exact: true })).toBeVisible({ timeout: 30_000 });

    // 52 شخصاً بالضبط أُنشئوا لهذه الدفعة
    const peopleCount = await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId]);
    expect(peopleCount.rows[0].c).toBe(52);

    // حدث «بدء التنفيذ» واحد و«تنفيذ» واحد بالضبط (لا ازدواج)
    const started = await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_commit_started'", [batchId]);
    const committed = await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_committed'", [batchId]);
    expect(started.rows[0].c).toBe(1);
    expect(committed.rows[0].c).toBe(1);

    // إعادة تحميل الصفحة (محاكاة استجابة ضائعة ثم إعادة تحميل): تُظهر «منفذة» ولا تُنشئ مكرراً
    await page.goto(`/imports/${batchId}`);
    await expect(page.getByText("منفذة", { exact: true }).first()).toBeVisible();
    // لا زر «تأكيد التنفيذ» بعد الآن (الدفعة لم تعد «معاينة») → لا إعادة محاولة
    await expect(page.getByRole("button", { name: "تأكيد التنفيذ", exact: true })).toHaveCount(0);
    const peopleAfterReload = await pool.query("SELECT count(*)::int c FROM people WHERE import_batch_id=$1", [batchId]);
    expect(peopleAfterReload.rows[0].c).toBe(52);
    const committedAfter = await pool.query("SELECT count(*)::int c FROM audit_log WHERE entity_id=$1 AND action='import.batch_committed'", [batchId]);
    expect(committedAfter.rows[0].c).toBe(1);
  } finally {
    // تنظيف: أزل الأشخاص والدفعة التي أنشأها هذا الاختبار فقط
    if (batchId) {
      await pool.query("DELETE FROM people WHERE import_batch_id=$1", [batchId]);
      await pool.query("DELETE FROM import_batches WHERE id=$1", [batchId]);
    }
    await pool.end();
  }
});

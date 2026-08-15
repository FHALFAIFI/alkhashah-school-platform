import { defineConfig } from "@playwright/test";
import path from "node:path";

// اختبارات الواجهة تعمل على قاعدة الاختبار المعزولة ومنفذ مخصص لا يشارك خادم التطوير.
const E2E_PORT = Number(process.env.E2E_PORT ?? 3081);
const E2E_STORAGE_DIR = path.resolve(process.cwd(), "storage-e2e");
const TEST_DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

// يتيح لملفات الاختبار قراءة بيانات الاعتماد من مجلد التخزين المعزول
process.env.E2E_STORAGE_DIR = E2E_STORAGE_DIR;

// E2E_EXTERNAL=1: لا يُشغّل Playwright خادماً؛ يفترض خادم إنتاج (next start) مُشغَّلاً مسبقاً
// على APP_URL ببيئة الاختبار — يتفادى بطء الترجمة اللحظية في next dev فتصبح النتائج حتمية.
const EXTERNAL = process.env.E2E_EXTERNAL === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  /*
   * في CI يُضاف تقرير JSON إلى السطر: عدّ «تخطّي ٨» في السجل لا يقول أيّها تخطّى ولا لماذا،
   * وشرط الجاهزية أن يكون كل تخطٍّ مُسمّى ومُبرَّراً. الملف يُرفَع مع مُرفَق التقرير.
   */
  reporter: process.env.CI
    ? [["line"], ["json", { outputFile: "playwright-report/results.json" }]]
    : "list",
  use: {
    baseURL: process.env.APP_URL ?? `http://localhost:${E2E_PORT}`,
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
  },
  webServer: EXTERNAL
    ? undefined
    : {
        // خادم معزول: بيئة اختبار + قاعدة madrasa_test + تخزين مخصص + منفذ مستقل.
        // MADRASA_ENV=test يفعّل حارس الأمان (fail-closed) فيرفض أي قاعدة حقيقية.
        // MADRASA_INCLUDE_SYNTHETIC=1: بيانات السيناريو اصطناعية بالتصميم ويجب أن تظهر
        // في اللوحات للتحقق من سير العمل — استبعاد الاصطناعي يبقى مفعّلاً في التطوير/الإنتاج.
        // STORAGE_DIR نسبي (storage-e2e) لتفادي الفراغ/الفاصلة العليا في المسار المطلق للمستودع.
        // AI_ENABLED=true: أولاما المحلي شغّال في هذه البيئة (يثبته فحص الاتصال الحي في
        // assistant.spec) فتظهر مرساة المساعد. LOGIN_RATE_LIMIT_PER_MIN عالٍ حتى لا تُفعّل
        // عمليات الدخول المتتابعة عبر المجموعة محددَ المعدل (الإنتاج يبقى على 10).
        command: `MADRASA_ENV=test MADRASA_INCLUDE_SYNTHETIC=1 LOGIN_RATE_LIMIT_PER_MIN=1000 DATABASE_URL=${TEST_DB_URL} STORAGE_DIR=storage-e2e npx next dev -p ${E2E_PORT}`,
        url: `http://localhost:${E2E_PORT}`,
        // لا تُعِد استخدام خادم قائم — قد يكون خادم التطوير على القاعدة الحقيقية
        reuseExistingServer: false,
        timeout: 120_000,
      },
});

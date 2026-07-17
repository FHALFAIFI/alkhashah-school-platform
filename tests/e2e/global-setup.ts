import { execSync } from "node:child_process";
import path from "node:path";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * مهيّئ Playwright — يضمن أن اختبارات الواجهة تعمل على قاعدة الاختبار المعزولة فقط.
 * ينشئ قاعدة madrasa_test ويطبّق الهجرات ويبذر البيانات الإنتاجية في مجلد تخزين
 * مخصص (storage-e2e)، ثم يهيّئ دفعة فارس البديلة الاصطناعية لبيئة الاختبار.
 * خادم الاختبار يعمل بـ MADRASA_ENV=test فيرفض حارس الأمان أي قاعدة حقيقية.
 */
export default async function globalSetup(): Promise<void> {
  await ensureTestDb();

  // قاعدة الاختبار مشتركة مع Vitest — نظّفها لقاعدة أساس حتمية قبل بذرة الواجهة
  const pool = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  await truncateAll(pool);
  await pool.end();

  const e2eStorage = path.resolve(process.cwd(), "storage-e2e");
  const env = {
    ...process.env,
    MADRASA_ENV: "test",
    DATABASE_URL: TEST_DB_URL,
    STORAGE_DIR: e2eStorage,
  };

  // بذرة إنتاجية معزولة (idempotent) — تكتب بيانات الاعتماد في storage-e2e
  execSync("npx tsx src/db/seed.ts", { env, stdio: "pipe" });
  // دفعة فارس بديلة اصطناعية بحالة «معاينة» لسيناريو حرمة الدفعة (بلا بيانات حقيقية)
  execSync("npx tsx scripts/e2e-fixtures.ts", { env, stdio: "pipe" });
}

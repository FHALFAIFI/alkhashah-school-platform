import { Pool } from "pg";
import { execSync } from "node:child_process";
import { assertNonProduction } from "./assert-non-production";

const ADMIN_URL = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa";
// اسم القاعدة قابل للتبديل لتشغيل حزم متوازية معزولة — الحارس يفرض لاحقة _test دائماً
const TEST_DB_NAME = process.env.MADRASA_TEST_DB?.trim() || "madrasa_test";
export const TEST_DB_URL = `postgresql://madrasa:madrasa_dev@localhost:5544/${TEST_DB_NAME}`;

/** ينشئ قاعدة اختبار معزولة ويطبق الهجرات — لا يلمس قاعدة التطوير */
export async function ensureTestDb(): Promise<void> {
  // حارس أمان يفشل مغلقاً قبل أي اتصال: يرفض التشغيل إن استُهدف الإنتاج (بفحص القيم الفعلية)
  assertNonProduction("ensureTestDb", TEST_DB_URL);
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME.replace(/[^a-z0-9_]/g, "")}`);
  }
  await admin.end();
  execSync("npx tsx src/db/migrate.ts", {
    env: { ...process.env, MADRASA_ENV: "test", DATABASE_URL: TEST_DB_URL },
    stdio: "pipe",
  });
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%')
      LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}

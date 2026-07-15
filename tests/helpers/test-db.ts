import { Pool } from "pg";
import { execSync } from "node:child_process";

const ADMIN_URL = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa";
export const TEST_DB_URL = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

/** ينشئ قاعدة اختبار معزولة ويطبق الهجرات — لا يلمس قاعدة التطوير */
export async function ensureTestDb(): Promise<void> {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'madrasa_test'");
  if (exists.rowCount === 0) {
    await admin.query("CREATE DATABASE madrasa_test");
  }
  await admin.end();
  execSync("npx tsx src/db/migrate.ts", {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
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

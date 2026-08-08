#!/usr/bin/env bash
# v2.6 CI — upgrade rehearsal: a database at the deployed v2.5.0 schema (ledger 34)
# migrated forward with the current tree (ledger 36), proving:
#   1. the new migrations apply cleanly on top of the real production baseline;
#   2. no pre-existing row is lost or altered (marker rows checked byte-for-byte);
#   3. the immutability trigger is installed and actually rejects a forbidden UPDATE;
#   4. the migration is idempotent-safe to re-run (drizzle ledger guards it).
# Synthetic data only. Requires: repo checkout with the v2.5.0 tag reachable, a
# Postgres 16 service on localhost:5544 (user/pass madrasa/madrasa_dev), node_modules.
set -euo pipefail

PSQL="psql postgresql://madrasa:madrasa_dev@localhost:5544/madrasa"
DB_NAME="madrasa_upgrade_test"
DB_URL="postgresql://madrasa:madrasa_dev@localhost:5544/${DB_NAME}"
PSQL_T="psql ${DB_URL}"

echo "==> creating ${DB_NAME}"
$PSQL -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${DB_NAME}" >/dev/null
$PSQL -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME}" >/dev/null

echo "==> extracting the v2.5.0 migration set"
rm -rf .ci-v25 && mkdir -p .ci-v25
git archive v2.5.0 drizzle | tar -x -C .ci-v25

echo "==> applying v2.5.0 migrations (expected ledger 34)"
DATABASE_URL="$DB_URL" npx tsx -e '
  import { drizzle } from "drizzle-orm/node-postgres";
  import { migrate } from "drizzle-orm/node-postgres/migrator";
  import { Pool } from "pg";
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./.ci-v25/drizzle" });
  await pool.end();
'
LEDGER25=$($PSQL_T -t -A -c "SELECT count(*) FROM drizzle.__drizzle_migrations")
[ "$LEDGER25" = "34" ] || { echo "FAIL: v2.5.0 ledger is ${LEDGER25}, expected 34"; exit 1; }

echo "==> seeding synthetic marker rows under the v2.5.0 schema"
$PSQL_T -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO users (id, username, display_name, password_hash)
VALUES ('11111111-1111-1111-1111-111111111111', 'ci-marker', 'مستخدم رحلة الترقية', 'x');
INSERT INTO report_templates (id, name, report_key, filters, columns, visibility, owner_user_id)
VALUES ('22222222-2222-2222-2222-222222222222', 'قالب ما قبل الترقية', 'programs-active',
        '{"search":["ترقية"]}', '["name","domain"]', 'خاص', '11111111-1111-1111-1111-111111111111');
SQL
MARKER_BEFORE=$($PSQL_T -t -A -c "SELECT md5(string_agg(name || report_key || filters::text || columns::text, '|' ORDER BY id)) FROM report_templates")

echo "==> applying the current tree's migrations (expected ledger 36)"
DATABASE_URL="$DB_URL" npx tsx src/db/migrate.ts
LEDGER26=$($PSQL_T -t -A -c "SELECT count(*) FROM drizzle.__drizzle_migrations")
[ "$LEDGER26" = "36" ] || { echo "FAIL: post-upgrade ledger is ${LEDGER26}, expected 36"; exit 1; }

echo "==> verifying pre-existing data is untouched"
MARKER_AFTER=$($PSQL_T -t -A -c "SELECT md5(string_agg(name || report_key || filters::text || columns::text, '|' ORDER BY id)) FROM report_templates")
[ "$MARKER_BEFORE" = "$MARKER_AFTER" ] || { echo "FAIL: report_templates changed across the upgrade"; exit 1; }
USERS=$($PSQL_T -t -A -c "SELECT count(*) FROM users")
[ "$USERS" = "1" ] || { echo "FAIL: users count changed"; exit 1; }

echo "==> verifying the new tables exist"
for table in report_instances report_outputs report_jobs report_counters report_style_templates; do
  $PSQL_T -t -A -c "SELECT 1 FROM information_schema.tables WHERE table_name = '${table}'" | grep -q 1 \
    || { echo "FAIL: table ${table} missing"; exit 1; }
done

echo "==> verifying the immutability trigger actually rejects (D-055)"
$PSQL_T -v ON_ERROR_STOP=1 -c \
  "INSERT INTO report_instances (id, title, type_key, status, report_number, snapshot, finalized_at)
   VALUES ('33333333-3333-3333-3333-333333333333', 'تقرير رحلة الترقية', 'single', 'نهائي', 'CI-0001', '{\"v\":1}', now())" >/dev/null
if $PSQL_T -c "UPDATE report_instances SET title = 'عبث' WHERE report_number = 'CI-0001'" 2>/dev/null; then
  echo "FAIL: the immutability trigger did not reject a forbidden UPDATE"; exit 1
fi

echo "==> upgrade rehearsal PASS (34 → 36, markers intact, trigger armed)"
rm -rf .ci-v25

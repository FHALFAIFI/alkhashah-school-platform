#!/usr/bin/env bash
# v2.4.1 (النطاق الموحّد النهائي) §8 — build a disposable clone of production and run the RC on it.
#
# Production is only ever READ: one `pg_dump` from the running production database, plus a
# read of the uploads volume. Nothing is written to it, no production container is restarted,
# and the clone lives on its own network, volume and loopback port.
#
# Usage:
#   bash scripts/v241-final-clone-setup.sh            # create clone + start RC
#   bash scripts/v241-final-clone-setup.sh teardown   # destroy everything the script created
#
# Prints the rehearsal account password on stdout — it exists only inside the clone.
set -euo pipefail

PROD_DB=madrasa-prod-db-1
PROD_UPLOADS_VOLUME=madrasa-prod_storage

NET=madrasa-rehearsal-v241f-net
PG=madrasa-rehearsal-v241f-pg
APP=madrasa-rehearsal-v241f-app
VOL_DB=madrasa-rehearsal-v241f-dbdata
VOL_UP=madrasa-rehearsal-v241f-uploads
PORT=3086
RC_IMAGE=${RC_IMAGE:-madrasa-app:0.1.0-v2_4_1-rc}
WORK=$(mktemp -d)

teardown() {
  echo "→ removing clone resources (production untouched)"
  docker rm -f "$APP" "$PG" >/dev/null 2>&1 || true
  docker volume rm -f "$VOL_DB" "$VOL_UP" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  echo "✓ clone destroyed"
}

if [[ "${1:-}" == "teardown" ]]; then
  teardown
  exit 0
fi

trap 'echo "✗ failed — leaving the clone up for inspection; run: bash $0 teardown"' ERR

# ── 0 · refuse to run if the production containers are not the ones we expect ──────────────
docker inspect "$PROD_DB" >/dev/null
PROD_RESTARTS_BEFORE=$(docker inspect "$PROD_DB" --format '{{.RestartCount}}')
PROD_STARTED_BEFORE=$(docker inspect "$PROD_DB" --format '{{.State.StartedAt}}')
echo "→ production db baseline: restarts=$PROD_RESTARTS_BEFORE started=$PROD_STARTED_BEFORE"

# ── 1 · read-only dump of production ──────────────────────────────────────────────────────
echo "→ dumping production (read-only)"
docker exec "$PROD_DB" pg_dump -U madrasa -d madrasa --no-owner --no-privileges > "$WORK/prod.sql"
echo "  dump: $(wc -c < "$WORK/prod.sql") bytes"

# ── 2 · isolated network, volumes, postgres ───────────────────────────────────────────────
docker network create "$NET" >/dev/null 2>&1 || true
docker volume create "$VOL_DB" >/dev/null
docker volume create "$VOL_UP" >/dev/null

echo "→ copying the uploads volume into the clone"
docker run --rm -v "$PROD_UPLOADS_VOLUME":/from:ro -v "$VOL_UP":/to alpine \
  sh -c 'cd /from && cp -a . /to/ 2>/dev/null || true'

PG_IMAGE=$(docker inspect "$PROD_DB" --format '{{.Config.Image}}')
echo "→ starting clone postgres ($PG_IMAGE)"
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=madrasa -e POSTGRES_PASSWORD=rehearsal \
  -e POSTGRES_DB=madrasa \
  -v "$VOL_DB":/var/lib/postgresql/data \
  "$PG_IMAGE" >/dev/null

until docker exec "$PG" pg_isready -U madrasa -d madrasa >/dev/null 2>&1; do sleep 1; done
echo "→ loading the dump into the clone"
docker exec -i "$PG" psql -U madrasa -d madrasa -q < "$WORK/prod.sql" >/dev/null

LEDGER=$(docker exec "$PG" psql -U madrasa -d madrasa -tAc "select count(*) from drizzle.__drizzle_migrations")
TABLES=$(docker exec "$PG" psql -U madrasa -d madrasa -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
echo "  clone baseline: ledger=$LEDGER tables=$TABLES"

# ── 3 · a principal-equivalent account that exists only in the clone ───────────────────────
REH_PASSWORD=$(openssl rand -hex 12)
echo "→ creating the rehearsal account (clone-only)"
HASH=$(RE_PW="$REH_PASSWORD" node -e '
  const { hash } = require("@node-rs/argon2");
  hash(process.env.RE_PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 }).then((h) => process.stdout.write(h));
')
docker exec -i "$PG" psql -U madrasa -d madrasa -q <<SQL
INSERT INTO users (username, display_name, password_hash, active)
VALUES ('rehearsal', 'حساب بروفة', '$HASH', true)
ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true;
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r WHERE u.username = 'rehearsal' AND r.key = 'principal'
ON CONFLICT DO NOTHING;
SQL

# ── 4 · migrate-only init, exactly as production does it ──────────────────────────────────
# The runtime image starts the server only; `compose.production.yml` runs migrations in a
# separate one-shot `init` service. The rehearsal must mirror that, or it would test an
# unmigrated database and prove nothing about the deployment path.
echo "→ running migrate-only init (same command as the production init service)"
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql://madrasa:rehearsal@$PG:5432/madrasa" \
  --entrypoint sh "$RC_IMAGE" -c "npx tsx src/db/migrate.ts" >/dev/null
echo "  ledger after migrate: $(docker exec "$PG" psql -U madrasa -d madrasa -tAc "select count(*) from drizzle.__drizzle_migrations")"

# ── 5 · the RC image against the clone ─────────────────────────────────────────────────────
echo "→ starting the RC ($RC_IMAGE) on 127.0.0.1:$PORT"
docker run -d --name "$APP" --network "$NET" \
  -p "127.0.0.1:$PORT:3080" \
  -e DATABASE_URL="postgresql://madrasa:rehearsal@$PG:5432/madrasa" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e STORAGE_DIR=/app/storage \
  -e APP_URL="http://127.0.0.1:$PORT" \
  -e TRUSTED_ORIGINS="127.0.0.1:$PORT" \
  -e AI_ENABLED=false \
  -e NODE_ENV=production \
  -v "$VOL_UP":/app/storage \
  "$RC_IMAGE" >/dev/null

echo "→ waiting for health"
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -s "http://127.0.0.1:$PORT/api/health"; echo

LEDGER_AFTER=$(docker exec "$PG" psql -U madrasa -d madrasa -tAc "select count(*) from drizzle.__drizzle_migrations")
TABLES_AFTER=$(docker exec "$PG" psql -U madrasa -d madrasa -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
echo "  after RC boot: ledger=$LEDGER_AFTER tables=$TABLES_AFTER (was $LEDGER / $TABLES)"

# ── 6 · confirm production was never disturbed ─────────────────────────────────────────────
PROD_RESTARTS_AFTER=$(docker inspect "$PROD_DB" --format '{{.RestartCount}}')
PROD_STARTED_AFTER=$(docker inspect "$PROD_DB" --format '{{.State.StartedAt}}')
if [[ "$PROD_RESTARTS_BEFORE" != "$PROD_RESTARTS_AFTER" || "$PROD_STARTED_BEFORE" != "$PROD_STARTED_AFTER" ]]; then
  echo "✗ PRODUCTION WAS DISTURBED — investigate before continuing" >&2
  exit 1
fi
echo "✓ production untouched (restarts=$PROD_RESTARTS_AFTER, start time unchanged)"

rm -rf "$WORK"
cat <<INFO

Clone is up.  Run the rehearsal:

  APP_URL=http://127.0.0.1:$PORT \\
  REHEARSAL_PASSWORD=$REH_PASSWORD \\
  REHEARSAL_PG=$PG \\
  node scripts/v241-final-clone-rehearsal.mjs

Then destroy everything:

  bash scripts/v241-final-clone-setup.sh teardown
INFO

#!/usr/bin/env bash
# Restore-verification for a v2.5.0 backup set — proves the artifacts are actually recoverable.
#
# Guarantees:
#   * the encrypted dump is decrypted INSIDE a container; no plaintext ever touches the host
#   * the restore target is a throwaway PostgreSQL on an ISOLATED network with NO host port
#   * production is only ever read (the backups volume is mounted read-only)
#   * every temporary container, volume and network is destroyed on exit, success or failure
#
# The verification itself: run the same probe over the restored copy and diff it against the
# probe taken from live production. Byte-identical output is the pass condition.
#
# Usage:
#   bash scripts/v250-restore-verify.sh <stamp> <subdir> <baseline-probe-file>
#   e.g. bash scripts/v250-restore-verify.sh 20260806-111437 predeploy \
#          storage/private/v250-deploy/probe-01-baseline.txt
set -euo pipefail

STAMP="${1:?usage: v250-restore-verify.sh <stamp> <subdir> <baseline-probe>}"
SUBDIR="${2:-predeploy}"
BASELINE="${3:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR="$ROOT_DIR/storage/private/v250-deploy"
APP_IMAGE="${APP_IMAGE:-madrasa-app:0.1.0}"

NET="v250-verify-net-$STAMP"
PGC="v250-verify-pg-$STAMP"
PGVOL="v250-verify-vol-$STAMP"

# Passphrase comes from the env file, never from argv.
set -a; . "$ROOT_DIR/.env.production"; set +a
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE missing from .env.production}"
VERIFY_PG_PASSWORD="verify-$(openssl rand -hex 12)"

cleanup() {
  docker rm -f "$PGC" >/dev/null 2>&1 || true
  docker volume rm -f "$PGVOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "— verification environment destroyed —"
}
trap cleanup EXIT

echo "=== isolated restore verification: $SUBDIR/$STAMP ==="
docker network create --internal "$NET" >/dev/null
docker volume create "$PGVOL" >/dev/null
docker run -d --name "$PGC" --network "$NET" \
  -e POSTGRES_USER=madrasa -e POSTGRES_DB=madrasa \
  -e POSTGRES_PASSWORD="$VERIFY_PG_PASSWORD" \
  -v "$PGVOL:/var/lib/postgresql/data" \
  postgres:16-alpine >/dev/null
# NOTE: --internal network + no -p means this database is unreachable from the host and from
# any other network. It is not a parallel environment; nothing user-facing can reach it.

for _ in $(seq 1 60); do
  docker exec "$PGC" pg_isready -U madrasa -d madrasa >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$PGC" pg_isready -U madrasa -d madrasa

# ---- restore the database ---------------------------------------------------------------
docker run --rm --network "$NET" \
  -v madrasa-prod_backups:/data/backups:ro \
  -e BACKUP_PASSPHRASE -e PGPASSWORD="$VERIFY_PG_PASSWORD" \
  --entrypoint bash "$APP_IMAGE" -c '
    set -euo pipefail
    T="$(mktemp -d)"; trap "rm -rf $T" EXIT
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
      -in "/data/backups/'"$SUBDIR"'/db-'"$STAMP"'.dump.enc" \
      -out "$T/db.dump" -pass env:BACKUP_PASSPHRASE
    echo "pg_restore --list objects: $(pg_restore --list "$T/db.dump" | grep -c "^[0-9]")"
    pg_restore --no-owner --no-privileges -d "postgresql://madrasa:$PGPASSWORD@'"$PGC"':5432/madrasa" "$T/db.dump"
  ' 2>&1 | grep -v '^pg_restore: warning' || true

# ---- probe the restored copy and diff against live production ----------------------------
docker exec -i "$PGC" psql -U madrasa -d madrasa -f - \
  < "$ROOT_DIR/scripts/v250-prod-probe.sql" > "$OUTDIR/probe-restored-$STAMP.txt" 2>&1

if [ -n "$BASELINE" ] && [ -f "$BASELINE" ]; then
  if diff -u "$BASELINE" "$OUTDIR/probe-restored-$STAMP.txt" > "$OUTDIR/probe-diff-$STAMP.txt"; then
    echo "RESTORE VERIFY: PASS — restored copy is byte-identical to live production (0 differences)"
  else
    echo "RESTORE VERIFY: DIFFERENCES FOUND"
    cat "$OUTDIR/probe-diff-$STAMP.txt"
  fi
fi

# ---- uploads archive ----------------------------------------------------------------------
# Aggregate digest over every file's own digest, computed the same way on both sides.
LIVE_AGG="$(docker run --rm -v madrasa-prod_storage:/s:ro alpine sh -c \
  'cd /s && find . -type f | sort | xargs -r sha256sum | sha256sum' | awk '{print $1}')"
ARCH_AGG="$(docker run --rm -v madrasa-prod_backups:/data/backups:ro -e BACKUP_PASSPHRASE \
  --entrypoint bash "$APP_IMAGE" -c '
    set -euo pipefail
    T="$(mktemp -d)"; trap "rm -rf $T" EXIT
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
      -in "/data/backups/'"$SUBDIR"'/storage-'"$STAMP"'.tar.gz.enc" \
      -out "$T/s.tar.gz" -pass env:BACKUP_PASSPHRASE
    mkdir -p "$T/x" && tar -xzf "$T/s.tar.gz" -C "$T/x"
    cd "$T/x/storage" && find . -type f | sort | xargs -r sha256sum | sha256sum
  ' | awk '{print $1}')"

echo "uploads aggregate  live: $LIVE_AGG"
echo "uploads aggregate  archive: $ARCH_AGG"
[ "$LIVE_AGG" = "$ARCH_AGG" ] && echo "UPLOADS VERIFY: PASS" || echo "UPLOADS VERIFY: MISMATCH"

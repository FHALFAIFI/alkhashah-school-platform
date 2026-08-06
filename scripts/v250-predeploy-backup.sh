#!/usr/bin/env bash
# Pre-deployment backup for v2.5.0 — runs INSIDE the production compose network.
#
# Why inside: production PostgreSQL is unpublished, so a backup launched from the host
# terminal cannot reach it and would silently capture the *development* database instead
# (see scripts/backup-lib.sh — that failure mode is worse than an outright error).
#
# Encryption is mandatory and the passphrase is read from the environment only, never from
# argv, so it never appears in `ps` output or in a shell history.
#
# Produces, under /data/backups/<subdir>/:
#   db-<stamp>.dump.enc          pg_dump custom format, AES-256-CBC / PBKDF2 / 200k iters
#   storage-<stamp>.tar.gz.enc   the uploads volume
#   config-<stamp>.tar.gz.enc    release config + every migration + a REDACTED .env.production
#   SHA256SUMS-<stamp>.txt
#
# Usage (from the host):
#   docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
#     run --rm --no-deps -T -v "$PWD:/repo:ro" \
#     -e STAMP="$(date +%Y%m%d-%H%M%S)" -e SUBDIR=predeploy \
#     --entrypoint bash init /repo/scripts/v250-predeploy-backup.sh
set -euo pipefail

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE must be set (encryption is never optional)}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
STAMP="${STAMP:?STAMP must be set}"
SUBDIR="${SUBDIR:-predeploy}"
REPO="${REPO:-/repo}"
OUT="/data/backups/$SUBDIR"
STORAGE_DIR="${STORAGE_DIR:-/data/storage}"

mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Never print the password embedded in DATABASE_URL.
echo "target: $(printf '%s' "$DATABASE_URL" | sed -E 's#://[^:]+:[^@]+@#://#')"
echo "stamp:  $STAMP"

encrypt() { # $1 plaintext in, $2 ciphertext out
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$1" -out "$2" -pass env:BACKUP_PASSPHRASE
  chmod 600 "$2"
}

# ---- 1) database ----------------------------------------------------------------------
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$TMP/db.dump"
encrypt "$TMP/db.dump" "$OUT/db-$STAMP.dump.enc"
echo "db objects: $(pg_restore --list "$TMP/db.dump" | grep -c '^[0-9]')"

# ---- 2) uploads -----------------------------------------------------------------------
tar -czf "$TMP/storage.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
encrypt "$TMP/storage.tar.gz" "$OUT/storage-$STAMP.tar.gz.enc"
echo "upload files: $(find "$STORAGE_DIR" -type f | wc -l | tr -d ' ')"

# ---- 3) release configuration ---------------------------------------------------------
CFG="$TMP/config"
mkdir -p "$CFG"
for f in package.json package-lock.json compose.production.yml Dockerfile.production \
         next.config.ts drizzle.config.ts .env.production.example; do
  [ -f "$REPO/$f" ] && cp "$REPO/$f" "$CFG/$f"
done
cp -r "$REPO/drizzle" "$CFG/drizzle"

# A redacted copy of the live env file: structure preserved so a recovery operator knows which
# keys must be supplied, values stripped so no secret is ever written into a backup artifact.
if [ -f "$REPO/.env.production" ]; then
  sed -E 's/^(POSTGRES_PASSWORD|SESSION_SECRET|BACKUP_PASSPHRASE)=.*/\1=<REDACTED>/' \
    "$REPO/.env.production" > "$CFG/.env.production.redacted"
fi

# Prove no secret leaked into the staged config tree — BEFORE it is archived, so a failure
# never leaves a secret-bearing artifact on disk. A redacted placeholder is the only value
# these keys may carry; anything else is a real secret and aborts the backup.
if grep -rhE '^(POSTGRES_PASSWORD|SESSION_SECRET|BACKUP_PASSPHRASE)=.+' "$CFG" \
     --exclude='*.example' 2>/dev/null | grep -qv '=<REDACTED>$'; then
  echo "ABORT: a real secret reached the config archive" >&2
  exit 1
fi

tar -czf "$TMP/config.tar.gz" -C "$TMP" config
encrypt "$TMP/config.tar.gz" "$OUT/config-$STAMP.tar.gz.enc"
echo "migrations in config archive: $(ls -1 "$CFG"/drizzle/*.sql | wc -l | tr -d ' ')"

# ---- 4) checksums ---------------------------------------------------------------------
( cd "$OUT" && sha256sum "db-$STAMP.dump.enc" "storage-$STAMP.tar.gz.enc" \
    "config-$STAMP.tar.gz.enc" > "SHA256SUMS-$STAMP.txt" )
( cd "$OUT" && sha256sum -c "SHA256SUMS-$STAMP.txt" )

ls -l "$OUT"/*"$STAMP"*
echo "backup complete: $STAMP"

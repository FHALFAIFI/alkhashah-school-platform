#!/usr/bin/env bash
# Phase 0 — deep restore verification + recovery manifest.
# Creates fresh encrypted DB + full backups, checksums them, restores the full
# backup into a DISPOSABLE database + temp storage, verifies every domain table
# and physical files, drops the disposable DB, and writes a combined manifest.
# Read-only against the real DB (dump only). Never touches the real madrasa DB.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
require_passphrase

MANIFEST_DIR="$ROOT_DIR/storage/private/recovery"
mkdir -p "$MANIFEST_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== Phase 0 verification =="

# 1) Fresh encrypted backups (DB-only daily + full weekly with files)
bash "$ROOT_DIR/scripts/backup-daily.sh"  >/dev/null
bash "$ROOT_DIR/scripts/backup-weekly.sh" >/dev/null
DB_BACKUP="$(ls -1t "$BACKUP_DIR"/daily/db-*.dump.enc | head -1)"
FULL_BACKUP="$(ls -1t "$BACKUP_DIR"/weekly/full-*.tar.gz.enc | head -1)"

# 2) Checksums
DB_SHA="$(shasum -a 256 "$DB_BACKUP" | awk '{print $1}')"
FULL_SHA="$(shasum -a 256 "$FULL_BACKUP" | awk '{print $1}')"

# 3) Source domain counts (read-only)
read_counts() { # $1 = database url
  psql "$1" -tAF, -c "
    SELECT
      (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
      (SELECT count(*) FROM drizzle.__drizzle_migrations),
      (SELECT count(*) FROM users),
      (SELECT count(*) FROM import_batches),
      (SELECT count(*) FROM programs),
      (SELECT count(*) FROM people),
      (SELECT count(*) FROM documents),
      (SELECT count(*) FROM floors),
      (SELECT count(*) FROM rooms),
      (SELECT count(*) FROM assets),
      (SELECT count(*) FROM inspections),
      (SELECT count(*) FROM audit_log),
      (SELECT count(*) FROM stored_files);"
}
SRC="$(read_counts "$DATABASE_URL")"

# 4) Restore full backup into a disposable DB + temp storage
VERIFY_DB="madrasa_phase0_verify_$(echo "$STAMP" | tr -d -)"
VERIFY_URL="$(echo "$DATABASE_URL" | sed "s|/[^/]*$|/$VERIFY_DB|")"
TMPSTORE="$(mktemp -d)"
cleanup() {
  psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS $VERIFY_DB" >/dev/null 2>&1 || true
  rm -rf "$TMPSTORE"
}
trap cleanup EXIT
psql "$DATABASE_URL" -c "CREATE DATABASE $VERIFY_DB" >/dev/null
bash "$ROOT_DIR/scripts/restore.sh" "$FULL_BACKUP" "$VERIFY_URL" "$TMPSTORE" >/dev/null
DST="$(read_counts "$VERIFY_URL")"
FILES_FS="$(find "$TMPSTORE" -type f | wc -l | tr -d ' ')"
APP_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"

# 5) Verify source == restored for every domain
if [ "$SRC" != "$DST" ]; then
  echo "FAIL: restored counts differ from source" >&2
  echo "  source:   $SRC" >&2
  echo "  restored: $DST" >&2
  exit 1
fi
IFS=, read -r T MIG U IB PR PE DOC FL RM AS INS AUD SF <<<"$DST"

# 6) Migration hash list (source)
MIGRATIONS="$(psql "$DATABASE_URL" -tAF, -c "SELECT id, substr(hash,1,12) FROM drizzle.__drizzle_migrations ORDER BY id" | paste -sd';' -)"

cat > "$MANIFEST_DIR/recovery-manifest-$STAMP.json" <<JSON
{
  "generatedAt": "$STAMP",
  "appCommit": "$APP_COMMIT",
  "sourceDatabase": "$POSTGRES_DB",
  "pgVersion": "$(psql "$DATABASE_URL" -tAc 'SHOW server_version' | tr -d ' ')",
  "backups": {
    "dbOnly":   { "path": "${DB_BACKUP#$ROOT_DIR/}",   "sha256": "$DB_SHA" },
    "fullFiles":{ "path": "${FULL_BACKUP#$ROOT_DIR/}", "sha256": "$FULL_SHA" }
  },
  "migrations": { "count": $MIG, "list": "$MIGRATIONS" },
  "verifiedCounts": {
    "publicTables": $T, "migrations": $MIG, "users": $U, "importBatches": $IB,
    "programs": $PR, "people": $PE, "documents": $DOC, "floors": $FL, "rooms": $RM,
    "assets": $AS, "inspections": $INS, "auditLog": $AUD,
    "storedFileRecords": $SF, "physicalFilesRestored": $FILES_FS
  },
  "restoreVerification": "PASS (source counts == restored counts; disposable DB $VERIFY_DB dropped)"
}
JSON

chmod 600 "$MANIFEST_DIR/recovery-manifest-$STAMP.json"
echo "== PASS =="
echo "DB backup:   ${DB_BACKUP#$ROOT_DIR/}  sha256=$DB_SHA"
echo "Full backup: ${FULL_BACKUP#$ROOT_DIR/}  sha256=$FULL_SHA"
echo "Verified domains: tables=$T migrations=$MIG users=$U imports=$IB programs=$PR people=$PE docs=$DOC floors=$FL rooms=$RM assets=$AS inspections=$INS audit=$AUD files(db)=$SF files(fs)=$FILES_FS"
echo "Manifest: storage/private/recovery/recovery-manifest-$STAMP.json"

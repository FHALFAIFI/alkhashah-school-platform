#!/usr/bin/env bash
# النسخة اليومية: قاعدة البيانات فقط — مشفرة، والاحتفاظ الافتراضي 14 نسخة
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
require_passphrase

RETENTION="${BACKUP_DAILY_RETENTION:-14}"
mkdir -p "$BACKUP_DIR/daily"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pg_dump --dbname="$DATABASE_URL" --format=custom --file="$TMP/db.dump"
encrypt_file "$TMP/db.dump" "$BACKUP_DIR/daily/db-$STAMP.dump.enc"
chmod 600 "$BACKUP_DIR/daily/db-$STAMP.dump.enc"
prune_old "$BACKUP_DIR/daily" "$RETENTION" "db-*.dump.enc"
echo "نسخة يومية مشفرة: $BACKUP_DIR/daily/db-$STAMP.dump.enc"

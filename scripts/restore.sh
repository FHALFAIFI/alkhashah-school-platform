#!/usr/bin/env bash
# الاستعادة: يفك تشفير نسخة ويستعيدها إلى قاعدة الهدف (يجب أن تكون فارغة أو قابلة للاستبدال)
# الاستخدام:
#   scripts/restore.sh backups/daily/db-XXXX.dump.enc [DATABASE_URL_الهدف]
#   scripts/restore.sh backups/weekly/full-XXXX.tar.gz.enc [DATABASE_URL_الهدف] [مجلد_استعادة_المرفقات]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
require_passphrase

BACKUP_FILE="${1:?حدد ملف النسخة الاحتياطية}"
TARGET_DB="${2:-$DATABASE_URL}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

case "$BACKUP_FILE" in
  *db-*.dump.enc)
    decrypt_file "$BACKUP_FILE" "$TMP/db.dump"
    pg_restore --dbname="$TARGET_DB" --clean --if-exists --no-owner "$TMP/db.dump"
    echo "استعيدت قاعدة البيانات إلى: $TARGET_DB"
    ;;
  *full-*.tar.gz.enc)
    RESTORE_STORAGE="${3:-$TMP/storage-restored}"
    decrypt_file "$BACKUP_FILE" "$TMP/full.tar.gz"
    tar -xzf "$TMP/full.tar.gz" -C "$TMP"
    pg_restore --dbname="$TARGET_DB" --clean --if-exists --no-owner "$TMP/db.dump"
    mkdir -p "$RESTORE_STORAGE"
    cp -R "$TMP/storage/." "$RESTORE_STORAGE/"
    echo "استعيدت قاعدة البيانات إلى: $TARGET_DB"
    echo "استعيدت المرفقات إلى: $RESTORE_STORAGE"
    ;;
  *)
    echo "نوع ملف غير معروف" >&2
    exit 1
    ;;
esac

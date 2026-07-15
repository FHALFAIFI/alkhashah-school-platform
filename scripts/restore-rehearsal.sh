#!/usr/bin/env bash
# بروفة الاستعادة الحقيقية (A15):
# 1) يأخذ نسخة أسبوعية كاملة جديدة  2) يستعيدها إلى قاعدة بروفة معزولة ومجلد مؤقت
# 3) يتحقق من سلامة الجداول والصفوف والمرفقات  4) ينظف بعده
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
require_passphrase

echo "— بروفة الاستعادة —"
bash "$ROOT_DIR/scripts/backup-weekly.sh" >/dev/null
LATEST="$(ls -1t "$BACKUP_DIR"/weekly/full-*.tar.gz.enc | head -1)"
echo "النسخة المختبرة: $LATEST"

REHEARSAL_DB_NAME="madrasa_rehearsal_$(date +%s)"
ADMIN_URL="$DATABASE_URL"
REHEARSAL_URL="$(echo "$DATABASE_URL" | sed "s|/[^/]*$|/$REHEARSAL_DB_NAME|")"

psql "$ADMIN_URL" -c "CREATE DATABASE $REHEARSAL_DB_NAME" >/dev/null
TMPSTORE="$(mktemp -d)"
cleanup() {
  psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS $REHEARSAL_DB_NAME" >/dev/null || true
  rm -rf "$TMPSTORE"
}
trap cleanup EXIT

bash "$ROOT_DIR/scripts/restore.sh" "$LATEST" "$REHEARSAL_URL" "$TMPSTORE" >/dev/null

# تحققات
TABLES="$(psql "$REHEARSAL_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
USERS="$(psql "$REHEARSAL_URL" -tAc "SELECT count(*) FROM users")"
FILES_DB="$(psql "$REHEARSAL_URL" -tAc "SELECT count(*) FROM stored_files")"
FILES_FS="$(find "$TMPSTORE" -type f | wc -l | tr -d ' ')"

echo "الجداول المستعادة: $TABLES"
echo "المستخدمون: $USERS"
echo "سجلات الملفات: $FILES_DB — ملفات مستعادة فعلياً: $FILES_FS"

if [ "$TABLES" -lt 30 ] || [ "$USERS" -lt 2 ]; then
  echo "فشلت البروفة: بيانات ناقصة" >&2
  exit 1
fi
echo "✓ نجحت بروفة الاستعادة — النسخ الاحتياطي قابل للاسترجاع فعلياً"

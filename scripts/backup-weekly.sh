#!/usr/bin/env bash
# النسخة الأسبوعية الكاملة: قاعدة البيانات + المرفقات + الإعدادات — مشفرة، الاحتفاظ 8 نسخ
# انسخ الملف الناتج إلى وجهة خارج الجهاز (قرص خارجي أو عقدة Tailscale ثانية) — انظر دليل النسخ
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/backup-lib.sh"
require_passphrase

RETENTION="${BACKUP_WEEKLY_RETENTION:-8}"
mkdir -p "$BACKUP_DIR/weekly"
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pg_dump --dbname="$DATABASE_URL" --format=custom --file="$TMP/db.dump"
# الإعدادات: مثال البيئة (بلا أسرار) وقائمة الإصدارات
cp "$ROOT_DIR/.env.example" "$TMP/env.example" 2>/dev/null || true
cp "$ROOT_DIR/package.json" "$TMP/package.json"
tar -czf "$TMP/full.tar.gz" -C "$TMP" db.dump env.example package.json -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
encrypt_file "$TMP/full.tar.gz" "$BACKUP_DIR/weekly/full-$STAMP.tar.gz.enc"
chmod 600 "$BACKUP_DIR/weekly/full-$STAMP.tar.gz.enc"
prune_old "$BACKUP_DIR/weekly" "$RETENTION" "full-*.tar.gz.enc"
echo "نسخة أسبوعية كاملة مشفرة: $BACKUP_DIR/weekly/full-$STAMP.tar.gz.enc"
echo "تذكير: انسخها إلى وجهة خارج الجهاز."

if [ -n "${BACKUP_OFFSITE_DIR:-}" ] && [ -d "${BACKUP_OFFSITE_DIR:-}" ]; then
  cp "$BACKUP_DIR/weekly/full-$STAMP.tar.gz.enc" "$BACKUP_OFFSITE_DIR/"
  echo "نسخت إلى الوجهة الخارجية: $BACKUP_OFFSITE_DIR"
fi

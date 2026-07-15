#!/usr/bin/env bash
# مكتبة النسخ الاحتياطي المشتركة — التشفير إلزامي دائماً
set -euo pipefail

# قراءة .env من جذر المشروع إن وجد
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://madrasa:madrasa_dev@localhost:5544/madrasa}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
STORAGE_DIR="${STORAGE_DIR:-$ROOT_DIR/storage}"

# تحويل المسارات النسبية (./storage) إلى مطلقة بالنسبة لجذر المشروع
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$ROOT_DIR/${BACKUP_DIR#./}" ;; esac
case "$STORAGE_DIR" in /*) ;; *) STORAGE_DIR="$ROOT_DIR/${STORAGE_DIR#./}" ;; esac

require_passphrase() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "خطأ: BACKUP_PASSPHRASE غير معرف في البيئة — النسخ الاحتياطي مشفر دائماً" >&2
    exit 1
  fi
}

encrypt_file() { # $1: in, $2: out
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$1" -out "$2" -pass env:BACKUP_PASSPHRASE
}

decrypt_file() { # $1: in, $2: out
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$1" -out "$2" -pass env:BACKUP_PASSPHRASE
}

prune_old() { # $1: dir, $2: keep count, $3: pattern
  ls -1t "$1"/$3 2>/dev/null | tail -n "+$(($2 + 1))" | while read -r f; do
    rm -f "$f"
    echo "حذف نسخة قديمة (سياسة الاحتفاظ): $f"
  done
}

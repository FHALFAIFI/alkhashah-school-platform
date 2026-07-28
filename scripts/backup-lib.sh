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

# قاعدة الإنتاج **غير منشورة** على المضيف، وملف `.env` للتطوير يضبط DATABASE_URL على
# قاعدة التطوير (المنفذ 5544). تشغيل سكربت النسخ من الطرفية كان يلتقط ذلك وينجح بصمت،
# فينتج ملف نسخة احتياطية يبدو سليماً ولا يحوي بيانات المدرسة إطلاقاً — وهو أسوأ من فشل
# صريح لأنه يعطي ثقة كاذبة. الحارس أدناه يرفض قاعدة التطوير ما لم تُطلب صراحةً.
DATABASE_URL="${DATABASE_URL:-postgresql://madrasa:madrasa_dev@localhost:5544/madrasa}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
STORAGE_DIR="${STORAGE_DIR:-$ROOT_DIR/storage}"

# تحويل المسارات النسبية (./storage) إلى مطلقة بالنسبة لجذر المشروع
case "$BACKUP_DIR" in /*) ;; *) BACKUP_DIR="$ROOT_DIR/${BACKUP_DIR#./}" ;; esac
case "$STORAGE_DIR" in /*) ;; *) STORAGE_DIR="$ROOT_DIR/${STORAGE_DIR#./}" ;; esac

# اسم القاعدة والمضيف المستهدفان — يُطبعان دائماً قبل أي نسخ، فلا يُنسَخ شيء بالخطأ صامتاً
target_db_label() {
  printf '%s' "$DATABASE_URL" | sed -E 's#://[^:]+:[^@]+@#://#'
}

# يرفض النسخ من قاعدة التطوير (المنفذ 5544) ما لم يُطلب صراحةً بـALLOW_DEV_BACKUP=1.
# الهدف منع «نسخة احتياطية ناجحة» لا تحوي بيانات الإنتاج.
require_explicit_database() {
  echo "قاعدة الهدف: $(target_db_label)"
  case "$DATABASE_URL" in
    *localhost:5544/*|*127.0.0.1:5544/*)
      if [ "${ALLOW_DEV_BACKUP:-}" != "1" ]; then
        cat >&2 <<'MSG'
خطأ: الهدف هو قاعدة التطوير (المنفذ 5544) لا قاعدة الإنتاج.
قاعدة الإنتاج غير منشورة على المضيف، ولذلك لا تُلتقط بتشغيل السكربت من الطرفية مباشرةً.
شغّل النسخ داخل شبكة compose، أو حدّد DATABASE_URL للإنتاج صراحةً.
للنسخ المتعمّد لقاعدة التطوير: ALLOW_DEV_BACKUP=1
MSG
        exit 1
      fi
      echo "تنبيه: نسخ متعمّد لقاعدة التطوير (ALLOW_DEV_BACKUP=1)" >&2
      ;;
  esac
}

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

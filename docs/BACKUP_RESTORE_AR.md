# دليل النسخ الاحتياطي والاستعادة (مجرب فعلياً)

## المبادئ
- **النسخ مشفرة دائماً** (AES-256 عبر OpenSSL بمفتاح `BACKUP_PASSPHRASE` من البيئة) — لا نسخة غير مشفرة إطلاقاً.
- يومية لقاعدة البيانات + أسبوعية كاملة (قاعدة + مرفقات `storage/` + إعدادات).
- **نسخة خارج الجهاز إلزامية**: اضبط `BACKUP_OFFSITE_DIR` أو انسخ ملفات `backups/weekly/` يدوياً إلى قرص خارجي/عقدة ثانية.
- الاحتفاظ قابل للضبط: `BACKUP_DAILY_RETENTION` (افتراضي 14) و`BACKUP_WEEKLY_RETENTION` (افتراضي 8).
- احفظ `BACKUP_PASSPHRASE` في مكان آمن منفصل عن الخادم — بدونه لا يمكن فك أي نسخة.

## الأوامر
```bash
npm run backup:daily        # قاعدة البيانات → backups/daily/db-<تاريخ>.dump.enc
npm run backup:weekly       # كاملة → backups/weekly/full-<تاريخ>.tar.gz.enc
npm run restore -- backups/daily/db-XXXX.dump.enc              # استعادة قاعدة فقط
npm run restore -- backups/weekly/full-XXXX.tar.gz.enc         # استعادة كاملة
npm run restore:rehearsal   # بروفة استعادة حقيقية إلى قاعدة مؤقتة تحذف بعدها
```

## سيناريو كارثة (خطوة بخطوة)
1. جهز خادماً جديداً حسب دليل النشر حتى خطوة `docker compose up -d db` (قاعدة فارغة).
2. أحضر أحدث نسخة أسبوعية من الوجهة الخارجية + `BACKUP_PASSPHRASE`.
3. `bash scripts/restore.sh <النسخة> "$DATABASE_URL" ./storage`
4. شغل التطبيق وتحقق من الدخول والوثائق والمرفقات.

## بروفة الاستعادة
مطلوبة قبل الإطلاق وبعد كل تغيير جوهري في البنية. آخر بروفة موثقة في `docs/BACKUP_REHEARSAL_LOG.md`.

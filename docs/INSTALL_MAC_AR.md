# دليل التشغيل على Mac (بيئة الاختبار الأولى)

الجهاز المستهدف: Mac mini M2 بذاكرة 8 ج.ب.

## المتطلبات
- Node.js 20 فأحدث (المثبت حالياً: 24)
- Docker Desktop (لقاعدة البيانات PostgreSQL 16)
- Git

## خطوات التشغيل الأول
```bash
# 1) داخل مجلد المشروع
cp .env.example .env
# عبئ في .env القيم التالية على الأقل:
#   SESSION_SECRET=$(openssl rand -hex 32)
#   BACKUP_PASSPHRASE=$(openssl rand -hex 24)

# 2) قاعدة البيانات (منفذ 5544 لتفادي التعارض مع أي PostgreSQL آخر)
docker compose up -d db

# 3) التبعيات والهجرات والبذرة
npm ci
npx playwright install chromium     # متصفح توليد PDF العربي
npm run db:migrate                  # يطبق الهجرات (npx tsx src/db/migrate.ts)
npx tsx src/db/seed.ts              # البذرة الإنتاجية النظيفة
npm run db:seed:geometry            # هندسة المبنى الأولية + الخلفيات من الملفات المرجعية

# 4) التشغيل
npm run dev                         # http://localhost:3080
```

- كلمات المرور المؤقتة للحسابين (principal / admin) تكتب في: `storage/private/initial-credentials.txt` — غيرها من «المستخدمون والأدوار» بعد أول دخول.
- التوقيع والختم يستوردان تلقائياً من `reference_files/` إلى التخزين الخاص أثناء البذرة (لا يدخلان Git أبداً).
- البيانات التجريبية للعرض (اختيارية ومنفصلة): `npm run db:seed:demo`.

## استيراد البيانات الفعلية (من داخل التطبيق)
1. «الاستيراد» ← «استيراد الخطة التشغيلية» ← ارفع `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` ← راجع المعاينة ← «موافقة صريحة وتنفيذ».
2. «الاستيراد» ← «استيراد أشخاص» ← ارفع ملف فارس عند توفره — الحقول الحساسة (الهوية، الميلاد، الجوال، هوية المدير) لا تستورد افتراضياً.

## الفحوصات
```bash
npm run test        # اختبارات الوحدات والتكامل (قاعدة اختبار معزولة تنشأ تلقائياً)
npm run test:e2e    # اختبارات المتصفح (يشغل الخادم تلقائياً)
npm run lint && npm run typecheck
```

## النسخ الاحتياطي على Mac
```bash
npm run backup:daily       # يومي: قاعدة البيانات (مشفرة)
npm run backup:weekly      # أسبوعي: كامل (قاعدة + مرفقات + إعدادات)
npm run restore:rehearsal  # بروفة استعادة حقيقية إلى قاعدة مؤقتة
```
ملاحظة: أوامر `pg_dump/psql` يجب أن تكون بإصدار 16 — إن لم تكن في المسار: `export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"`.
للجدولة استخدم `launchd` أو `crontab -e`:
```
0 2 * * *  cd "<مسار المشروع>" && npm run backup:daily
0 3 * * 5  cd "<مسار المشروع>" && npm run backup:weekly
```

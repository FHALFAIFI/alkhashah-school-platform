# RUNBOOK — دفتر التشغيل اليومي

> المرجع السريع لتشغيل المنصة وتشخيصها. التفاصيل الكاملة: `docs/INSTALL_MAC_AR.md` (ماك) و`docs/DEPLOY_UBUNTU_AR.md` (أوبنتو).

## المرشَّح الجاهز للنشر (بانتظار تفويض المالك)

| البند | القيمة |
| --- | --- |
| الإصدار | **v2.5.0** — جاهز (`docs/DELIVERY_V2_5_0.md`) |
| الالتزام | `scope-v2.5-reporting-workflows` من خط الأساس `v2.4.1` |
| صورة المرشَّح | `madrasa-app:0.1.0-v2_5_0-rc` = `sha256:0410fdb3ce9f…` (linux/arm64) |
| سجل الهجرات | **31 → 34** · الجداول **88 → 89** |
| البروفة على نسخة الإنتاج | **49/49** · التراجع **ناجح بلا إجراء على القاعدة** |
| التدقيق البصري / التصدير / الأمن / الأداء | 100/100 · 27/27 · 22 تأكيداً · 17 سطحاً دون 100 ms |
| التراجع | تبديل صورة فقط — **لا إجراء على قاعدة البيانات** (مُثبَت بالبروفة) |
| الوسم | `v2.5.0` **لم يُنشأ بعد** — يُنشأ عند النشر كما في v2.3/v2.4 |

### نشر v2.5.0 (بعد التفويض الصريح — ثلاث هجرات)

> الهجرات: **0031** (ستة أعمدة تقبل الفراغ على `program_followups`) و**0032** (جدول
> `report_templates`) و**0033** (هجرة بيانات: ثلاث صلاحيات جديدة ومنحها للأدوار القائمة —
> **ضرورية** لأن خدمة البذر مقيّدة بملف تعريف ولا تعمل على الإنتاج، فالصلاحية المضافة إلى
> البذرة وحدها لا تصل للمدير أبداً). لا عمود يُحذف أو يُعاد تسميته، ولا صف قائم يُعدَّل أو
> يُحذف. لهذا يبقى **التراجع بلا أي إجراء على القاعدة**.

```bash
cd "/Users/fahedalfify/Developer/School/Father's File"
# 1) نسخة ما قبل النشر + تحقّق استعادة
npm run backup:daily && npm run restore:rehearsal

# 2) وسم صورة التراجع من الصورة العاملة حالياً قبل تحريك أي وسم
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_5_0-$(date +%Y%m%d)

# 3) القيَم قبل الترقية — تُقيَّد للمقارنة
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations"                              # المتوقع 31
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"     # المتوقع 88

# 4) ترقية التطبيق وحده — حاوية القاعدة لا تُعاد تشغيلها
docker tag madrasa-app:0.1.0-v2_5_0-rc madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps --force-recreate app

# 5) تحقّق
curl -s http://127.0.0.1:3080/api/health                                            # version=2.5.0
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations"                              # يصبح 34
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"     # يصبح 89
# الأعمدة الجديدة فارغة تماماً على البيانات القائمة:
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from program_followups where completed_work is not null \
   or obstacles is not null or required_action is not null or next_step is not null \
   or evidence_update is not null or intervention_needed = true"                    # يجب أن يكون 0
# الصلاحيات الجديدة ممنوحة للدورين:
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from role_permissions rp join permissions p on p.id = rp.permission_id \
   where p.key in ('reports.builder','reports.templates.share','reports.templates.global')"  # 6
```

**التراجع:** أعد وسم `madrasa-app:0.1.0-prev-v2_5_0-<التاريخ>` إلى `madrasa-app:0.1.0` وأعد
إنشاء `app` وحده. **لا إجراء على القاعدة** — أُثبت بتشغيل صورة v2.4.1 على قاعدة مُهاجَرة
(سجل 34، جداول 89) فعملت سليمة.

> **لا تبنِ صورة الإصدار على الجهاز الذي يخدم الإنتاج.** أثناء بناء صورة هذا المرشَّح قتل
> نظام التشغيل عملية تطبيق الإنتاج تحت ضغط الذاكرة، فأعادته سياسة `unless-stopped` خلال
> ~0.4 ثانية على الصورة نفسها. لا بيانات تأثرت والقاعدة لم تُعد تشغيلها، لكن الانقطاع كان
> حقيقياً. ابنِ الصورة خارج ساعات العمل أو على جهاز آخر.

## الإصدار المنشور حالياً (خط الأساس)

| البند | القيمة |
| --- | --- |
| الإصدار | **v2.4.1** — نُشر 2026-08-04 (`docs/DEPLOYMENT_V2_4_1.md`) |
| الوسم | `v2.4.1` — الالتزام `6d7dacf` |
| الصورة | `madrasa-app:0.1.0` = `sha256:4b427c8e16d8…` |
| صورة التراجع | `madrasa-app:0.1.0-prev-v2_4_1-20260804` = v2.4.0 (**لا إجراء على القاعدة**) |
| سجل الهجرات | **31** · الجداول **88** |
| المشروع/المنفذ | `madrasa-prod` · المضيف `3080` (القاعدة غير منشورة) |
| النسخة الذهبية | `backups/gold/*-20260804-gold*` — مُتحقَّق منها باستعادة معزولة |

### سجل النشر (Deployment ledger)

| التاريخ | الإصدار | الالتزام | الصورة | السجل |
| --- | --- | --- | --- | --- |
| 2026-07-23 | v2.0 | — | `d6df008b` | — |
| 2026-07-26 | v2.1 | `8fb59c1` | `a492d908` | 16 |
| 2026-07-27 | v2.1 (ج4) | `49ac5b6` | `fc8654e2` | 17 |
| 2026-07-29 | v2.2 | `0fe2664` | `b13382d1` | 22 |
| 2026-07-30 | v2.2.1 | — | `ab259dd8` | 23 |
| 2026-07-31 | v2.3.0 | `b47558c` | `7f5ff14a` | 27 |
| **2026-08-03** | **v2.4.0** | **`da8db16`** | **`2f69c724`** | **29** |
| _(مرشَّح)_ | v2.4.1 | _(انظر `docs/DELIVERY_V2_4_1.md`)_ | _(صورة RC)_ | **31** (هجرتان إضافيتان: 0029، 0030) |

### التراجع السريع (بلا أي إجراء على القاعدة)

```bash
docker tag madrasa-app:0.1.0-prev-v2_4-20260803 madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps --force-recreate app
curl -s http://127.0.0.1:3080/api/health
```
الأوامر الكاملة: `backups/predeploy/ROLLBACK-20260803-065900.txt`.

## الخدمات وأماكنها
| الخدمة | العنوان | ملاحظات |
| --- | --- | --- |
| التطبيق (Next.js) | `http://localhost:3080` | `npm run dev` أو `npm run start` بعد `npm run build` |
| الوصول الآمن من الأجهزة | `https://<اسم-الجهاز>.<tailnet>.ts.net` | عبر Tailscale Serve — انظر أدناه |
| قاعدة البيانات | Docker `madrasa-db` منفذ **5544** | `docker compose up -d db` |
| أولاما (ذكاء اصطناعي محلي) | `http://localhost:11434` | اختياري — المساعد يدار من `/admin/settings/ai` |
| AnythingLLM (معرفة مستندية) | `http://localhost:3001` | اختياري |

## HTTPS عبر Tailscale Serve (إلزامي للجوال/PWA)
```bash
# على ماك (تطبيق App Store):
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
# على أوبنتو: tailscale مباشرة (مع sudo)

tailscale serve --bg localhost:3080   # يطبع رابط تفعيل HTTPS أول مرة — افتحه وأكد
tailscale serve status                # يجب أن يعرض: https://<device>.<tailnet>.ts.net -> http://127.0.0.1:3080
```
- **ممنوع** `tailscale funnel` (يعرض للإنترنت العام).
- ملف تعريف الجلسة يصبح آمناً تلقائياً عبر HTTPS؛ رموز QR للغرف والأصول تولد من عنوان الطلب نفسه فتعمل عبر أي أصل.
- إجراءات الخادم خلف الوسيط: مسموح `*.ts.net` افتراضياً؛ للتشديد: `TRUSTED_ORIGINS=<device>.<tailnet>.ts.net` في `.env`.
- التحقق من الآيفون: القفل في شريط العنوان + تعمل الكاميرا في بلاغ الصيانة + يعمل «وضع الفحص دون اتصال».

## تشغيل يومي
```bash
docker compose up -d db && npm run start        # التشغيل
npm run backup:daily                            # نسخة يومية مشفرة (مجدولة عادة)
docker compose logs db --tail 50                # سجلات القاعدة
```

## المساعد الذكي
- v2.3 (D-035): أُزيل المساعد الذكي بالكامل — لا خدمة ذكاء اصطناعي في التشغيل ولا متغيرات بيئة لها.
- المزود الخارجي (Claude) لا يعمل إلا بموافقة صريحة مسجلة من صفحة الإعدادات.
- كل استخدام مسجل في سجل التدقيق (`/admin/audit` — الأحداث تبدأ بـ `ai.`).
- التطبيق يعمل كاملاً مع تعطيل المساعد.

## تشخيص سريع
| العرض | السبب المرجح | الحل |
| --- | --- | --- |
| «غير آمن» في سفاري | وصول HTTP مباشر | استخدم عنوان `https://….ts.net` (انظر أعلاه) |
| الكاميرا/دون اتصال لا يعملان على الآيفون | سياق غير آمن | HTTPS إلزامي — تحقق من `tailscale serve status` |
| فشل تسجيل الدخول بعد النشر | عدم تطابق الأصل | اضبط `TRUSTED_ORIGINS` وأعد البناء |
| المساعد يرد «معطل» | الإعداد | فعله من `/admin/settings/ai` ثم «فحص الاتصال» |
| فشل فحص اتصال أولاما داخل Docker | `localhost` داخل الحاوية | استخدم `http://host.docker.internal:11434` |
| بطء ردود المساعد | نموذج تفكير مطول | استخدم `qwen3:4b` (التفكير معطل تلقائياً في المنصة) |

## نشر v2.4.1 (بعد التفويض الصريح — بهجرتين إضافيتين فقط)

> **تغيّر عن المسودة الأولى لهذا الإصدار:** النطاق الموحّد النهائي أضاف الهجرتين **0029**
> و**0030**، فالسجل ينتقل **29 → 31**. كلتاهما إضافيتان بحتاً: جدولان جديدان وأربعة أعمدة
> تقبل الفراغ. لا عمود يُحذف أو يُعاد تسميته أو يتغيّر نوعه، ولا صف يُكتب أو يُحذف أو
> يُعاد كتابته. لهذا يبقى **التراجع بلا أي إجراء على القاعدة**: الصورة الأقدم ببساطة لا
> تستعمل الجداول والأعمدة الجديدة.

```bash
cd "/Users/fahedalfify/Developer/School/Father's File"
# 1) نسخة ما قبل النشر + تحقّق استعادة (كما في v2.2/v2.3)
npm run backup:daily && npm run restore:rehearsal

# 2) وسم صورة التراجع من الصورة العاملة حالياً قبل تحريك أي وسم
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_4_1-$(date +%Y%m%d)

# 3) سجل الهجرات قبل الترقية — يُقيَّد للمقارنة
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations"   # المتوقع 29
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"  # المتوقع 86

# 4) ترقية التطبيق فقط — حاوية القاعدة لا تُعاد تشغيلها.
#    الهجرة تُطبَّق عند إقلاع التطبيق (نمط migrate-only نفسه المتبع منذ v2.1).
docker tag madrasa-app:0.1.0-v2_4_1-rc madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps --force-recreate app

# 5) تحقّق
curl -s http://127.0.0.1:3080/api/health   # version=2.4.1 · db=up
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations"   # يصبح 31
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"  # يصبح 88
# الأعمدة الجديدة فارغة تماماً على البيانات القائمة:
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from maintenance_issues where category is not null or safety_impact is not null \
   or operational_impact is not null or requested_action is not null"   # يجب أن يكون 0
```

**التراجع:** أعد وسم `madrasa-app:0.1.0-prev-v2_4_1-<التاريخ>` إلى `madrasa-app:0.1.0` وأعد
إنشاء `app` وحده. **لا إجراء على القاعدة** — الجدولان والأعمدة الجديدة تبقى بلا استعمال ولا
تُسقط. أُثبت ذلك في بروفة التراجع على نسخة الإنتاج.

## الحذف النهائي — قبل أي تنفيذ على الإنتاج

الحذف النهائي للموظف أو لدورة الأداء **لا يمكن التراجع عنه** إلا باستعادة نسخة احتياطية
كاملة (وهي تُرجع كل شيء إلى لحظة النسخة). خذ نسخة قبل أي حذف نهائي:

```bash
npm run backup:daily
```

الإجراء الكامل وخريطة ما يُحذف وما يبقى وطريق الاستعادة: **`docs/DELETION_RUNBOOK.md`**.
شواهد الحذف تُقرأ من:

```sql
SELECT created_at, entity_type, display_ref, reason, counts
FROM deletion_tombstones ORDER BY created_at DESC;
```

## القيم التي ينتظرها النظام من المدير بعد نشر v2.4.1

| ماذا | من أين | حالة الإنتاج |
| --- | --- | --- |
| مخصص **المستلزمات** و**النشاط** | `/budget` ← «تحديد المخصص» | `NULL` لكليهما |
| الحالة التشغيلية الصحيحة لـ**اليوم الوطني** و**متابعة الأداء المبنية على البيانات** و**التطوير المهني بالأثر** و**رياضيات الإتقان** | `/plan/consistency` | «مكتمل» بتقدم 0٪ و/أو بلا تاريخ اكتمال |
| حالات **31 مهمة لجان** | صفحة اللجنة ← «حالة تنفيذ المهمة» | كلها `NULL` |
| مهام **اللجنة الإدارية للمدرسة** و**لجنة التوجيه والإرشاد** | صفحة اللجنة ← «إضافة مهمة» | صفر مهمة لكل منهما |

النظام يوفّر المسار والتفسير وسجل التدقيق — ولا يخترع أي قيمة نيابةً عن المدير.

## الفحوصات قبل أي إصدار
```bash
npm run lint && npm run typecheck
npm run test          # وحدات + تكامل (قاعدة اختبار معزولة)
npm run test:e2e      # متصفح: عربي + جوال 390px + المساعد
npm run build
npx drizzle-kit check # لا انحراف في المخطط
```

**تحذير من بروفة v2.4.1 (D-049):** `next dev` يُكمل تدفّق استجابة إجراءات الخادم أسرع من
بناء الإنتاج، فبعض أعطال الواجهة لا تظهر إلا على الصورة الحقيقية. أي إصدار يمسّ إجراءات
الخادم يجب أن يُجرَّب على **صورة الإنتاج مقابل نسخة من بيانات الإنتاج** قبل النشر، لا على
خادم التطوير وحده. أدوات البروفة: `scripts/v241-clone-rehearsal.mjs` ·
`scripts/v241-visual-audit.mjs` · `scripts/v241-pdf-audit.ts`.

## النسخ والاستعادة
- يومي: `npm run backup:daily` — أسبوعي كامل: `npm run backup:weekly`.
- بروفة استعادة (إلزامية دورياً): `npm run restore:rehearsal` — توثق في `docs/BACKUP_REHEARSAL_LOG.md`.
- `BACKUP_OFFSITE_DIR` يجب أن يشير لوجهة خارج الجهاز.

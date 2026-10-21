# RUNBOOK — دفتر التشغيل اليومي

> المرجع السريع لتشغيل المنصة وتشخيصها. التفاصيل الكاملة: `docs/INSTALL_MAC_AR.md` (ماك) و`docs/DEPLOY_UBUNTU_AR.md` (أوبنتو).

## المرشَّح القادم — v2.6.0 «منصة التقارير» (لم يُنشر — بانتظار تصريح المالك)

> الفرع `feat/v2.6-reporting-platform`. النطاق والقرارات: `docs/requirements/v2.6-reporting-platform-specification.md`
> وD-055…D-064. **لا شيء مما يلي نُفِّذ على الإنتاج** — هذا التسلسل يُنفَّذ فقط بعد تصريح صريح.

### صورة المرشَّح تُبنى خارج مضيف الإنتاج (بلوكر §10)

**لا تُبنَ صورة الإصدار على الجهاز الذي يخدم 3080.** الجهاز الوحيد الذي يملك Docker هنا هو
مضيف الإنتاج نفسه، فالبناء يجري على عدّاء GitHub عبر سير `.github/workflows/rc-image.yml`:
يبني `linux/arm64` من `Dockerfile.production` نفسه، ويدفعها إلى GHCR بوسم الالتزام،
ويسجّل **البصمة الثابتة** في مُرفَق `v26-rc-image-record`، ثم يفحص تشغيلها مقابل قاعدة
Postgres معزولة (هجرة فقط، سجل 37، `/api/health` يردّ `2.6.0` والالتزام المضبوط).

### البوابة الأولى الإلزامية: تشغيل صورة arm64 نفسها قبل أي تبديل (لم تُنفَّذ)

فحص السير يجري بمعمارية العدّاء **amd64**، فهو يثبت أن الشيفرة تُقلع وتهاجر وتردّ سليمة،
**ولا يثبت أن ثنائيّة arm64 المدفوعة تعمل** — تلك لم تُشغَّل قط. لذلك أول خطوة عند التصريح
بالنشر — وقبل لمس 3080 بأي شكل — هي تشغيل البصمة نفسها على Mac mini مقابل **قاعدة معزولة
على منفذ مؤقّت**. أي فشل في السحب أو الهجرة أو الإقلاع أو الصحة أو الدخول = **توقّف تام**،
والإنتاج لم يُمسّ بعد لأن شيئاً لم يُبدَّل.

```bash
DIGEST=<sha256:… من DIGEST.txt للالتزام النهائي>
IMAGE=ghcr.io/fhalfaifi/alkhashah-school-platform/madrasa-app@$DIGEST
docker pull "$IMAGE"

# المعمارية المسحوبة يجب أن تكون arm64 فعلاً لا amd64
docker inspect "$IMAGE" --format '{{.Architecture}}/{{.Os}}'   # المتوقع: arm64/linux

# قاعدة معزولة مؤقتة — لا تشترك مع الإنتاج في شبكة ولا حجم ولا منفذ
docker network create v26-gate-net
docker run -d --name v26-gate-db --network v26-gate-net \
  -e POSTGRES_USER=madrasa -e POSTGRES_PASSWORD=gate_pw -e POSTGRES_DB=madrasa_gate postgres:16
GATE_DB="postgresql://madrasa:gate_pw@v26-gate-db:5432/madrasa_gate"

# هجرة فقط، ثم إقلاع على منفذ 3099 (ليس 3080)
docker run --rm --network v26-gate-net -e DATABASE_URL="$GATE_DB" -e MADRASA_ENV=production \
  "$IMAGE" sh -c "npx tsx src/db/migrate.ts"
docker run -d --name v26-gate-app --network v26-gate-net -p 127.0.0.1:3099:3080 \
  -e DATABASE_URL="$GATE_DB" -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e MADRASA_ENV=production "$IMAGE"

# الصحة تُعرّف الالتزام النهائي بالضبط، وصفحة الدخول تُصيَّر
curl -s http://127.0.0.1:3099/api/health    # status ok · db up · version 2.6.0 · commit <الالتزام النهائي>
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3099/login   # 200

# تنظيف البوابة قبل الانتقال إلى تسلسل النشر
docker rm -f v26-gate-app v26-gate-db && docker network rm v26-gate-net
```

عند النشر تُسحب الصورة بالبصمة لا بالوسم — فما يُنشر هو ما فُحص حرفياً. **الوسم
`0.1.0-v2_6_0-rc` متحرّك ويعاد استعماله مع كل دفع، فلا يُنشر به وحده أبداً:**

```bash
# 1) سحب الصورة المفحوصة ببصمتها الثابتة (من مُرفَق سير RC image)
DIGEST=<sha256:… من DIGEST.txt>
docker pull ghcr.io/fhalfaifi/alkhashah-school-platform/madrasa-app@$DIGEST
docker tag  ghcr.io/fhalfaifi/alkhashah-school-platform/madrasa-app@$DIGEST madrasa-app:0.1.0-v2_6_0-rc
docker inspect madrasa-app:0.1.0-v2_6_0-rc --format '{{.Id}}'   # يجب أن تطابق البصمة أعلاه

# 2) نسخة احتياطية مشفَّرة قبل النشر + تحقق استعادة معزول (كما v2.5.0)
bash scripts/backup-daily.sh && bash scripts/restore-rehearsal.sh

# 3) وسم صورة التراجع من الصورة الخادمة حالياً
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_6_0-$(date +%Y%m%d)

# 4) الهجرات عبر خدمة init (هجرة فقط — القاعدة لا يُعاد تشغيلها): السجل 34 → 37
#    0034 خمسة جداول إضافية؛ 0035 قادحا ثبات وفهرس جزئي؛ 0036 تضييق قادح صفّ ZIP
#    — لا صف قائم يُكتب أو يُحذف في أيٍّ منها
docker tag madrasa-app:0.1.0-v2_6_0-rc madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod run --rm init

# 5) تبديل التطبيق وفحص الصحة
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps --force-recreate app
curl -s http://127.0.0.1:3080/api/health
```

### فحص الدخان بعد النشر (قائمة v2.6)

- `/reports/archive` يفتح ويعرض «تقرير جديد»؛ إنشاء مسودة «تقرير مجال واحد» يعمل والمعاينة الحية تتغير بالمرشّحات.
- «اعتماد نهائي وترقيم» يمنح رقم `KHS-RPT-…` ويجمّد اللقطة؛ الاعتماد الثاني يعيد الرقم نفسه.
- المخرجات تتولّد في الخلفية (حالة التوليد «مكتمل») وتنزيل PDF/Word/Excel/ZIP يعمل، واسم الملف «العنوان - التاريخ».
- «معاينة الطباعة» تعرض الوثيقة نفسها؛ ترويستها **بلا** «مكتب التعليم» (D-057).
- تقرير حسّاس (أداء فردي) لا يظهر لمسؤول النظام في الأرشيف (D-013).
- تعديل تقرير نهائي أو حذفه يُرفض (خدمةً وقاعدةً — D-055).

### التراجع (لم يُنفَّذ — جاهز فقط)

```bash
# تراجع التطبيق وحده — لا إجراء على القاعدة: هجرات v2.6 إضافية كلها (جداول جديدة + قوادح
# على الجداول الجديدة حصراً)، فصورة v2.5.0 تعمل على السجل 37 كما عملت v2.4.1 على السجل 34
docker tag madrasa-app:0.1.0-prev-v2_6_0-<التاريخ> madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps --force-recreate app
curl -s http://127.0.0.1:3080/api/health
```

## الإصدار المنشور حالياً (خط الأساس)

| البند | القيمة |
| --- | --- |
| الإصدار | **v2.5.0** — نُشر 2026-08-06 (`docs/DEPLOYMENT_V2_5_0.md`) |
| الوسم | `v2.5.0` — الالتزام `39674ed` |
| الصورة | `madrasa-app:0.1.0` = `sha256:bcd629a54848…` (linux/arm64) |
| سجل الهجرات | **34** · الجداول **89** |
| المشروع/المنفذ | `madrasa-prod` · المضيف `3080` (القاعدة غير منشورة) |
| صور التراجع | `0.1.0-prev-v2_5_0-20260806` = v2.4.1 · `…-fix1-20260806` = المرشَّح · `…-fix2-20260806` = التصحيح الأول |
| النسخة الذهبية | `backups/gold/*-20260806-gold*` — مُتحقَّق منها باستعادة معزولة (578 كائناً، صفر اختلاف) |
| فحص الدخان | **26/26** على نسخة من الإنتاج بالصورة المنشورة |

> **التصحيح بعد النشر:** رُفض شرطان في فحص الدخان الأول فصُحِّحا ونُشرا:
> حدّ الأداء المنخفض صار له عنصر تحكّم على الشاشة (لم يكن `showLowThreshold` يُمرَّر من أي صفحة)،
> ومبلغ العملية المالية صار إلزامياً على الخادم (كان الفراغ يُخزَّن `NULL`). التفاصيل في
> `docs/DEPLOYMENT_V2_5_0.md` §5.

> **لا تبنِ صورة الإصدار على الجهاز الذي يخدم الإنتاج.** أثناء أول بناء تصحيحي قتل النظام حاوية
> التطبيق **خمس مرات** تحت ضغط الذاكرة، وأعادتها `unless-stopped` خلال 89–393 ms في كل مرة
> (القاعدة لم تُمسّ). البناء الثاني — بعد هدم نسخة التحقق لتحرير الذاكرة — لم يُسبّب أي إعادة
> تشغيل. حرِّر الذاكرة أولاً أو ابنِ على جهاز آخر، ولا تبنِ في ساعات العمل.

## الإصدار السابق

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
| **2026-08-04** | **v2.4.1** | **`6d7dacf`** | **`4b427c8e`** | **31** |
| **2026-08-06** | **v2.5.0** | **`39674ed`** | **`bcd629a5`** | **34** |

### التراجع السريع (بلا أي إجراء على القاعدة)

```bash
# العودة إلى v2.4.1 بالكامل (الهجرات 0031–0033 إضافية، فالصورة الأقدم تعمل على السجل 34)
docker tag madrasa-app:0.1.0-prev-v2_5_0-20260806 madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps --force-recreate app
curl -s http://127.0.0.1:3080/api/health
```

خطوة واحدة إلى الوراء بدل إصدار كامل:
`…-prev-v2_5_0-fix2-20260806` (التصحيح الأول) أو `…-prev-v2_5_0-fix1-20260806` (المرشَّح).

**لا إجراء على قاعدة البيانات في أي من الحالات** — أُثبت عملياً: صورة v2.4.1 خدمت الإنتاج سليمةً
على قاعدة مُهاجَرة (سجل 34، جداول 89) طوال الفترة بين تطبيق الهجرات وتبديل التطبيق.

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

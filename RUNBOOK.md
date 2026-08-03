# RUNBOOK — دفتر التشغيل اليومي

> المرجع السريع لتشغيل المنصة وتشخيصها. التفاصيل الكاملة: `docs/INSTALL_MAC_AR.md` (ماك) و`docs/DEPLOY_UBUNTU_AR.md` (أوبنتو).

## الإصدار المنشور حالياً (خط الأساس)

| البند | القيمة |
| --- | --- |
| الإصدار | **v2.4.0** — نُشر 2026-08-03 (`docs/DEPLOYMENT_V2_4.md`) |
| الوسم | `v2.4.0` — الالتزام `da8db16` |
| الصورة | `madrasa-app:0.1.0` = `madrasa-app:v2.4.0` = `sha256:2f69c724c625…` |
| صورة التراجع | `madrasa-app:0.1.0-prev-v2_4-20260803` = `sha256:7f5ff14a…` (v2.3) |
| سجل الهجرات | **29** · الجداول **86** |
| المشروع/المنفذ | `madrasa-prod` · المضيف `3080` (القاعدة غير منشورة) |
| النسخة الذهبية | `backups/gold/*-20260803-gold*` — مُتحقَّق منها باستعادة معزولة |

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

## الفحوصات قبل أي إصدار
```bash
npm run lint && npm run typecheck
npm run test          # وحدات + تكامل (قاعدة اختبار معزولة)
npm run test:e2e      # متصفح: عربي + جوال 390px + المساعد
npm run build
npx drizzle-kit check # لا انحراف في المخطط
```

## النسخ والاستعادة
- يومي: `npm run backup:daily` — أسبوعي كامل: `npm run backup:weekly`.
- بروفة استعادة (إلزامية دورياً): `npm run restore:rehearsal` — توثق في `docs/BACKUP_REHEARSAL_LOG.md`.
- `BACKUP_OFFSITE_DIR` يجب أن يشير لوجهة خارج الجهاز.

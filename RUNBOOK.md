# RUNBOOK — دفتر التشغيل اليومي

> المرجع السريع لتشغيل المنصة وتشخيصها. التفاصيل الكاملة: `docs/INSTALL_MAC_AR.md` (ماك) و`docs/DEPLOY_UBUNTU_AR.md` (أوبنتو).

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

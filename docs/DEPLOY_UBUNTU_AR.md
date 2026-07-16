# دليل النشر على خادم Ubuntu مع Tailscale (الاستضافة النهائية)

المبدأ: لا تعرض للإنترنت العام في الإصدار الأول — الوصول عبر شبكة Tailscale فقط.
تفعيل أي استضافة عامة لاحقاً يتطلب مراجعة أمنية منفصلة.

## 1) تجهيز الخادم
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw unattended-upgrades poppler-utils openssl
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # ثم أعد الدخول

# جدار ناري: رفض كل شيء وارد افتراضياً (Tailscale يعمل فوق UDP الصادر)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw enable
```

## 2) Tailscale + HTTPS (إلزامي)
سفاري على الآيفون يتطلب HTTPS للكاميرا وعامل الخدمة وتثبيت PWA والعمل دون اتصال — لذلك Tailscale Serve إلزامي وليس اختيارياً.
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# مرة واحدة لكل شبكة: فعل HTTPS (الشهادات) من لوحة تحكم Tailscale —
# الأمر يطبع رابط التفعيل إن لم يكن مفعلاً
sudo tailscale serve --bg localhost:3080
sudo tailscale serve status
# الوصول: https://<اسم-الجهاز>.<tailnet>.ts.net
```
- **ممنوع `tailscale funnel`** — يعرض التطبيق للإنترنت العام.
- الإعداد يبقى بعد إعادة التشغيل. ملف تعريف ارتباط الجلسة آمن (secure) تلقائياً عبر HTTPS، وفي الإنتاج دائماً.
- إجراءات الخادم خلف الوسيط مسموحة افتراضياً لمضيفي `*.ts.net`؛ لتشديد أكثر ثبت الاسم في `.env`:
  `TRUSTED_ORIGINS=<اسم-الجهاز>.<tailnet>.ts.net` — لا يثبت أي اسم جهاز في الشيفرة.

## 3) نشر التطبيق
```bash
git clone <مستودعك> madrasa && cd madrasa
cp .env.example .env
# عبئ: SESSION_SECRET، BACKUP_PASSPHRASE، وكلمة مرور قاعدة قوية POSTGRES_PASSWORD
# ثم حدث DATABASE_URL بكلمة المرور نفسها

docker compose --profile production up -d --build
# الحاوية تطبق الهجرات والبذرة تلقائياً عند الإقلاع
```
- ضع الملفات المرجعية في `reference_files/` قبل أول تشغيل ليستورد التوقيع والختم والخلفيات، أو ارفعها لاحقاً من داخل التطبيق.
- أذونات الملفات: `chmod -R 700 storage backups` والمالك مستخدم الخدمة فقط.

## 4) النسخ الاحتياطي المجدول
```bash
crontab -e
# يومي 2 صباحاً وأسبوعي فجر الجمعة
0 2 * * * cd /home/<user>/madrasa && docker compose exec -T app bash scripts/backup-daily.sh
0 3 * * 5 cd /home/<user>/madrasa && docker compose exec -T app bash scripts/backup-weekly.sh
```
- اضبط `BACKUP_OFFSITE_DIR` في `.env` إلى قرص خارجي مركب أو مجلد يزامن إلى عقدة Tailscale ثانية — **نسخة خارج الجهاز إلزامية**.
- نفذ بروفة استعادة بعد أول أسبوع: `bash scripts/restore-rehearsal.sh` ووثق نتيجتها.

## 5) التحديثات
```bash
git pull
docker compose --profile production up -d --build
```

## 6) التحقق بعد النشر
- الدخول يعمل عبر عنوان Tailscale، والحسابات الافتراضية غيرت كلمات مرورها.
- `docker compose logs app` بلا أخطاء، والنسخ اليومية تظهر في `backups/daily`.
- توليد تقرير PDF عربي يعمل (يتطلب Chromium داخل الصورة — مضمن في Dockerfile).

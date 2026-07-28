import type { NextConfig } from "next";

/**
 * الأصول الموثوقة لإجراءات الخادم خلف وسيط HTTPS (مثل Tailscale Serve):
 * تضبط عبر TRUSTED_ORIGINS (فواصل) دون تثبيت اسم جهاز بعينه في الشيفرة.
 * مثال: TRUSTED_ORIGINS=faheds-mac-mini.tailXXXX.ts.net
 * والنمط *.ts.net يسمح بأي جهاز على الشبكة الخاصة عند عدم الضبط.
 */
const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "*.ts.net")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * ترويسات الأمان (v2.2 §11.5.H) — لم تكن مضبوطة إطلاقاً قبل هذه المراجعة.
 *
 * النطاق مقصود ومحافظ: تُضبط هنا الترويسات القاطعة التي لا تُعطّل التطبيق. سياسة
 * المحتوى تمنع التأطير والكائنات وتقييد `base`/`form-action`، لكنها **لا تقيّد**
 * `script-src`/`style-src` بعد، لأن Next.js يحقن نصوصاً وأنماطاً مضمّنة ويحتاج تقييدها
 * إلى وسيط يولّد nonce لكل طلب. تقييدهما مسجَّل كعمل لاحق في تقرير الهندسة بدل ادّعاء
 * سياسة صارمة غير مطبَّقة.
 */
const securityHeaders = [
  // منع التأطير — حماية من hijacking الواجهة. `frame-ancestors` هو البديل الحديث،
  // و`X-Frame-Options` يبقى للمتصفّحات الأقدم.
  { key: "X-Frame-Options", value: "DENY" },
  // منع تخمين نوع المحتوى — يمنع تفسير مرفق كصفحة HTML
  { key: "X-Content-Type-Options", value: "nosniff" },
  // لا يُسرَّب مسار داخلي إلى أي وجهة خارجية
  { key: "Referrer-Policy", value: "same-origin" },
  // تعطيل واجهات الجهاز غير المستعملة (C5 مؤجَّل — لا كاميرا ولا موقع)
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js (App Router) يحقن نصوص التمهيد والترطيب مضمّنةً داخل الصفحة. تقييد
      // `script-src` إلى 'self' وحده يمنعها فلا تُرطَّب الصفحة ولا يظهر محتواها — وهذا
      // ما كشفته بروفة Playwright عند أول محاولة. التقييد الحقيقي يحتاج وسيطاً يولّد
      // nonce لكل طلب ويمرّره إلى Next، وهو مسجَّل كعمل لاحق في تقرير الهندسة.
      // ما دون ذلك من التوجيهات فعّال ومطبَّق فعلاً.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind وNext يحقنان أنماطاً مضمّنة كذلك
      "style-src 'self' 'unsafe-inline'",
      // الصور تشمل data: (الشعارات وبيانات QR تُضمَّن كـdata URI) وblob: للمعاينة
      "img-src 'self' data: blob:",
      // الخطوط مضمَّنة محلياً — لا مصدر بعيد إطلاقاً
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      // إطار معاينة القالب يُحمَّل من srcDoc داخل sandbox فارغ
      "frame-src 'self' blob:",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "playwright", "exceljs", "@napi-rs/canvas", "pdfjs-dist", "adm-zip", "pg"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
      allowedOrigins: trustedOrigins,
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

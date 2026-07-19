/* عامل الخدمة — أمان التخزين المؤقت أولاً.
 *
 * القاعدة الحاكمة: لا نخبّئ أبداً صفحات HTML المُصادَق عليها ولا حمولات RSC ولا
 * إجراءات الخادم — تلك دائماً «الشبكة أولاً» حتى لا يُقدَّم للمدير محتوى قديم بعد
 * كل نشر (وهو سبب محتمل لظاهرة «الأزرار لا تعمل»: مستند/شيفرة قديمة تطلب مقاطع
 * JS لم تعد موجودة → ChunkLoadError → لا تفاعل).
 *
 * نخبّئ فقط: (1) صفحة الفحص دون اتصال المخصصة، (2) أصول Next الثابتة المُجزّأة
 * (immutable hashed) التي لا يتغير محتواها عند تغير اسمها — لذا التخزين المؤقت أولاً آمن.
 *
 * اسم المخبأ يحمل رقم إصدار؛ عند تفعيل نسخة جديدة تُحذف كل المخابئ القديمة.
 * ارفع الرقم (madrasa-v3 ...) عند أي تغيير في استراتيجية التخزين المؤقت. */
const CACHE = "madrasa-v2";
const OFFLINE_URL = "/building/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// يسمح للصفحة بطلب تفعيل النسخة الجديدة فوراً (زر «تحديث الآن»)
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // إجراءات الخادم/الطفرات: الشبكة فقط، لا تُخبّأ أبداً
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // نطاقات خارجية: لا تتدخل

  // حمولات RSC/التنقل (App Router) والمستندات: الشبكة أولاً دائماً — لا محتوى مصادَق قديم
  const isRsc = url.searchParams.has("_rsc") || req.headers.get("RSC") === "1";
  const isDocument = req.mode === "navigate" || req.destination === "document";
  if (isRsc || isDocument) {
    if (url.pathname === OFFLINE_URL) {
      // الاستثناء الوحيد: صفحة الفحص دون اتصال — شبكة أولاً مع الرجوع للمخبأ عند الانقطاع
      event.respondWith(
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(OFFLINE_URL, copy));
            return res;
          })
          .catch(() => caches.match(OFFLINE_URL)),
      );
    }
    return; // بقية التنقلات: الشبكة فقط (سلوك المتصفح الافتراضي)
  }

  // أصول Next الثابتة المُجزّأة (immutable): المخبأ أولاً ثم الشبكة
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

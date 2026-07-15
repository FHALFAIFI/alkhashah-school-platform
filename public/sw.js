/* عامل الخدمة — وضع الفحص دون اتصال فقط.
   يخبئ صفحة الفحص الميداني وأصولها الثابتة؛ الاعتمادات والتقارير الرسمية تتطلب اتصالاً. */
const CACHE = "madrasa-offline-v1";
const OFFLINE_URL = "/building/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  // صفحة الفحص دون اتصال: شبكة أولاً مع الرجوع للمخبأ
  if (url.pathname === OFFLINE_URL) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  // أصول Next الثابتة (مسماة بالتجزئة): مخبأ أولاً
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          }),
      ),
    );
  }
});

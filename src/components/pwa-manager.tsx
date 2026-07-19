"use client";

import { useEffect, useState } from "react";

/**
 * مدير PWA عام (يُركّب في تخطيط التطبيق):
 * 1) يسجّل عامل الخدمة على كل الصفحات (نطاق «/») — عامل الخدمة الجديد «الشبكة أولاً»
 *    للتنقلات فلا يُقدَّم محتوى قديم بعد النشر.
 * 2) يعرض إشعاراً عربياً «يتوفر تحديث جديد للمنصة» مع زر «تحديث الآن» عند توفّر نسخة أحدث.
 * 3) استرداد مُتحكَّم من ChunkLoadError: عند فشل تحميل مقطع JS (شيفرة قديمة مخبّأة بعد
 *    نشر)، ينظّف المخابئ ويعيد التحميل مرة واحدة فقط (علم في sessionStorage يمنع الحلقة).
 *
 * لا يعطّل أي شيء إن كان عامل الخدمة غير مدعوم؛ التطبيق يعمل كاملاً بدونه.
 */

const RECOVERY_FLAG = "madrasa-chunk-recovery";

async function recoverFromChunkError() {
  if (sessionStorage.getItem(RECOVERY_FLAG)) return; // نفّذنا الاسترداد بالفعل — لا تُعِد الحلقة
  sessionStorage.setItem(RECOVERY_FLAG, "1");
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // تجاهل — سنعيد التحميل على أي حال
  }
  location.reload();
}

function isChunkError(msg: string): boolean {
  return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    msg,
  );
}

export function PwaManager() {
  const [updateReady, setUpdateReady] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    // استرداد ChunkLoadError (يعمل حتى دون عامل خدمة)
    const onError = (e: ErrorEvent) => {
      if (e?.message && isChunkError(e.message)) void recoverFromChunkError();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = String(e?.reason?.message ?? e?.reason ?? "");
      if (isChunkError(msg)) void recoverFromChunkError();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // مسح علم الاسترداد بعد تحميل ناجح كامل حتى يبقى متاحاً للنشر التالي
    const clearFlag = () => sessionStorage.removeItem(RECOVERY_FLAG);
    window.addEventListener("load", clearFlag);

    let reg: ServiceWorkerRegistration | undefined;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          reg = registration;
          // نسخة منتظرة بالفعل عند التحميل
          if (registration.waiting && navigator.serviceWorker.controller) {
            setWaitingWorker(registration.waiting);
            setUpdateReady(true);
          }
          registration.addEventListener("updatefound", () => {
            const nw = registration.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              // نسخة جديدة جاهزة ويوجد متحكّم حالي ⇒ هذا تحديث (وليس أول تثبيت)
              if (nw.state === "installed" && navigator.serviceWorker.controller) {
                setWaitingWorker(nw);
                setUpdateReady(true);
              }
            });
          });
        })
        .catch(() => {});

      // عند تفعيل عامل الخدمة الجديد فعلاً، أعد التحميل مرة واحدة لتطبيقه
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
      });
    }

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("load", clearFlag);
      void reg;
    };
  }, []);

  const applyUpdate = () => {
    waitingWorker?.postMessage("skip-waiting");
    setUpdateReady(false);
  };

  if (!updateReady) return null;

  return (
    <div
      role="alert"
      className="no-print fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-t-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 shadow-lg"
    >
      <span className="font-medium">يتوفر تحديث جديد للمنصة</span>
      <button
        onClick={applyUpdate}
        className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0"
      >
        تحديث الآن
      </button>
    </div>
  );
}

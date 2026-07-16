"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** شريط تنبيه يظهر عند انقطاع الاتصال — مع رابط وضع الفحص دون اتصال */
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);

  if (!offline) return null;
  return (
    <div className="no-print bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      لا يوجد اتصال بالشبكة — يمكنك متابعة <a href="/building/offline" className="font-medium underline">الفحص الميداني دون اتصال</a>، وستُزامن النتائج تلقائياً عند عودة الاتصال.
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AssistantChat } from "./assistant-chat";

/**
 * مرساة المساعد — زر عائم يفتح لوحة جانبية على الحاسب وواجهة كاملة الشاشة على الجوال.
 * تظهر على كل الصفحات لمن يملك صلاحية ai.use عندما يكون الذكاء الاصطناعي مفعلاً.
 */
export function AssistantDock({ csrfToken }: { csrfToken: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // قفل تمرير الصفحة أثناء الفتح على الجوال
  useEffect(() => {
    if (!open) return;
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // صفحة المساعد الكاملة تغني عن اللوحة
  if (pathname.startsWith("/assistant")) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="فتح مساعد المدير الذكي"
          className="no-print fixed bottom-[max(1rem,env(safe-area-inset-bottom))] start-4 z-30 flex min-h-12 items-center gap-2 rounded-full bg-brand-700 px-4 text-sm font-medium text-white shadow-lg hover:bg-brand-800"
        >
          <span aria-hidden>✦</span>
          المساعد الذكي
        </button>
      )}

      {open && (
        <div className="no-print fixed inset-0 z-50 flex flex-col bg-white lg:inset-y-0 lg:end-0 lg:start-auto lg:w-[420px] lg:border-s lg:border-sand-200 lg:shadow-xl">
          <div
            className="flex items-center justify-between border-b border-sand-200 px-3 py-2"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg text-brand-700" aria-hidden>✦</span>
              <span className="font-bold text-brand-900">مساعد المدير الذكي</span>
            </div>
            <div className="flex items-center gap-1">
              <a
                href="/assistant"
                className="flex min-h-11 items-center rounded-lg px-2 text-xs text-gray-500 hover:bg-sand-100 lg:min-h-0 lg:py-1"
              >
                فتح الصفحة الكاملة
              </a>
              <button
                onClick={() => setOpen(false)}
                aria-label="إغلاق المساعد"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-sand-100"
              >
                ✕
              </button>
            </div>
          </div>
          <AssistantChat csrfToken={csrfToken} compact />
        </div>
      )}
    </>
  );
}

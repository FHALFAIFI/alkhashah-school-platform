"use client";

import { useEffect } from "react";

/**
 * حدّ الخطأ داخل التطبيق. لا يُعرض نصّ الاستثناء التقني الخام (بالإنجليزية) للمستخدم أبداً —
 * يُسجَّل بأمان في السجلّ فقط، وتُعرَض رسالة عربية واضحة مع مسار استرداد (D-029).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // تسجيل تقني آمن (وحدة التحكم/سجلّ الخادم) دون عرضه في الواجهة
    console.error("[app-error]", error?.digest ?? "", error);
  }, [error]);

  const isChunk = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(error?.message ?? "");

  return (
    <div className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="font-bold text-red-800">تعذّر إتمام العملية</p>
      <p className="mt-1 text-sm text-red-700">
        {isChunk
          ? "صدر تحديث جديد للمنصة. أعد التحميل للمتابعة."
          : "حدث خطأ غير متوقع. أعد المحاولة، وإن استمر الخطأ فحدّث الصفحة أو سجّل خروجك ثم ادخل من جديد."}
      </p>
      {error?.digest && <p className="mt-2 text-xs text-red-400">رمز المرجع: {error.digest}</p>}
      <button
        onClick={() => {
          if (isChunk && typeof window !== "undefined") {
            window.location.reload();
            return;
          }
          reset();
        }}
        className="mt-4 min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        {isChunk ? "تحديث الآن" : "إعادة المحاولة"}
      </button>
    </div>
  );
}

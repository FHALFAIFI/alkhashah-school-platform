"use client";

/**
 * حدّ الخطأ الجذري — يلتقط الأخطاء التي تقع خارج تخطيط التطبيق (بما فيها أخطاء
 * التخطيط الجذري). يجب أن يضمّ وسمي <html> و<body> لأنه يستبدل المستند كاملاً.
 * رسائل عربية موجّهة للمستخدم مع مسار استرداد واضح.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunk = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(error?.message ?? "");
  return (
    <html lang="ar" dir="rtl" translate="no">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf9f7", margin: 0 }}>
        <div
          style={{
            maxWidth: 480,
            margin: "12vh auto",
            padding: 24,
            textAlign: "center",
            border: "1px solid #fecaca",
            background: "#fef2f2",
            borderRadius: 16,
          }}
        >
          <p style={{ fontWeight: 700, color: "#991b1b", margin: 0 }}>حدث خطأ غير متوقع</p>
          <p style={{ color: "#b91c1c", marginTop: 8, fontSize: 14 }}>
            {isChunk
              ? "صدر تحديث جديد للمنصة. أعد التحميل للمتابعة."
              : "تعذر إتمام العملية — أعد المحاولة، وإن استمر الخطأ سجّل خروجك ثم ادخل من جديد."}
          </p>
          <button
            onClick={() => {
              // للأخطاء الناتجة عن مقاطع قديمة: نظّف ثم أعد التحميل بدل مجرد إعادة العرض
              if (isChunk && typeof window !== "undefined") {
                window.location.reload();
                return;
              }
              reset();
            }}
            style={{
              marginTop: 16,
              minHeight: 44,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#4338ca",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {isChunk ? "تحديث الآن" : "إعادة المحاولة"}
          </button>
        </div>
      </body>
    </html>
  );
}

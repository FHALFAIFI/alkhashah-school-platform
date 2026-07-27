"use client";

import { useRouter } from "next/navigation";

/**
 * زر «العودة» موحّد (RTL): يعيد المستخدم إلى الصفحة السابقة ذات المعنى.
 *
 * التصميم للسلامة:
 * - يُصيَّر كرابط حقيقي إلى `fallbackHref` (يعمل بلا JavaScript، وعند فتح الرابط مباشرةً،
 *   ويسمح بالفتح في تبويب جديد بالنقر الأوسط/الأيمن).
 * - مع توفّر JavaScript وتاريخ تصفّح فعلي (`history.length > 1`) نفضّل `router.back()`
 *   للعودة إلى الصفحة الفعلية السابقة بدل وجهة ثابتة — فلا نعود دائماً إلى الرئيسية.
 * - `router.back()` يستعمل تاريخ المتصفّح الحقيقي، فلا يُحدث حلقة ذهاب/إياب بين صفحتين.
 * - عند الوصول المباشر (لا تاريخ سابق) يعمل الرابط الاحتياطي الآمن.
 */
export function BackButton({
  fallbackHref,
  label = "العودة",
}: {
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <a
      href={fallbackHref}
      onClick={(e) => {
        // تفضيل العودة عبر التاريخ الحقيقي متى وُجد؛ وإلا يعمل الرابط الاحتياطي افتراضياً.
        if (typeof window !== "undefined" && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-sand-100 lg:min-h-0"
    >
      {/* شيفرون يشير يميناً — اتجاه «الرجوع» في واجهة RTL؛ SVG لتفادي التباس اتجاه المحارف */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{label}</span>
    </a>
  );
}

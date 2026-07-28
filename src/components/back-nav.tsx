"use client";

import { usePathname } from "next/navigation";
import { BackButton } from "./back-button";
import { parentRouteFor } from "@/lib/navigation";

/**
 * زر «العودة» العام (v2.2 §C) — يُركَّب مرة واحدة في تخطيط التطبيق فيظهر في كل صفحة
 * فرعية تلقائياً، بدل زر مكتوب يدوياً في كل صفحة (فلا صفحة منسيّة ولا سلوك متضارب).
 *
 * الوجهة تأتي من `parentRouteFor` — الصفحة الأب المنطقية لا الرئيسية دائماً — ويتكفّل
 * `BackButton` بتفضيل تاريخ المتصفّح الحقيقي متى وُجد، مع رابط احتياطي فعلي يعمل عند
 * الفتح المباشر وبلا JavaScript.
 *
 * `usePathname` يعيد المسار الفعلي بعد التوجيه، فالزر يبقى صحيحاً بعد الحفظ وبعد الإلغاء
 * وبعد خطأ التحقق (الصفحة نفسها لا تتغيّر في هذه الحالات).
 */
export function BackNav() {
  const pathname = usePathname();
  const parent = parentRouteFor(pathname ?? "/");
  if (!parent) return null;
  return (
    <div className="mb-3 print:hidden">
      <BackButton fallbackHref={parent} />
    </div>
  );
}

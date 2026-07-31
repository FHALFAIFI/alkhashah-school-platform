"use client";

/**
 * الإرشاد التشغيلي أعلى الصفحات (v2.3 §4):
 * - خطوات قصيرة تطابق سير العمل الفعلي الحالي (لا تعليمات قديمة).
 * - قابل للطي، وحالة الطي تُتذكّر لكل صفحة في المتصفح.
 * - لا يستهلك مساحة مفرطة: عنوان سطر واحد مطوياً، وقائمة مدمجة مفتوحاً.
 *
 * عنصر <details> أصلي: يعمل بلا JavaScript، والتذكّر تحسين تدريجي بعد الترطيب
 * (تعديل DOM عبر ref لا setState — استقرار الترطيب D-029).
 */

import { useEffect, useRef } from "react";

export function Tutorial({
  id,
  title = "طريقة العمل في هذه الصفحة",
  steps,
  note,
}: {
  /** مفتاح تذكّر حالة الطي — ثابت لكل صفحة */
  id: string;
  title?: string;
  steps: string[];
  /** ملاحظة ختامية اختيارية (مثل توضيح أن الشواهد غير إلزامية) */
  note?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const storageKey = `madrasa-tutorial-${id}-v1`;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "closed" && ref.current) {
        ref.current.open = false;
      }
    } catch {
      // التذكّر تحسين فقط
    }
  }, [storageKey]);

  return (
    <details
      ref={ref}
      open
      onToggle={(e) => {
        try {
          window.localStorage.setItem(storageKey, e.currentTarget.open ? "open" : "closed");
        } catch {
          // التذكّر تحسين فقط
        }
      }}
      className="group rounded-xl border border-brand-100 bg-brand-50/40 print:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 px-4 py-2 text-sm font-medium text-brand-900 lg:min-h-0">
        <span aria-hidden className="text-brand-600 transition group-open:rotate-90">◂</span>
        {title}
        <span className="ms-auto text-xs font-normal text-gray-400 group-open:hidden">اضغط للعرض</span>
      </summary>
      <div className="px-4 pb-3">
        <ol className="ms-4 list-decimal space-y-0.5 text-sm text-gray-700">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {note && <p className="mt-2 text-xs text-brand-800">{note}</p>}
      </div>
    </details>
  );
}

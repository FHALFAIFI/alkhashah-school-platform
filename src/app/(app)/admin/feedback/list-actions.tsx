"use client";

/** إجراءات قائمة الملاحظات: طباعة (عرض عربي) وتنزيل Excel محافظاً على المرشّحات الحالية */
export function FeedbackListActions({ exportHref }: { exportHref: string }) {
  const btn = "rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => window.print()} className={btn}>
        طباعة
      </button>
      <a href={exportHref} className={btn}>
        تنزيل Excel
      </a>
    </div>
  );
}

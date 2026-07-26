"use client";

import { useFormStatus } from "react-dom";

/**
 * زر إرسال موحد: يتعطل تلقائياً أثناء التنفيذ (يمنع الإرسال المزدوج)،
 * ويدعم رسالة تأكيد عربية اختيارية قبل التنفيذ للأفعال الحاسمة.
 */
export function SubmitButton({
  children,
  variant = "primary",
  confirmText,
}: {
  children: React.ReactNode;
  variant?: "primary" | "danger" | "secondary";
  confirmText?: string;
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-brand-600 text-white hover:bg-brand-700"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-700"
        : "border border-sand-200 bg-white text-gray-700 hover:bg-sand-100";
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={
        confirmText
          ? (e) => {
              if (!window.confirm(confirmText)) e.preventDefault();
            }
          : undefined
      }
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 ${cls}`}
    >
      {pending && (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {/* لفّ المحتوى في عنصر ثابت: يمنع أن يكون نصاً مجاوراً مباشرةً للمؤشر الشرطي أعلاه
          (يثبّت بنية الأشقّاء أمام مطابقة React — جزء من معالجة insertBefore، D-029) */}
      <span>{children}</span>
    </button>
  );
}

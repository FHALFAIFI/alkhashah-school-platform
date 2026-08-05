"use client";

import { useState, useTransition } from "react";
import { emailDocumentAction, type EmailState } from "@/app/(app)/integrations-actions";
import { useRefreshAfterTransition } from "@/components/form-reset";

/** لوحة المساعد الذكي — تظهر فقط عند تفعيل الذكاء الاصطناعي؛ مخرجاتها مسودات للمراجعة البشرية */

/** إرسال وثيقة بالبريد: مسودة M365 عند التفعيل، وإلا بديل يدوي واضح */
export function EmailDocumentButton({
  docId,
  docNumber,
  pdfFileId,
  label = "بريد",
  triggerClassName = "text-xs text-brand-700 underline",
}: {
  docId: string;
  docNumber: string;
  pdfFileId: string | null;
  label?: string;
  triggerClassName?: string;
}) {
  const [state, setState] = useState<EmailState>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={triggerClassName}>
        {label}
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-sand-200 bg-sand-50 p-2 text-start">
      <form
        action={(fd) => startTransition(async () => setState(await emailDocumentAction(docId, fd)))}
        className="flex items-center gap-1"
      >
        <input name="to" type="email" dir="ltr" placeholder="بريد المستلم (اختياري)" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
        <button disabled={pending} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">إنشاء مسودة</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400">×</button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      {state?.webLink && (
        <p className="mt-1 text-xs text-emerald-700">
          أنشئت المسودة — <a href={state.webLink} target="_blank" rel="noopener noreferrer" className="underline">افتحها للمراجعة والإرسال</a>. لا يرسل النظام البريد نهائياً بالنيابة عنك.
        </p>
      )}
      {state?.fallback && (
        <p className="mt-1 text-xs text-amber-700">
          تكامل البريد غير مفعل — البديل: {pdfFileId && (
            <a href={`/api/files/${pdfFileId}`} className="underline">نزل PDF</a>
          )}{" "}
          ثم <a href={`mailto:?subject=${encodeURIComponent(docNumber)}`} className="underline">افتح مسودة بريد</a> وأرفق الملف يدوياً.
        </p>
      )}
    </div>
  );
}

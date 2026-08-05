"use client";

/** زر اعتماد المدير اليدوي لملف «قيد الاعتماد» — D-032 */

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { acceptFileAction, type ActionState } from "./actions";
import { useRefreshOnSuccess } from "@/components/form-reset";

export function AcceptFileButton({ fileId }: { fileId: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(acceptFileAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const router = useRouter();

  // تحديث فوري بعد نجاح الإجراء — لا شاشة قديمة تحتاج تحديثاً يدوياً
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="fileId" value={fileId} />
      {state?.error && (
        <span role="alert" className="me-2 text-xs text-red-700">
          {state.error}
        </span>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50 lg:min-h-0"
      >
        {pending ? "جارٍ الاعتماد…" : "اعتماد"}
      </button>
    </form>
  );
}

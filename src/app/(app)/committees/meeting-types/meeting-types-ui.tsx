"use client";

import { useActionState, useState, useTransition } from "react";
import { addMeetingTypeAction, toggleMeetingTypeActiveAction, deleteMeetingTypeAction, type ActionState } from "../actions";
import { setMeetingTypeSignatureAction } from "../task-actions";
import { Field, SubmitButton } from "@/components/ui";
import { useResetOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";
import { useRefreshOnSuccess } from "@/components/form-reset";

export function AddMeetingTypeForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(addMeetingTypeAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  // مرجع تفريغ الحقول بعد النجاح — يُستدعى دائماً (قواعد الخطّافات)
  const formRef = useResetOnSuccess(state);
  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="min-w-56 flex-1">
        <Field label="اسم النوع (عربي)" name="nameAr" />
      </div>
      <SubmitButton variant="secondary">إضافة نوع</SubmitButton>
    </form>
  );
}

export function MeetingTypeRow({ id, active, used, requiresSignature }: { id: string; active: boolean; used: boolean; requiresSignature: boolean }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"}`}>
        {active ? "مُفعَّل" : "مُعطَّل"}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs ${requiresSignature ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"}`}>
        {requiresSignature ? "يتطلب توقيعاً" : "بلا توقيع إلزامي"}
      </span>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { setError(null); const r = await setMeetingTypeSignatureAction(id, !requiresSignature); if (r?.error) setError(r.error); })}
        className="rounded-lg border border-sand-200 px-3 py-1 text-xs hover:bg-sand-100 disabled:opacity-50"
      >
        {requiresSignature ? "إلغاء اشتراط التوقيع" : "اشتراط التوقيع"}
      </button>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { setError(null); const r = await toggleMeetingTypeActiveAction(id, !active); if (r?.error) setError(r.error); })}
        className="rounded-lg border border-sand-200 px-3 py-1 text-xs hover:bg-sand-100 disabled:opacity-50"
      >
        {active ? "تعطيل" : "تفعيل"}
      </button>
      {used ? (
        <span className="text-xs text-gray-400" title="النوع مستخدم في اجتماعات — لا يُحذف نهائياً">مستخدم — لا يُحذف</span>
      ) : (
        <button
          disabled={pending}
          onClick={() => startTransition(async () => { setError(null); const r = await deleteMeetingTypeAction(id); if (r?.error) setError(r.error); })}
          className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          حذف
        </button>
      )}
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

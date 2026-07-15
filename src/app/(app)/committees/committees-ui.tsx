"use client";

import { useActionState } from "react";
import { createCommitteeFromTemplateAction, createPlcAction, type ActionState } from "./actions";
import { Field, TextArea, SubmitButton } from "@/components/ui";

export function FormCommitteeButton({ templateId, name }: { templateId: string; name: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createCommitteeFromTemplateAction, null);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="templateId" value={templateId} />
      <button
        disabled={pending}
        className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-sm text-brand-800 hover:bg-brand-50 disabled:opacity-50"
      >
        تشكيل: {name}
      </button>
      {state?.error && <span className="ms-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function NewPlcForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createPlcAction, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      <Field label="اسم المجتمع" name="nameAr" required />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextArea label="الأهداف" name="objectives" rows={2} />
        <TextArea label="المخرجات المستهدفة" name="outputs" rows={2} />
      </div>
      <SubmitButton>إنشاء مجتمع التعلم</SubmitButton>
    </form>
  );
}

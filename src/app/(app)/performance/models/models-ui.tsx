"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createModelAction, addIndicatorAction, deleteIndicatorAction, approveModelAction, reopenModelAction,
  type ActionState,
} from "../actions";
import { Field, SubmitButton } from "@/components/ui";

export function NewModelForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createModelAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      <div className="min-w-64 flex-1">
        <Field label="اسم النموذج" name="nameAr" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">الفئة</label>
        <select name="audience" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="موظف">موظف — مصمم داخلياً</option>
          <option value="معلم">معلم — للنماذج الرسمية</option>
        </select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="official" />
        نموذج رسمي (منقول نصياً من ملف الوزارة بعد فحص بصري)
      </label>
      <SubmitButton>إنشاء</SubmitButton>
    </form>
  );
}

export function IndicatorForm({ modelId }: { modelId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addIndicatorAction.bind(null, modelId), null);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-64 flex-1">
        <Field label="مؤشر جديد" name="nameAr" />
      </div>
      <div className="w-28">
        <Field label="الوزن ٪" name="weight" type="number" required />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="requiresEvidence" defaultChecked />
        يتطلب شواهد
      </label>
      <SubmitButton variant="secondary">إضافة مؤشر</SubmitButton>
    </form>
  );
}

export function DeleteIndicatorButton({ indicatorId }: { indicatorId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => deleteIndicatorAction(indicatorId))}
      className="text-xs text-red-500 hover:underline"
    >
      حذف
    </button>
  );
}

export function ApproveModelButton({ modelId, disabled, total }: { modelId: string; disabled: boolean; total: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="text-end">
      {error && <div role="alert" className="mb-1 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveModelAction(modelId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد النموذج
      </button>
      {disabled && <p className="mt-1 text-xs text-amber-600">مجموع الأوزان {total}٪ — يجب 100٪ تماماً</p>}
    </div>
  );
}

export function ReopenModelForm({ modelId }: { modelId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await reopenModelAction(modelId, fd);
          if (res?.error) setError(res.error);
        })
      }
      className="flex items-center gap-2"
    >
      {error && <span className="text-xs text-red-600">{error}</span>}
      <input name="reason" required placeholder="سبب إعادة الفتح (إلزامي)" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <button disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50">
        إعادة فتح
      </button>
    </form>
  );
}

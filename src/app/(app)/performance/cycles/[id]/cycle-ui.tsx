"use client";

import { useActionState, useState, useTransition } from "react";
import { createSessionAction, createImprovementPlanAction, advanceImprovementPlanAction, type ActionState } from "../../actions";
import { Field, TextArea, SubmitButton } from "@/components/ui";

export function NewSessionForm({ cycleId }: { cycleId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createSessionAction.bind(null, cycleId), null);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">نوع الجلسة</label>
        <select name="sessionType" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="تخطيط">تخطيط الأداء (مرة واحدة)</option>
          <option value="منتصف">مراجعة منتصف العام (مرة واحدة)</option>
          <option value="نهائي">التقييم النهائي (مرة واحدة)</option>
          <option value="زيارة">زيارة صفية (غير محدودة)</option>
          <option value="متابعة">جلسة متابعة</option>
        </select>
      </div>
      <div>
        <Field label="التاريخ" name="sessionDate" type="date" />
      </div>
      <SubmitButton>إنشاء جلسة</SubmitButton>
    </form>
  );
}

export function ImprovementPlanForm({ cycleId, suggested }: { cycleId: string; suggested: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createImprovementPlanAction.bind(null, cycleId), null);
  return (
    <form action={formAction} className="space-y-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <input type="hidden" name="suggested" value={suggested ? "true" : "false"} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label="خطة تحسين جديدة (قرار يدوي)" name="title" required />
        </div>
        <div className="w-40">
          <Field label="المدة" name="duration" placeholder="مثال: فصل دراسي" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextArea label="الأهداف" name="goals" rows={2} />
        <TextArea label="الإجراءات" name="actions" rows={2} />
      </div>
      <SubmitButton variant="secondary">إنشاء الخطة</SubmitButton>
    </form>
  );
}

/** ترقية حالة خطة التحسين: مسودة → قيد التنفيذ → مكتملة (قرار يدوي) */
export function PlanStatusControl({ planId, status }: { planId: string; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const actionLabel = status === "مسودة" ? "بدء التنفيذ" : "إكمال الخطة";
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await advanceImprovementPlanAction(planId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg border border-sand-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-sand-100 disabled:opacity-50"
      >
        {actionLabel}
      </button>
    </span>
  );
}

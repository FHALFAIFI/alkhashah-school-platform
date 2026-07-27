"use client";

import { useActionState } from "react";
import { submitFollowupAction, type ActionState } from "../actions";
import { SubmitButton } from "@/components/ui";
import { FOLLOWUP_STATUSES } from "@/lib/plan/followup";

/** نموذج المتابعة الأسبوعية المضمن — ملاحظة + نسبة إنجاز مُدخلة مباشرةً + حالة تنفيذ (D-024)،
 *  بلا تمرير أفقي على الجوال */
export function FollowupForm({ programId, defaultStatus, defaultProgress = 0 }: { programId: string; defaultStatus?: string; defaultProgress?: number }) {
  const [state, formAction] = useActionState<ActionState, FormData>(submitFollowupAction.bind(null, programId), null);
  return (
    <form action={formAction} className="mt-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="mb-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={`fu-note-${programId}`} className="mb-1 block text-xs text-gray-500">متابعة هذا الأسبوع</label>
          {/* حقل تجاري اختياري (v2.1 §H): يُخزَّن "" عند الفراغ */}
          <input
            id={`fu-note-${programId}`}
            name="note"
            placeholder="ماذا أنجز؟ وما العوائق؟"
            className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="basis-28">
          <label htmlFor={`fu-progress-${programId}`} className="mb-1 block text-xs text-gray-500">نسبة الإنجاز (٪)</label>
          <input
            id={`fu-progress-${programId}`}
            name="progress"
            type="number"
            min={0}
            max={100}
            defaultValue={defaultProgress}
            className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="basis-36">
          <label htmlFor={`fu-status-${programId}`} className="mb-1 block text-xs text-gray-500">حالة التنفيذ</label>
          <select
            id={`fu-status-${programId}`}
            name="executionStatus"
            defaultValue={(FOLLOWUP_STATUSES as readonly string[]).includes(defaultStatus ?? "") ? defaultStatus : "في المسار"}
            className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {FOLLOWUP_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <SubmitButton variant="secondary">تسجيل المتابعة</SubmitButton>
      </div>
    </form>
  );
}

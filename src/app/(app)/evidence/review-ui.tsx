"use client";

import { useActionState, useState } from "react";
import { reviewEvidenceAction, type ActionState } from "./actions";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";

/** مراجعة شاهد من سجل الشواهد: قبول مباشر أو رفض مع سبب */
export function EvidenceReviewControl({ evidenceId }: { evidenceId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(reviewEvidenceAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const [rejecting, setRejecting] = useState(false);

  return (
    <div className="space-y-1">
      {state?.error && <div role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <form action={formAction}>
          <input type="hidden" name="evidenceId" value={evidenceId} />
          <input type="hidden" name="decision" value="مقبول" />
          <SubmitButton variant="secondary">قبول</SubmitButton>
        </form>
        <button
          type="button"
          onClick={() => setRejecting(!rejecting)}
          className="min-h-11 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 lg:min-h-0"
        >
          {rejecting ? "إلغاء" : "رفض"}
        </button>
      </div>
      {rejecting && (
        <form action={formAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="evidenceId" value={evidenceId} />
          <input type="hidden" name="decision" value="مرفوض" />
          <input
            name="note"
            required
            placeholder="سبب الرفض"
            className="min-h-11 rounded-lg border border-gray-300 px-2 py-1 text-sm lg:min-h-0"
          />
          <SubmitButton variant="danger">تأكيد الرفض</SubmitButton>
        </form>
      )}
    </div>
  );
}

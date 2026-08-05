"use client";

import { useActionState, useState } from "react";
import { submitFollowupAction, type ActionState } from "../actions";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess, useResetOnSuccess } from "@/components/form-reset";
import { WEEKLY_STATUSES, normalizeWeeklyStatus } from "@/lib/plan/followup";

/**
 * نموذج المتابعة الأسبوعية (v2.5.0 §6.2/§6.3).
 *
 * **لا حقل نسبة إنجاز.** كان موجوداً حتى v2.4.1 ويكتب فوق تقدم البرنامج، فيتنافس مع
 * التقدم المعتمد الظاهر في التقارير. أُزيل من الواجهة والإجراء والمخطط والتصدير معاً
 * (D-054)؛ التقدم يُحرَّر من صفحة البرنامج وحدها وبسبب مسجَّل.
 *
 * الحقول كلها اختيارية عدا حالة الأسبوع — ولها قيمة افتراضية معقولة، فلا تُمنع متابعة
 * لأن حقلاً سردياً فارغ (§12).
 */
export function FollowupForm({
  programId,
  defaultStatus,
  defaults,
}: {
  programId: string;
  defaultStatus?: string;
  defaults?: {
    note?: string;
    completedWork?: string;
    obstacles?: string;
    requiredAction?: string;
    nextStep?: string;
    evidenceUpdate?: string;
    interventionNeeded?: boolean;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(submitFollowupAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const formRef = useResetOnSuccess(state);
  const [expanded, setExpanded] = useState(false);

  const normalized = normalizeWeeklyStatus(defaultStatus ?? null);
  const selected = (WEEKLY_STATUSES as readonly string[]).includes(normalized ?? "") ? normalized! : "قيد التنفيذ";
  const field = "w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm";

  return (
    <form ref={formRef} action={formAction} className="mt-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="mb-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}

      <div className="flex flex-wrap items-end gap-2">
        <div className="basis-40">
          <label htmlFor={`fu-status-${programId}`} className="mb-1 block text-xs text-gray-500">حالة هذا الأسبوع</label>
          <select
            id={`fu-status-${programId}`}
            name="weekStatus"
            defaultValue={selected}
            className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {WEEKLY_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={`fu-note-${programId}`} className="mb-1 block text-xs text-gray-500">
            ملاحظات الأسبوع <span className="text-gray-400">(اختياري)</span>
          </label>
          <input
            id={`fu-note-${programId}`}
            name="note"
            defaultValue={defaults?.note ?? ""}
            placeholder="ملخص الأسبوع"
            className={field}
          />
        </div>
        <SubmitButton variant="secondary">تسجيل المتابعة</SubmitButton>
      </div>

      {/* §13: التفاصيل في قسم قابل للطي — الحفظ ممكن قبل فتحه */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-brand-700 hover:underline"
        aria-expanded={expanded}
      >
        {expanded
          ? "إخفاء تفاصيل المتابعة"
          : "تفاصيل المتابعة (اختيارية): ما أُنجز، العوائق، الإجراء المطلوب، الخطوة التالية"}
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-sand-50 p-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`fu-done-${programId}`} className="mb-1 block text-xs text-gray-500">ما أُنجز هذا الأسبوع</label>
            <textarea id={`fu-done-${programId}`} name="completedWork" rows={2} defaultValue={defaults?.completedWork ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor={`fu-obst-${programId}`} className="mb-1 block text-xs text-gray-500">العوائق</label>
            <textarea id={`fu-obst-${programId}`} name="obstacles" rows={2} defaultValue={defaults?.obstacles ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor={`fu-act-${programId}`} className="mb-1 block text-xs text-gray-500">الإجراء المطلوب</label>
            <textarea id={`fu-act-${programId}`} name="requiredAction" rows={2} defaultValue={defaults?.requiredAction ?? ""} className={field} />
          </div>
          <div>
            <label htmlFor={`fu-next-${programId}`} className="mb-1 block text-xs text-gray-500">الخطوة التالية</label>
            <textarea id={`fu-next-${programId}`} name="nextStep" rows={2} defaultValue={defaults?.nextStep ?? ""} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`fu-ev-${programId}`} className="mb-1 block text-xs text-gray-500">تحديث الشواهد</label>
            <input id={`fu-ev-${programId}`} name="evidenceUpdate" defaultValue={defaults?.evidenceUpdate ?? ""} className={field} />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700 sm:col-span-2">
            <input type="checkbox" name="interventionNeeded" defaultChecked={defaults?.interventionNeeded ?? false} />
            <span>يحتاج تدخّل المدير</span>
          </label>
        </div>
      )}
    </form>
  );
}

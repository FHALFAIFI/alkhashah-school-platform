"use client";

import { useActionState, useState, useTransition } from "react";
import {
  approveProgramAction, reopenProgramAction, createChangeRequestAction, decideChangeRequestAction,
  approvePackageAction, updateProgramExecutionAction,
  type ActionState,
} from "../actions";
import { SubmitButton } from "@/components/ui";
import { FOLLOWUP_STATUSES } from "@/lib/plan/followup";

export function ApproveProgramButton({ programId }: { programId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      {error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveProgramAction(programId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد وإقفال
      </button>
    </div>
  );
}

/** إدخال تقدم البرنامج وحالة تنفيذه مباشرةً — البرنامج نفسه وحدة التنفيذ (D-024) */
export function ProgramExecutionForm({ programId, progress, executionStatus }: { programId: string; progress: number; executionStatus: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateProgramExecutionAction.bind(null, programId), null);
  const currentStatus = (FOLLOWUP_STATUSES as readonly string[]).includes(executionStatus) ? executionStatus : "في المسار";
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="basis-40">
        <label htmlFor={`prog-${programId}`} className="mb-1 block text-xs text-gray-500">نسبة الإنجاز (٪)</label>
        <input
          id={`prog-${programId}`}
          name="progress"
          type="number"
          min={0}
          max={100}
          defaultValue={progress}
          className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="basis-40">
        <label htmlFor={`st-${programId}`} className="mb-1 block text-xs text-gray-500">حالة التنفيذ</label>
        <select
          id={`st-${programId}`}
          name="executionStatus"
          defaultValue={currentStatus}
          className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {FOLLOWUP_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <SubmitButton variant="secondary">حفظ التقدم والحالة</SubmitButton>
    </form>
  );
}

export function ReopenForm({ programId }: { programId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await reopenProgramAction(programId, fd);
          if (res?.error) setError(res.error);
        })
      }
      className="space-y-2"
    >
      {error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <input
        name="reason"
        required
        placeholder="سبب إعادة الفتح (إلزامي)"
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <button disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50">
        إعادة فتح بسبب موثق
      </button>
    </form>
  );
}

const FIELD_OPTIONS = [
  { value: "name", label: "اسم البرنامج" },
  { value: "specificGoal", label: "الهدف الخاص" },
  { value: "mechanism", label: "آلية التنفيذ" },
  { value: "periodText", label: "فترة التنفيذ" },
  { value: "ownerPosition", label: "مسؤول التنفيذ" },
  { value: "participants", label: "المشاركون" },
  { value: "kpiText", label: "مؤشر النجاح" },
  { value: "targetText", label: "المستهدف" },
  { value: "deliverableText", label: "المخرج المطلوب" },
  { value: "evidenceText", label: "الشواهد" },
  { value: "expectedImpact", label: "الأثر المتوقع" },
];

export function ChangeRequestForm({ programId }: { programId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createChangeRequestAction.bind(null, programId), null);
  const [field, setField] = useState(FIELD_OPTIONS[0].value);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div>
        <label className="block text-xs text-gray-500">الحقل</label>
        <select
          name="field"
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {FIELD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input type="hidden" name="fieldLabel" value={FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field} />
      </div>
      <div className="min-w-0 flex-1 basis-52">
        <label className="block text-xs text-gray-500">القيمة الجديدة</label>
        <input name="newValue" required className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div className="min-w-0 flex-1 basis-52">
        <label className="block text-xs text-gray-500">السبب (إلزامي)</label>
        <input name="reason" required className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <SubmitButton variant="secondary">طلب تغيير</SubmitButton>
    </form>
  );
}

export function ChangeRequestDecision({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-2 flex gap-2">
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { await decideChangeRequestAction(requestId, "معتمد"); })}
        className="rounded bg-brand-600 px-3 py-1 text-xs text-white"
      >
        اعتماد التغيير
      </button>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { await decideChangeRequestAction(requestId, "مرفوض"); })}
        className="rounded border border-red-200 px-3 py-1 text-xs text-red-600"
      >
        رفض
      </button>
    </div>
  );
}

export function ApprovePackageButton({ deliverableId }: { deliverableId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => { await approvePackageAction(deliverableId); })}
      className="rounded bg-brand-600 px-3 py-1 text-xs text-white"
    >
      اعتماد الحزمة
    </button>
  );
}

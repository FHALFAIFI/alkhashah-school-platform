"use client";

import { useActionState, useState, useTransition } from "react";
import {
  updateMilestoneAction, addMilestoneAction, updateMilestoneWeightAction, deleteMilestoneAction,
  approveProgramAction, reopenProgramAction, createChangeRequestAction, decideChangeRequestAction,
  approvePackageAction,
  type ActionState,
} from "../actions";
import { Field, SubmitButton, ProgressBar } from "@/components/ui";

type Milestone = {
  id: string;
  title: string;
  weight: number;
  progress: number;
  status: string;
  dueText: string | null;
  notes: string | null;
};

export function MilestoneRow({ milestone, editable, draftMode }: { milestone: Milestone; editable: boolean; draftMode: boolean }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-sand-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-sm font-medium">{milestone.title}</div>
          <div className="text-xs text-gray-400">
            الوزن: {milestone.weight}٪ {milestone.dueText && `· الموعد: ${milestone.dueText}`}
          </div>
        </div>
        <ProgressBar value={milestone.progress} />
        {editable && (
          <form
            action={(fd) => startTransition(() => updateMilestoneAction(milestone.id, fd))}
            className="flex flex-wrap items-center gap-2"
          >
            <label className="text-xs text-gray-500" htmlFor={`p-${milestone.id}`}>تحديث الإنجاز</label>
            <input
              id={`p-${milestone.id}`}
              name="progress"
              type="number"
              min={0}
              max={100}
              defaultValue={milestone.progress}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-xs tabular-nums"
            />
            <button className="rounded bg-brand-600 px-2 py-1 text-xs text-white" disabled={pending}>حفظ</button>
          </form>
        )}
        {editable && draftMode && (
          <button onClick={() => setEditing(!editing)} className="text-xs text-gray-500 underline">تعديل الوزن</button>
        )}
      </div>
      {editing && (
        <form
          action={(fd) => startTransition(() => { updateMilestoneWeightAction(milestone.id, fd); setEditing(false); })}
          className="mt-2 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-2"
        >
          <div className="min-w-0 flex-1 basis-40">
            <label className="block text-xs text-gray-500">العنوان</label>
            <input name="title" defaultValue={milestone.title} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="block text-xs text-gray-500">الوزن ٪</label>
            <input name="weight" type="number" min={0} max={100} defaultValue={milestone.weight} className="w-16 rounded border border-gray-300 px-2 py-1 text-xs" />
          </div>
          <button className="rounded bg-brand-600 px-2 py-1 text-xs text-white">حفظ</button>
          <button
            type="button"
            onClick={() => startTransition(() => deleteMilestoneAction(milestone.id))}
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600"
          >
            حذف
          </button>
        </form>
      )}
    </div>
  );
}

export function AddMilestoneForm({ programId }: { programId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addMilestoneAction.bind(null, programId), null);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-0 flex-1 basis-56">
        <Field label="معلم جديد" name="title" required />
      </div>
      <div className="w-24">
        <Field label="الوزن ٪" name="weight" type="number" required />
      </div>
      <div className="w-40">
        <Field label="الموعد (نص)" name="dueText" />
      </div>
      <SubmitButton variant="secondary">إضافة معلم</SubmitButton>
    </form>
  );
}

export function ApproveProgramButton({ programId, disabled, totalWeight }: { programId: string; disabled: boolean; totalWeight: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      {error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={disabled || pending}
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
      {disabled && <p className="mt-1 text-xs text-amber-600">مجموع الأوزان {totalWeight}٪ — اضبطه إلى 100٪ أولاً</p>}
    </div>
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

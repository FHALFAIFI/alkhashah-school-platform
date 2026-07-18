"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addMemberAction, removeMemberAction, approveCommitteeAction, reopenCommitteeAction,
  createMeetingAction, closeCommitteeAction, addImpactAction, deleteImpactAction, type ActionState,
} from "../actions";
import { Field, SubmitButton, TextArea } from "@/components/ui";

export function AddMemberForm({
  committeeId,
  people,
  isPlc,
}: {
  committeeId: string;
  people: { id: string; fullName: string; jobTitle: string | null }[];
  isPlc: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(addMemberAction.bind(null, committeeId), null);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-56 flex-1">
        <label className="mb-1 block text-sm font-medium text-gray-700">العضو (من منسوبي المدرسة)</label>
        <select name="personId" required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">— اختر —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}{p.jobTitle ? ` — ${p.jobTitle}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">العمل في اللجنة</label>
        <select name="role" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          {(isPlc ? ["قائد", "عضو"] : ["رئيس", "نائب", "مقرر", "عضو"]).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="w-44">
        <Field label="الصفة (اختياري)" name="position" />
      </div>
      <SubmitButton variant="secondary">إضافة عضو</SubmitButton>
    </form>
  );
}

export function RemoveMemberButton({ memberId }: { memberId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await removeMemberAction(memberId);
            setError(res?.error ?? null);
          })
        }
        className="text-xs text-red-500 hover:underline"
      >
        إزالة
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function ApproveCommitteeButton({ committeeId }: { committeeId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="text-end">
      {error && <div role="alert" className="mb-1 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveCommitteeAction(committeeId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد التشكيل وإقفاله
      </button>
    </div>
  );
}

export function ReopenCommitteeForm({ committeeId }: { committeeId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(reopenCommitteeAction.bind(null, committeeId), null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {state?.error && <span role="alert" className="w-full text-xs text-red-600">{state.error}</span>}
      {state?.success && <span role="status" className="w-full text-xs text-emerald-700">{state.success}</span>}
      <input name="reason" required placeholder="سبب إعادة الفتح (إلزامي)" className="min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <SubmitButton variant="secondary">إعادة فتح بسبب موثق</SubmitButton>
    </form>
  );
}

export function NewMeetingForm({ committeeId, types }: { committeeId: string; types: { id: string; nameAr: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createMeetingAction.bind(null, committeeId), null);
  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="عنوان الاجتماع" name="title" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">نوع الاجتماع *</label>
          <select name="typeId" required className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— اختر النوع —</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.nameAr}</option>
            ))}
          </select>
        </div>
        <div>
          <Field label="التاريخ" name="meetingDate" type="date" />
        </div>
      </div>
      <TextArea label="جدول الأعمال (بند في كل سطر)" name="agenda" rows={3} />
      <SubmitButton>إنشاء اجتماع</SubmitButton>
    </form>
  );
}

/** تسجيل النتيجة والأثر (منفصلان) — مع قياس وتاريخ ملاحظة وشاهد، وربط اختياري بقرار/إجراء */
export function ImpactForm({
  committeeId,
  outcomes,
  tasks,
}: {
  committeeId: string;
  outcomes: { id: string; text: string }[];
  tasks: { id: string; title: string }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(addImpactAction.bind(null, committeeId), null);
  return (
    <form key={state?.success ?? "f"} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextArea label="النتيجة (المخرج المباشر)" name="result" rows={2} required />
        <TextArea label="الأثر (التغيّر الملحوظ)" name="impact" rows={2} required />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="القياس أو المؤشر" name="measurement" />
        <Field label="تاريخ الملاحظة" name="observedAt" type="date" />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">شاهد داعم (اختياري)</label>
          <input name="evidence" type="file" className="w-full rounded-lg border border-dashed border-gray-300 p-2 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">مرتبط بقرار (اختياري)</label>
          <select name="outcomeId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— بدون —</option>
            {outcomes.map((o) => (
              <option key={o.id} value={o.id}>{o.text.slice(0, 60)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">مرتبط بإجراء (اختياري)</label>
          <select name="taskId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— بدون —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title.slice(0, 60)}</option>
            ))}
          </select>
        </div>
      </div>
      <SubmitButton variant="secondary">تسجيل النتيجة والأثر</SubmitButton>
    </form>
  );
}

/** حذف سجل نتيجة/أثر */
export function DeleteImpactButton({ impactId }: { impactId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { const r = await deleteImpactAction(impactId); if (r?.error) setError(r.error); })}
        className="text-xs text-red-500 hover:underline"
      >
        حذف
      </button>
      {error && <span className="ms-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function CloseCommitteeButton({ committeeId }: { committeeId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      {error && <span className="me-2 text-xs text-red-600">{error}</span>}
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm("إقفال اللجنة وأرشفتها لنهاية العام؟")) return;
          startTransition(async () => {
            const res = await closeCommitteeAction(committeeId);
            if (res?.error) setError(res.error);
          });
        }}
        className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-sand-100"
      >
        إقفال وأرشفة
      </button>
    </div>
  );
}

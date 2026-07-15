"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addMemberAction, removeMemberAction, approveCommitteeAction, reopenCommitteeAction,
  createMeetingAction, closeCommitteeAction, type ActionState,
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
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => removeMemberAction(memberId))}
      className="text-xs text-red-500 hover:underline"
    >
      إزالة
    </button>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await reopenCommitteeAction(committeeId, fd);
          if (res?.error) setError(res.error);
        })
      }
      className="flex items-center gap-2"
    >
      {error && <span className="text-xs text-red-600">{error}</span>}
      <input name="reason" required placeholder="سبب إعادة الفتح (إلزامي)" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <button disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50">
        إعادة فتح التشكيل
      </button>
    </form>
  );
}

export function NewMeetingForm({ committeeId }: { committeeId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createMeetingAction.bind(null, committeeId), null);
  return (
    <form action={formAction} className="mt-3 space-y-3 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="عنوان الاجتماع" name="title" />
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

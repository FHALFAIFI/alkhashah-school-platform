"use client";

import { useActionState, useTransition } from "react";
import { createIssueAction, updateIssueStatusAction, type ActionState } from "../actions";
import { Field, SubmitButton } from "@/components/ui";

export function NewIssueForm({ rooms }: { rooms: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createIssueAction, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label="عنوان البلاغ" name="title" required />
        </div>
        <div className="min-w-56">
          <label className="mb-1 block text-sm font-medium text-gray-700">الغرفة</label>
          <select name="roomId" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— غير محددة —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الأولوية</label>
          <select name="priority" defaultValue="متوسطة" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="عالية">عالية</option>
            <option value="متوسطة">متوسطة</option>
            <option value="منخفضة">منخفضة</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label="الوصف" name="description" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">صورة (اختياري)</label>
          <input name="photo" type="file" accept=".jpg,.jpeg,.png,.webp" className="text-sm" />
        </div>
        <SubmitButton>تسجيل البلاغ</SubmitButton>
      </div>
    </form>
  );
}

export function IssueStatusControl({ issueId, status }: { issueId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form action={(fd) => startTransition(() => updateIssueStatusAction(issueId, fd))} className="flex flex-col gap-1">
      <select name="status" defaultValue={status} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
        <option value="مفتوح">مفتوح</option>
        <option value="قيد الإصلاح">قيد الإصلاح</option>
        <option value="تم الإصلاح">تم الإصلاح</option>
        <option value="مغلق ومتحقق">مغلق ومتحقق</option>
      </select>
      <input name="repairNote" placeholder="ملاحظة الإصلاح" className="w-32 rounded border border-gray-300 px-2 py-1 text-xs" />
      <button disabled={pending} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">حفظ</button>
    </form>
  );
}

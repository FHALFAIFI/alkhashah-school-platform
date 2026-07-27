"use client";

import { useActionState, useState, useTransition } from "react";
import { createTaskAction, updateTaskStatusAction, type ActionState } from "./actions";
import { Field, SubmitButton } from "@/components/ui";
import { orFallback } from "@/lib/format";

export function NewTaskForm({ people }: { people: { id: string; fullName: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createTaskAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="min-w-64 flex-1">
        <Field label="مهمة جديدة" name="title" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">المكلف</label>
        <select name="ownerPersonId" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">— غير محدد —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{orFallback(p.fullName)}</option>
          ))}
        </select>
      </div>
      <div>
        <Field label="الموعد" name="dueDate" type="date" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">الأولوية</label>
        <select name="priority" defaultValue="متوسطة" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="عالية">عالية</option>
          <option value="متوسطة">متوسطة</option>
          <option value="منخفضة">منخفضة</option>
        </select>
      </div>
      <SubmitButton>إضافة</SubmitButton>
    </form>
  );
}

export function TaskStatusControl({ taskId, status, progress }: { taskId: string; status: string; progress: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await updateTaskStatusAction(taskId, fd);
          setError(res?.error ?? null);
        })
      }
      className="flex flex-wrap items-center gap-1"
    >
      {error && <div role="alert" className="w-full rounded bg-red-50 p-1.5 text-xs text-red-700">{error}</div>}
      <select name="status" defaultValue={status} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
        <option value="جديدة">جديدة</option>
        <option value="قيد التنفيذ">قيد التنفيذ</option>
        <option value="مكتملة">مكتملة</option>
        <option value="ملغاة">ملغاة</option>
      </select>
      <input name="progress" type="number" min={0} max={100} defaultValue={progress} className="w-14 rounded border border-gray-300 px-1 py-1 text-xs tabular-nums" />
      <button disabled={pending} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">حفظ</button>
    </form>
  );
}

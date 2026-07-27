"use client";

import { useActionState, useState } from "react";
import { createIssueAction, updateIssueStatusAction, type ActionState } from "../actions";
import { Field, SubmitButton } from "@/components/ui";

export function NewIssueForm({
  rooms,
  people,
}: {
  rooms: { id: string; label: string }[];
  people: { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createIssueAction, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label="عنوان البلاغ" name="title" />
        </div>
        <div className="min-w-56 max-w-full">
          <label className="mb-1 block text-sm font-medium text-gray-700">الغرفة</label>
          <select name="roomId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— غير محددة —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الأولوية</label>
          <select name="priority" defaultValue="متوسطة" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
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
        <div className="min-w-56 max-w-full">
          <label className="mb-1 block text-sm font-medium text-gray-700">المكلف بالإصلاح (اختياري)</label>
          <select name="ownerPersonId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— بلا تكليف —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="max-w-full">
          <label className="mb-1 block text-sm font-medium text-gray-700">صورة (اختياري)</label>
          <input name="photo" type="file" accept="image/*" className="w-full max-w-64 text-sm" />
          <p className="mt-1 text-xs text-gray-400">التقط صورة أو اختر ملفاً من الجهاز</p>
        </div>
        <SubmitButton>تسجيل البلاغ</SubmitButton>
      </div>
    </form>
  );
}

export function IssueStatusControl({ issueId, status }: { issueId: string; status: string }) {
  const [nextStatus, setNextStatus] = useState(status);
  return (
    <form action={updateIssueStatusAction.bind(null, issueId)} className="flex flex-col gap-1">
      <select
        name="status"
        value={nextStatus}
        onChange={(e) => setNextStatus(e.target.value)}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
      >
        <option value="مفتوح">مفتوح</option>
        <option value="قيد الإصلاح">قيد الإصلاح</option>
        <option value="تم الإصلاح">تم الإصلاح</option>
        <option value="مغلق ومتحقق">مغلق ومتحقق</option>
      </select>
      <input
        name="repairNote"
        placeholder={nextStatus === "تم الإصلاح" ? "ما الذي أصلح؟ (اختياري)" : "ملاحظة الإصلاح (اختياري)"}
        className="w-32 max-w-full rounded border border-gray-300 px-2 py-1 text-xs"
      />
      <SubmitButton
        variant="secondary"
        confirmText={nextStatus === "مغلق ومتحقق" ? "إغلاق البلاغ نهائياً بعد التحقق من الإصلاح؟ لا يمكن تحديثه بعد الإغلاق." : undefined}
      >
        حفظ
      </SubmitButton>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { submitInspectionAction, overrideReadinessAction, type ActionState } from "../../actions";
import { SubmitButton } from "@/components/ui";

export function InspectionRunForm({
  roomId,
  templates,
}: {
  roomId: string;
  templates: { id: string; nameAr: string; items: { key: string; label: string; required: boolean }[] }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(submitInspectionAction, null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const template = templates.find((t) => t.id === templateId);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
        تنفيذ فحص جديد
      </button>
    );
  }

  return (
    <form action={formAction} className="mb-4 space-y-3 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <input type="hidden" name="roomId" value={roomId} />
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">قالب الفحص</label>
        <select
          name="templateId"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.nameAr}</option>
          ))}
        </select>
      </div>
      {template && (
        <div className="space-y-2">
          {template.items.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm">
              <span className="min-w-40 flex-1">{item.label}</span>
              <label className="flex items-center gap-1">
                <input type="radio" name={`item_${item.key}`} value="ok" defaultChecked />
                سليم
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name={`item_${item.key}`} value="not_ok" />
                يحتاج معالجة
              </label>
              <input name={`note_${item.key}`} placeholder="ملاحظة" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
            </div>
          ))}
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">ملاحظات عامة</label>
        <input name="notes" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="flex gap-2">
        <SubmitButton>حفظ الفحص</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500">إغلاق</button>
      </div>
    </form>
  );
}

export function ReadinessOverrideForm({ roomId }: { roomId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(overrideReadinessAction.bind(null, roomId), null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-gray-500 underline">
        تجاوز الجاهزية يدوياً (بسبب إلزامي)
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-3 space-y-2 border-t border-sand-100 pt-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-xs text-gray-500">القيمة ٪</label>
          <input name="value" type="number" min={0} max={100} required className="w-20 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500">السبب (إلزامي)</label>
          <input name="reason" required className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
      </div>
      <SubmitButton variant="secondary">تسجيل التجاوز</SubmitButton>
    </form>
  );
}

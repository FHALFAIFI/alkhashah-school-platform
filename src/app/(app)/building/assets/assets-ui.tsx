"use client";

import { useActionState, useState, useTransition } from "react";
import { createAssetAction, updateAssetConditionAction, type ActionState } from "../actions";
import { Field, SubmitButton } from "@/components/ui";

export function NewAssetForm({ rooms }: { rooms: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createAssetAction, null);
  const [important, setImportant] = useState(false);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="اسم الأصل" name="nameAr" required />
        </div>
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-sm font-medium text-gray-700">الغرفة/الموقع</label>
          <select name="roomId" required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— اختر —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <Field label="الفئة" name="category" placeholder="أثاث، أجهزة…" />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="important" checked={important} onChange={(e) => setImportant(e.target.checked)} />
          أصل مهم (سجل فردي برقم تسلسلي وتاريخ صيانة)
        </label>
        {important ? (
          <div className="w-48">
            <Field label="الرقم التسلسلي" name="serialNumber" dir="ltr" />
          </div>
        ) : (
          <div className="w-28">
            <Field label="الكمية" name="quantity" type="number" defaultValue={1} />
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الحالة</label>
          <select name="condition" defaultValue="جيدة" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {["ممتازة", "جيدة", "تحتاج صيانة", "خارج الخدمة"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <SubmitButton>إضافة</SubmitButton>
      </div>
    </form>
  );
}

export function AssetConditionControl({ assetId, condition }: { assetId: string; condition: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form action={(fd) => startTransition(() => updateAssetConditionAction(assetId, fd))} className="flex items-center gap-1">
      <select name="condition" defaultValue={condition} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
        {["ممتازة", "جيدة", "تحتاج صيانة", "خارج الخدمة"].map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button disabled={pending} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">حفظ</button>
    </form>
  );
}

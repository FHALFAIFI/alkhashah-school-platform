"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createAssetAction,
  updateAssetConditionAction,
  archiveAssetAction,
  restoreAssetAction,
  deleteAssetAction,
  type ActionState,
} from "../actions";
import { ASSET_DELETE_CONFIRM } from "@/lib/building/asset-constants";
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
          <Field label="اسم الأصل" name="nameAr" />
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

/** أرشفة الأصل — الإجراء الافتراضي غير المدمّر (سبب عربي إلزامي، قابل للاستعادة). */
export function ArchiveAssetControl({ assetId }: { assetId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(archiveAssetAction.bind(null, assetId), null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        أرشفة الأصل
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {state?.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
      <input
        name="reason"
        required
        placeholder="سبب الأرشفة (إلزامي)"
        className="w-44 rounded border border-gray-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <SubmitButton variant="secondary" confirmText="أرشفة هذا الأصل؟ يمكن استعادته لاحقاً.">
          تأكيد الأرشفة
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-gray-500">
          إلغاء
        </button>
      </div>
    </form>
  );
}

/** استعادة الأصل المؤرشف. */
export function RestoreAssetControl({ assetId }: { assetId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(restoreAssetAction.bind(null, assetId), null);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      {state?.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
      <SubmitButton variant="secondary">استعادة الأصل</SubmitButton>
    </form>
  );
}

/**
 * حذف نهائي — متاح فقط بلا تبعيات؛ يتطلب إقرار «أُنشئ بالخطأ» وكتابة عبارة التأكيد حرفياً.
 * عند وجود تبعيات تُعرض أنواعها وأعدادها ويُمنع الحذف.
 */
export function DeleteAssetControl({
  assetId,
  deletable,
  deps,
}: {
  assetId: string;
  deletable: boolean;
  deps: { labelAr: string; count: number }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(deleteAssetAction.bind(null, assetId), null);
  const [open, setOpen] = useState(false);

  if (!deletable) {
    return (
      <div className="text-xs text-gray-500">
        <span className="font-medium text-gray-600">الحذف النهائي غير متاح</span> — سجلات مرتبطة:{" "}
        {deps.map((d) => `${d.labelAr} (${d.count})`).join("، ")}. استخدم الأرشفة.
      </div>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        حذف نهائي
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {state?.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
      <label className="flex items-center gap-1 text-xs text-gray-700">
        <input type="checkbox" name="createdByMistake" />
        أقرّ أن هذا الأصل أُنشئ بالخطأ
      </label>
      <input
        name="confirm"
        required
        placeholder={`اكتب: ${ASSET_DELETE_CONFIRM}`}
        className="w-44 rounded border border-red-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <SubmitButton variant="danger" confirmText="حذف نهائي لا يمكن التراجع عنه. متابعة؟">
          حذف نهائي
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-gray-500">
          إلغاء
        </button>
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

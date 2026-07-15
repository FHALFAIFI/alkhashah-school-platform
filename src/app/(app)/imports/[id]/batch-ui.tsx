"use client";

import { useState, useTransition } from "react";
import { commitBatchAction, rollbackBatchAction, correctRowAction, excludeRowAction, markRowReadyAction } from "../actions";
import { SubmitButton } from "@/components/ui";

export function BatchActions({
  batchId,
  status,
  canCommit,
  canRollback,
  reviewCount,
}: {
  batchId: string;
  status: string;
  canCommit: boolean;
  canRollback: boolean;
  reviewCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mb-4 rounded-xl border border-sand-200 bg-white p-4">
      {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="flex flex-wrap items-center gap-3">
        {status === "معاينة" && (
          <>
            <button
              disabled={!canCommit || pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await commitBatchAction(batchId);
                  if (res?.error) setError(res.error);
                })
              }
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? "جارٍ التنفيذ…" : "موافقة صريحة وتنفيذ الاستيراد"}
            </button>
            {reviewCount > 0 && (
              <span className="text-sm text-amber-700">
                لا يمكن التنفيذ قبل تصحيح أو استبعاد {reviewCount} صفاً بحاجة إلى مراجعة
              </span>
            )}
          </>
        )}
        {canRollback && (
          <button
            disabled={pending}
            onClick={() => {
              if (!confirm("هل أنت متأكد من التراجع الكامل عن هذه الدفعة؟ ستحذف السجلات المنشأة منها.")) return;
              startTransition(async () => {
                setError(null);
                const res = await rollbackBatchAction(batchId);
                if (res?.error) setError(res.error);
              });
            }}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            تراجع كامل عن الدفعة
          </button>
        )}
      </div>
    </div>
  );
}

export function RowEditor({
  rowId,
  batchId,
  fields,
  values,
  status,
}: {
  rowId: string;
  batchId: string;
  fields: { key: string; label: string }[];
  values: Record<string, string>;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex gap-1">
        <button onClick={() => setOpen(true)} className="rounded border border-sand-200 px-2 py-1 text-xs hover:bg-sand-100">
          تصحيح
        </button>
        {status === "يحتاج مراجعة" && (
          <button
            onClick={() => startTransition(() => markRowReadyAction(rowId, batchId))}
            className="rounded border border-emerald-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
          >
            تأكيد كجاهز
          </button>
        )}
        {status !== "مستبعد" && (
          <button
            onClick={() => startTransition(() => excludeRowAction(rowId, batchId))}
            className="rounded border border-sand-200 px-2 py-1 text-xs text-gray-500 hover:bg-sand-100"
          >
            استبعاد
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      action={(fd) => startTransition(() => correctRowAction(rowId, batchId, fd))}
      className="w-64 space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-2"
    >
      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs text-gray-500">{f.label}</label>
          {f.key === "category" ? (
            <select name={`f_${f.key}`} defaultValue={values[f.key] ?? "موظف"} className="w-full rounded border border-gray-300 px-2 py-1 text-xs">
              <option value="معلم">معلم</option>
              <option value="موظف">موظف</option>
            </select>
          ) : (
            <input name={`f_${f.key}`} defaultValue={values[f.key] ?? ""} className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          )}
        </div>
      ))}
      <input type="hidden" name="newStatus" value="جاهز" />
      <div className="flex gap-2">
        <SubmitButton>حفظ كجاهز</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">
          إلغاء
        </button>
      </div>
      {pending && <p className="text-xs text-gray-400">جارٍ الحفظ…</p>}
    </form>
  );
}

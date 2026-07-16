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
  fileName,
  readyCount,
  teacherCount,
  staffCount,
  excludedCount,
}: {
  batchId: string;
  status: string;
  canCommit: boolean;
  canRollback: boolean;
  reviewCount: number;
  fileName: string;
  readyCount: number;
  teacherCount: number;
  staffCount: number;
  excludedCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mb-4 rounded-xl border border-sand-200 bg-white p-4">
      {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="flex flex-wrap items-center gap-3">
        {status === "معاينة" && !confirming && (
          <>
            <button
              disabled={!canCommit || pending}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              موافقة صريحة وتنفيذ الاستيراد
            </button>
            {reviewCount > 0 && (
              <span className="text-sm text-amber-700">
                لا يمكن التنفيذ قبل تصحيح أو استبعاد {reviewCount} صفاً بحاجة إلى مراجعة
              </span>
            )}
          </>
        )}
        {status === "معاينة" && confirming && (
          <div className="w-full rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="mb-2 font-bold text-brand-900">تأكيد التنفيذ — راجع ملخص الدفعة قبل الموافقة النهائية</p>
            <ul className="mb-3 space-y-1 text-sm text-brand-900">
              <li>اسم الملف: <span className="font-medium">{fileName}</span></li>
              <li>عدد الصفوف الجاهزة: <span className="font-medium tabular-nums">{readyCount}</span></li>
              <li>عدد المعلمين: <span className="font-medium tabular-nums">{teacherCount}</span></li>
              <li>عدد الموظفين: <span className="font-medium tabular-nums">{staffCount}</span></li>
              <li>عدد المستبعدين: <span className="font-medium tabular-nums">{excludedCount}</span></li>
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const res = await commitBatchAction(batchId);
                    if (res?.error) setError(res.error);
                    setConfirming(false);
                  })
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "جارٍ التنفيذ…" : "تأكيد التنفيذ"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-sand-100 disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
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

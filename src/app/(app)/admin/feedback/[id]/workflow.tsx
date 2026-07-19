"use client";

import { useActionState } from "react";
import { updateStatusAction, archiveAction, unarchiveAction, type FeedbackAdminState } from "../actions";
import { FEEDBACK_STATUSES, statusRequiresNote } from "@/lib/feedback/constants";
import { useState } from "react";

const initial: FeedbackAdminState = {};

/** نماذج معالجة الملاحظة: تغيير الحالة وتوثيق الاستجابة، والأرشفة/الاسترجاع (لا حذف نهائي) */
export function FeedbackWorkflow({
  id,
  status,
  archived,
}: {
  id: string;
  status: string;
  archived: boolean;
}) {
  const [statusState, statusFormAction, statusPending] = useActionState(updateStatusAction, initial);
  const [archiveState, archiveFormAction, archivePending] = useActionState(archiveAction, initial);
  const [unarchiveState, unarchiveFormAction, unarchivePending] = useActionState(unarchiveAction, initial);
  const [selectedStatus, setSelectedStatus] = useState(status);

  const inputCls =
    "min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0";

  if (archived) {
    return (
      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <p className="mb-3 text-sm text-gray-600">هذه الملاحظة مؤرشفة (لم تُحذف). يمكنك استرجاعها لإعادة معالجتها.</p>
        <form action={unarchiveFormAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={unarchivePending}
            className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60 lg:min-h-0 lg:py-2"
          >
            {unarchivePending ? "جارٍ الاسترجاع…" : "استرجاع الملاحظة"}
          </button>
        </form>
        {unarchiveState.error && <p className="mt-2 text-sm text-red-700">{unarchiveState.error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* تغيير الحالة وتوثيق الاستجابة */}
      <div className="rounded-xl border border-sand-200 bg-white p-4">
        <h2 className="mb-3 font-bold text-brand-900">الحالة والمعالجة</h2>
        <form action={statusFormAction} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">الحالة</label>
            <select
              name="status"
              defaultValue={status}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              ملاحظة المعالجة/سبب القرار
              {statusRequiresNote(selectedStatus) && <span className="text-red-500"> * (مطلوبة)</span>}
            </label>
            <textarea
              name="note"
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder={
                selectedStatus === "لن تُنفذ"
                  ? "وثّق سبب عدم التنفيذ (إلزامي)"
                  : selectedStatus === "تم الحل"
                    ? "وثّق ما تم لحل الملاحظة (إلزامي)"
                    : "ملاحظة مراجعة داخلية (اختيارية)"
              }
            />
          </div>
          <button
            type="submit"
            disabled={statusPending}
            className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60 lg:min-h-0 lg:py-2"
          >
            {statusPending ? "جارٍ الحفظ…" : "حفظ الحالة والمعالجة"}
          </button>
          {statusState.error && <p className="text-sm text-red-700">{statusState.error}</p>}
          {statusState.ok && <p className="text-sm text-emerald-700">تم حفظ الحالة والمعالجة.</p>}
        </form>
      </div>

      {/* الأرشفة بسبب موثق — لا حذف نهائي */}
      <details className="rounded-xl border border-sand-200 bg-white p-4">
        <summary className="cursor-pointer font-medium text-gray-700">أرشفة الملاحظة (بدل الحذف)</summary>
        <form action={archiveFormAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-gray-500">الأرشفة لا تحذف الملاحظة؛ تخفيها مع توثيق سبب، وتبقى قابلة للاسترجاع.</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">سبب الأرشفة *</label>
            <input name="reason" required className={inputCls} placeholder="مثال: مكررة مع FB-0003" />
          </div>
          <button
            type="submit"
            disabled={archivePending}
            className="min-h-11 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 lg:min-h-0 lg:py-2"
          >
            {archivePending ? "جارٍ الأرشفة…" : "أرشفة"}
          </button>
          {archiveState.error && <p className="text-sm text-red-700">{archiveState.error}</p>}
        </form>
      </details>
    </div>
  );
}

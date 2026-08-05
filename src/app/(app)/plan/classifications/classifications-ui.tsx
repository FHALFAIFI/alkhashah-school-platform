"use client";

import { useActionState } from "react";
import { renameClassificationAction, deleteClassificationAction } from "./actions";
import type { ActionState } from "../actions";
import { SubmitButton } from "@/components/ui";
import { orFallback } from "@/lib/format";
import { useRefreshOnSuccess } from "@/components/form-reset";

/** الرمز الخاص «مسح التصنيف» — يجب أن يطابق قيمة CLEAR_TARGET في actions.ts */
const CLEAR_TARGET = "__CLEAR__";

type Classification = { domain: string; count: number };

/**
 * إدارة تصنيفات البرامج (v2.1 §A2): «التصنيف» قيمة حقل «المجال» الحرّة.
 * لكل تصنيف: إعادة تسمية/دمج، أو حذف بإعادة توزيع برامجه — دون حذف أي برنامج.
 */
export function ClassificationsManager({
  classifications,
  canWrite,
}: {
  classifications: Classification[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        التصنيف موجود ما دام هناك برامج تشير إليه عبر حقل «المجال». إعادة التسمية تدمج تصنيفاً في آخر،
        والحذف يعيد توزيع برامجه إلى تصنيف بديل أو يمسح تصنيفها — دون حذف أي برنامج ولا فقدان أي بيانات.
      </p>
      <div className="space-y-3">
        {classifications.map((c) => (
          <ClassificationRow
            key={c.domain || "__EMPTY__"}
            classification={c}
            others={classifications.filter((o) => o.domain !== c.domain)}
            canWrite={canWrite}
          />
        ))}
      </div>
    </div>
  );
}

function ClassificationRow({
  classification,
  others,
  canWrite,
}: {
  classification: Classification;
  others: Classification[];
  canWrite: boolean;
}) {
  const { domain, count } = classification;
  const label = orFallback(domain, "بدون تصنيف");
  const [renameState, renameAction] = useActionState<ActionState, FormData>(
    renameClassificationAction.bind(null, domain),
    null,
  );
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(renameState);
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteClassificationAction.bind(null, domain),
    null,
  );
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(deleteState);

  return (
    <div className="rounded-lg border border-sand-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-brand-900">{label}</span>
        <span className="text-xs text-gray-500">{count} برنامجاً</span>
      </div>

      {canWrite && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* إعادة التسمية / الدمج */}
          <form action={renameAction} className="flex flex-wrap items-end gap-2">
            {renameState?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{renameState.error}</div>}
            {renameState?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{renameState.success}</div>}
            <div className="min-w-0 flex-1 basis-40">
              <label className="mb-1 block text-xs text-gray-500">إعادة التسمية / الدمج</label>
              <input
                name="newDomain"
                defaultValue={domain}
                placeholder="اسم التصنيف الجديد"
                className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <SubmitButton
              variant="secondary"
              confirmText={`إعادة تسمية التصنيف «${label}» (${count} برنامجاً)؟ ستنتقل كل برامجه إلى الاسم الجديد.`}
            >
              حفظ
            </SubmitButton>
          </form>

          {/* الحذف = إعادة التوزيع / المسح (لا يُحذف أي برنامج) */}
          <form action={deleteAction} className="flex flex-wrap items-end gap-2">
            {deleteState?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{deleteState.error}</div>}
            {deleteState?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{deleteState.success}</div>}
            <div className="min-w-0 flex-1 basis-40">
              <label className="mb-1 block text-xs text-gray-500">حذف التصنيف (إعادة توزيع برامجه)</label>
              <select
                name="target"
                defaultValue=""
                required
                className="w-full min-w-0 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="" disabled>اختر التصنيف البديل…</option>
                {others.map((o) => (
                  <option key={o.domain || "__EMPTY__"} value={o.domain}>{orFallback(o.domain, "بدون تصنيف")}</option>
                ))}
                <option value={CLEAR_TARGET}>مسح التصنيف (بدون تصنيف)</option>
              </select>
            </div>
            <SubmitButton
              variant="danger"
              confirmText={`حذف التصنيف «${label}» (${count} برنامجاً)؟ لن يُحذف أي برنامج — ستُنقل برامجه إلى التصنيف البديل أو يُمسح تصنيفها.`}
            >
              حذف
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

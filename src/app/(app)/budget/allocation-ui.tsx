"use client";

/**
 * تحديد/تصحيح مخصص البند المالي (v2.4.1 §4.5).
 *
 * يعرض للمستخدم قبل الحفظ: اسم البند، المخصص الحالي، المصروف الفعلي، المخصص المقترح،
 * والمتبقي الناتج — فلا يحفظ رقماً دون أن يرى أثره. خفض المخصص تحت المصروف مسموح لكنه
 * يتطلب تأكيداً صريحاً (الخادم يرفض بدونه، وهذا النموذج يُظهر مربع التأكيد عند الطلب).
 */

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { setItemAllocationAction, type ActionState } from "./finance-actions";
import { ALLOCATION_NONE_VALUE, SET_ALLOCATION_CTA } from "@/lib/finance/allocation";
import { moneySubtract } from "@/lib/finance/calc";
import { useRefreshOnSuccess } from "@/components/form-reset";

export function SetAllocationForm({
  itemId,
  itemName,
  currentAllocation,
  spent,
  compact = false,
}: {
  itemId: string;
  itemName: string;
  /** المخصص الحالي بالريال، أو `null` حين لا مخصص */
  currentAllocation: number | null;
  /** المصروف الفعلي المنسوب للبند — الأساس الذي يُقاس عليه المتبقي الناتج */
  spent: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    setItemAllocationAction.bind(null, itemId),
    null,
  );
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const [proposed, setProposed] = useState(currentAllocation === null ? "" : String(currentAllocation));
  const [seenSuccess, setSeenSuccess] = useState<string | undefined>(undefined);
  const router = useRouter();

  // طيّ النموذج بعد **اكتمال** الانتقال — تفكيكه لحظة وصول النتيجة يُجهض تدفّق الاستجابة
  // فتضيع إعادة التصيير (انظر components/form-reset). تعديل الحالة أثناء التصيير هو النمط
  // الموصى به هنا، لا داخل تأثير.
  if (state?.success && !isPending && state.success !== seenSuccess) {
    setSeenSuccess(state.success);
    setOpen(false);
  }

  // التحديث أثر خارجي فيبقى في تأثير
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  // المتبقي الناتج يُحسب حيّاً أثناء الكتابة — الرقم الذي سيراه بعد الحفظ
  const proposedNum = proposed.trim() === "" ? null : Number(proposed);
  const validProposed = proposedNum !== null && Number.isFinite(proposedNum);
  // حساب الهللة نفسه المستعمل على الخادم — فلا يختلف رقم المعاينة عن الرقم المحفوظ
  const resultingRemaining = validProposed ? moneySubtract(proposedNum, spent) : null;
  const belowSpent = validProposed && proposedNum < spent;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "rounded-lg border border-brand-300 px-2 py-1 text-xs text-brand-800 hover:bg-brand-50"
            : "rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800 hover:bg-brand-50"
        }
      >
        {currentAllocation === null ? SET_ALLOCATION_CTA : "تعديل المخصص"}
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="mb-2 text-sm font-medium text-brand-900">
        {SET_ALLOCATION_CTA} — «{itemName}»
      </div>

      {/* ما يراه المستخدم قبل الحفظ (§4.5) */}
      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">المخصص الحالي</dt>
          <dd className="tabular-nums font-medium">
            {currentAllocation === null ? ALLOCATION_NONE_VALUE : currentAllocation}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">المصروف الفعلي</dt>
          <dd className="tabular-nums font-medium">{spent}</dd>
        </div>
        <div>
          <dt className="text-gray-500">المتبقي الناتج</dt>
          <dd className={`tabular-nums font-medium ${belowSpent ? "text-red-700" : "text-emerald-700"}`}>
            {resultingRemaining === null ? "—" : resultingRemaining}
          </dd>
        </div>
      </dl>

      {/* حقل متحكَّم به — المتبقي الناتج أعلاه يتحدث أثناء الكتابة، فلا يصلح `Field` غير المتحكَّم */}
      <div>
        <label htmlFor="allocatedAmount" className="mb-1 block text-sm font-medium text-gray-700">
          المخصص المقترح (اتركه فارغاً لإزالة المخصص)
        </label>
        <input
          id="allocatedAmount"
          name="allocatedAmount"
          type="number"
          step="0.01"
          min="0"
          value={proposed}
          onChange={(e) => setProposed(e.target.value)}
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0"
        />
      </div>
      <div className="mt-2">
        <Field label="ملاحظة التصحيح (اختيارية)" name="note" />
      </div>

      {belowSpent && (
        <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <input type="checkbox" name="confirmBelowSpent" value="1" className="mt-0.5" />
          <span>
            المخصص المقترح أقل من المصروف الفعلي — سيصبح البند متجاوزاً فور الحفظ. أؤكد المتابعة.
          </span>
        </label>
      )}

      {state?.error && <p className="mt-2 text-xs text-red-700">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <SubmitButton>حفظ المخصص</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

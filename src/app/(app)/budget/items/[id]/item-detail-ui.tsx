"use client";

/**
 * تعديل عمليات البند المالي من صفحة التفصيل (v2.3 §6).
 * النموذج قابل للطي لكل صف؛ الحفظ عبر إجراءات الخادم الموثّقة (نسخة + قبل/بعد + updatedBy)،
 * وبعد النجاح يُحدَّث العرض فوراً (router.refresh — لا شاشة قديمة).
 */

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  updateIncomeAction,
  updateExpenseAction,
  deleteIncomeAction,
  deleteExpenseAction,
  type ActionState,
} from "../../actions";

type ItemOption = { id: string; name: string | null };

const selectCls =
  "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0";

function useRefreshOnSuccess(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);
}

export function EditIncomeForm({
  income,
  items,
}: {
  income: {
    id: string;
    source: string;
    amount: string | null;
    incomeDate: string | null;
    purpose: string | null;
    financialItemId: string | null;
    status: string;
    paymentReference: string | null;
    notes: string | null;
  };
  items: ItemOption[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateIncomeAction, null);
  const [open, setOpen] = useState(false);
  useRefreshOnSuccess(state);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-lg border border-sand-200 px-2 py-1 text-xs hover:bg-sand-100 lg:min-h-0"
      >
        تعديل
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-2 w-full space-y-2 rounded-lg bg-sand-50 p-3 text-start">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <input type="hidden" name="incomeId" value={income.id} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="مصدر الإيراد" name="source" defaultValue={income.source} />
        <Field label="المبلغ" name="amount" type="number" defaultValue={income.amount ?? undefined} />
        <Field label="التاريخ" name="incomeDate" type="date" defaultValue={income.incomeDate ?? undefined} />
        <Field label="رقم الفاتورة/السند" name="paymentReference" defaultValue={income.paymentReference ?? undefined} />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`st-${income.id}`}>الحالة</label>
          <select id={`st-${income.id}`} name="status" defaultValue={income.status} className={selectCls}>
            <option value="مستلم">مستلم</option>
            <option value="متوقع">متوقع</option>
            <option value="ملغى">ملغى</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`it-${income.id}`}>البند</label>
          <select id={`it-${income.id}`} name="financialItemId" defaultValue={income.financialItemId ?? ""} className={selectCls}>
            <option value="">— بدون بند —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name ?? "بند بدون اسم"}</option>
            ))}
          </select>
        </div>
        <Field label="الغرض" name="purpose" defaultValue={income.purpose ?? undefined} />
        <Field label="ملاحظات" name="notes" defaultValue={income.notes ?? undefined} />
      </div>
      <div className="flex gap-2">
        <SubmitButton>حفظ التعديل</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
          إغلاق
        </button>
      </div>
    </form>
  );
}

export function EditExpenseForm({
  expense,
  items,
}: {
  expense: {
    id: string;
    amount: string | null;
    expenseDate: string | null;
    financialItemId: string | null;
    category: string | null;
    supplier: string | null;
    paymentReference: string | null;
    notes: string | null;
  };
  items: ItemOption[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateExpenseAction, null);
  const [open, setOpen] = useState(false);
  useRefreshOnSuccess(state);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-lg border border-sand-200 px-2 py-1 text-xs hover:bg-sand-100 lg:min-h-0"
      >
        تعديل
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-2 w-full space-y-2 rounded-lg bg-sand-50 p-3 text-start">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <input type="hidden" name="expenseId" value={expense.id} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="المبلغ" name="amount" type="number" defaultValue={expense.amount ?? undefined} />
        <Field label="التاريخ" name="expenseDate" type="date" defaultValue={expense.expenseDate ?? undefined} />
        <Field label="رقم الفاتورة" name="paymentReference" defaultValue={expense.paymentReference ?? undefined} />
        <Field label="المورّد" name="supplier" defaultValue={expense.supplier ?? undefined} />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`eit-${expense.id}`}>البند</label>
          <select id={`eit-${expense.id}`} name="financialItemId" defaultValue={expense.financialItemId ?? ""} className={selectCls}>
            <option value="">— بدون بند —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>{i.name ?? "بند بدون اسم"}</option>
            ))}
          </select>
        </div>
        <Field label="الوصف" name="category" defaultValue={expense.category ?? undefined} />
        <Field label="ملاحظات" name="notes" defaultValue={expense.notes ?? undefined} />
      </div>
      <div className="flex gap-2">
        <SubmitButton>حفظ التعديل</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
          إغلاق
        </button>
      </div>
    </form>
  );
}

export function DeleteOperationButton({ kind, id }: { kind: "إيراد" | "مصروف"; id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onDelete() {
    if (!window.confirm(`حذف هذا ${kind === "إيراد" ? "الإيراد" : "المصروف"} نهائياً؟ الشواهد المرتبطة تبقى في المكتبة.`)) return;
    setPending(true);
    const result = kind === "إيراد" ? await deleteIncomeAction(id) : await deleteExpenseAction(id);
    setPending(false);
    if (result?.error) setError(result.error);
    else router.refresh();
  }

  return (
    <span>
      {error && <span role="alert" className="me-1 text-xs text-red-700">{error}</span>}
      <button
        onClick={onDelete}
        disabled={pending}
        className="min-h-11 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 lg:min-h-0"
      >
        حذف
      </button>
    </span>
  );
}

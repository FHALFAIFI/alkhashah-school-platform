"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addIncomeAction,
  addExpenseAction,
  deleteIncomeAction,
  deleteExpenseAction,
  type ActionState,
} from "./actions";
import {
  createFinancialItemAction,
  updateFinancialItemAction,
  archiveFinancialItemAction,
  restoreFinancialItemAction,
  reorderFinancialItemAction,
  createDefaultFinancialItemsAction,
  archiveIncomeAction,
  restoreIncomeAction,
  archiveExpenseAction,
  restoreExpenseAction,
} from "./finance-actions";
import { ITEM_COLORS } from "@/lib/finance/colors";
import { Field, TextArea, SubmitButton } from "@/components/ui";
import { formatMoney, orFallback } from "@/lib/format";
import { overrunWarning } from "@/lib/finance/calc";

/**
 * واجهة المالية المدرسية (v2.2 §B).
 *
 * لا يوجد في نماذج التسجيل أي اختيار لبرنامج أو تصنيف أو مجال — المالية على مستوى
 * المدرسة. الاختيار الوحيد هو «بند الصرف» وهو اختياري كذلك.
 */

/** خط بند مالي كما تعرضه اللوحة — الأرقام محسوبة على الخادم لا هنا */
export type ItemLine = {
  id: string;
  name: string | null;
  allocated: number | null;
  income: number;
  expenses: number;
  remaining: number | null;
  hasAllocation: boolean;
};

const money = (n: number | null | undefined) => formatMoney(n ?? null);
const itemLabel = (name: string | null) => orFallback(name, "بند بدون اسم");

export function AddIncomeForm({ planYearId, items }: { planYearId: string; items: ItemLine[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addIncomeAction, null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
        {open ? "إغلاق" : "إضافة إيراد"}
      </button>
      {open && (
        <form key={state?.success} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <input type="hidden" name="planYearId" value={planYearId} />
          <p className="text-xs text-gray-500">كل الحقول اختيارية — يمكن حفظ الإيراد بمعلومات ناقصة.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="مصدر الإيراد" name="source" />
            <Field label="المبلغ" name="amount" type="number" />
            <Field label="التاريخ" name="incomeDate" />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="in-status">الحالة</label>
              <select id="in-status" name="status" defaultValue="مستلم" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
                <option value="مستلم">مستلم</option>
                <option value="متوقع">متوقع</option>
                <option value="ملغى">ملغى</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="in-item">بند الصرف (اختياري)</label>
              <select id="in-item" name="financialItemId" defaultValue="" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
                <option value="">— بدون بند —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{itemLabel(i.name)}</option>
                ))}
              </select>
            </div>
            <Field label="الغرض" name="purpose" />
          </div>
          {/* الإيصال/المستند اختياري — يُحفظ عبر خط الشواهد الآمن نفسه */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="in-invoice">إرفاق الإيصال أو المستند</label>
            <input id="in-invoice" name="invoice" type="file" accept="image/*,application/pdf" className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
            <p className="mt-1 text-xs text-gray-400">صورة أو ملف PDF — اختياري.</p>
          </div>
          <Field label="ملاحظات" name="notes" />
          <SubmitButton>حفظ الإيراد</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function AddExpenseForm({ planYearId, items }: { planYearId: string; items: ItemLine[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addExpenseAction, null);
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState("");

  // §B7: تحذير التجاوز معلوماتي بحت — لا يمنع الحفظ ولا يطلب إقراراً ولا يصبغ أي حقل
  // بالأحمر لعدم الإقرار. الحساب من الخدمة الموحّدة نفسها المستعملة على الخادم.
  const selected = items.find((i) => i.id === itemId);
  const parsedAmount = amount.trim() === "" ? null : Number(amount);
  const warning = selected
    ? overrunWarning({
        allocated: selected.allocated,
        spentSoFar: selected.expenses,
        newAmount: Number.isFinite(parsedAmount as number) ? parsedAmount : null,
      })
    : { willOverrun: false, overrunBy: 0, remainingAfter: null };

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
        {open ? "إغلاق" : "إضافة مصروف"}
      </button>
      {open && (
        <form key={state?.success} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <input type="hidden" name="planYearId" value={planYearId} />
          <p className="text-xs text-gray-500">كل الحقول اختيارية — يمكن حفظ المصروف بمعلومات ناقصة.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ex-amount">المبلغ</label>
              <input
                id="ex-amount"
                name="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0"
              />
            </div>
            <Field label="التاريخ" name="expenseDate" />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ex-item">بند الصرف (اختياري)</label>
              <select
                id="ex-item"
                name="financialItemId"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
              >
                <option value="">— بدون بند —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{itemLabel(i.name)}</option>
                ))}
              </select>
            </div>
            <Field label="رقم الفاتورة" name="paymentReference" />
            <Field label="المورّد" name="supplier" />
            <Field label="التصنيف" name="category" />
          </div>

          {selected && (
            <p className="text-xs text-gray-500">
              {selected.hasAllocation ? (
                <>
                  المخصص: <span className="tabular-nums">{money(selected.allocated)}</span> — المصروف:{" "}
                  <span className="tabular-nums">{money(selected.expenses)}</span> — المتبقي:{" "}
                  <span className={`tabular-nums ${(selected.remaining ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {money(selected.remaining)}
                  </span>
                </>
              ) : (
                <>لا يوجد مخصص لهذا البند — يمكن تعيينه من «بنود الصرف».</>
              )}
            </p>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ex-invoice">إرفاق الفاتورة</label>
            <input id="ex-invoice" name="invoice" type="file" accept="image/*,application/pdf" className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
            <p className="mt-1 text-xs text-gray-400">صورة أو ملف PDF — اختياري.</p>
          </div>
          <TextArea label="ملاحظات" name="notes" rows={2} />

          {warning.willOverrun && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                سيؤدي تسجيل هذه العملية إلى تجاوز المبلغ المخصص بمقدار{" "}
                <span className="font-medium tabular-nums">{money(warning.overrunBy)}</span> ريال.
              </p>
              <p className="mt-1 text-xs text-amber-700">التسجيل مسموح — هذا تنبيه فقط ولا يتطلب أي إقرار.</p>
            </div>
          )}

          <SubmitButton>حفظ المصروف</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** إنشاء/تعديل بند صرف مدرسي — الاسم والمخصص واللون كلها اختيارية */
export function FinancialItemForm({ item }: { item?: ItemLine & { color?: string | null; notes?: string | null } }) {
  const action = item ? updateFinancialItemAction.bind(null, item.id) : createFinancialItemAction;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
        {open ? "إغلاق" : item ? "تعديل" : "إضافة بند صرف"}
      </button>
      {open && (
        <form key={state?.success} action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="اسم البند" name="nameAr" defaultValue={item?.name ?? ""} />
            <Field label="المبلغ المخصص" name="allocatedAmount" type="number" defaultValue={item?.allocated?.toString() ?? ""} />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`c-${item?.id ?? "new"}`}>اللون</label>
              <select
                id={`c-${item?.id ?? "new"}`}
                name="color"
                defaultValue={item?.color ?? ""}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
              >
                <option value="">— بدون —</option>
                {ITEM_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <Field label="ملاحظات" name="notes" defaultValue={item?.notes ?? ""} />
          <SubmitButton>{item ? "حفظ التعديل" : "إنشاء البند"}</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** تدفّق إداري صريح لإنشاء «المستلزمات» و«النشاط» — لا يعمل تلقائياً ولا يكرّر الموجود */
export function CreateDefaultItemsButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await createDefaultFinancialItemsAction();
            setMsg(res?.error ?? res?.success ?? null);
          })
        }
        className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 disabled:opacity-50 lg:min-h-0"
      >
        إنشاء البندين الأساسيين
      </button>
      {msg && <span role="status" className="text-xs text-gray-600">{msg}</span>}
    </span>
  );
}

/** أرشفة/استعادة/ترتيب بند — كلها أفعال idempotent غير مدمّرة */
export function ItemRowActions({ id, archived }: { id: string; archived: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionState>) =>
    startTransition(async () => {
      const res = await fn();
      setError(res?.error ?? null);
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!archived && (
        <>
          <button disabled={pending} onClick={() => run(() => reorderFinancialItemAction(id, "up"))} className="text-xs text-gray-500 hover:underline disabled:opacity-50" aria-label="تحريك لأعلى">▲</button>
          <button disabled={pending} onClick={() => run(() => reorderFinancialItemAction(id, "down"))} className="text-xs text-gray-500 hover:underline disabled:opacity-50" aria-label="تحريك لأسفل">▼</button>
        </>
      )}
      <button
        disabled={pending}
        onClick={() => run(() => (archived ? restoreFinancialItemAction(id) : archiveFinancialItemAction(id)))}
        className="text-xs text-gray-600 hover:underline disabled:opacity-50"
      >
        {archived ? "استعادة" : "أرشفة"}
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/** أرشفة/استعادة/حذف عملية مالية */
export function RecordRowActions({ kind, id, archived }: { kind: "income" | "expense"; id: string; archived: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionState>, confirmText?: string) =>
    startTransition(async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      const res = await fn();
      setError(res?.error ?? null);
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          run(() =>
            archived
              ? kind === "income" ? restoreIncomeAction(id) : restoreExpenseAction(id)
              : kind === "income" ? archiveIncomeAction(id) : archiveExpenseAction(id),
          )
        }
        className="text-xs text-gray-600 hover:underline disabled:opacity-50"
      >
        {archived ? "استعادة" : "أرشفة"}
      </button>
      <button
        disabled={pending}
        onClick={() =>
          run(
            () => (kind === "income" ? deleteIncomeAction(id) : deleteExpenseAction(id)),
            "حذف هذا السجل نهائياً؟ الأرشفة بديل غير مدمّر يبقي السجل في التقارير التاريخية.",
          )
        }
        className="text-xs text-red-500 hover:underline disabled:opacity-50"
      >
        حذف
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

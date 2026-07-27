"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addIncomeAction,
  addExpenseAction,
  acknowledgeOverspendAction,
  deleteIncomeAction,
  deleteExpenseAction,
  type ActionState,
} from "./actions";
import { Field, TextArea, SubmitButton } from "@/components/ui";

type Program = { id: string; name: string; allocated: number; spent: number };

export function AddIncomeForm({ planYearId, programs }: { planYearId: string; programs: Program[] }) {
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
            <Field label="البند" name="purpose" />
            <Field label="الفترة" name="periodText" />
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="in-program">ربط ببرنامج (اختياري)</label>
              <select id="in-program" name="programId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
                <option value="">— بلا ربط —</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <Field label="ملاحظات" name="notes" />
          <SubmitButton>حفظ الإيراد</SubmitButton>
        </form>
      )}
    </div>
  );
}

export function AddExpenseForm({ planYearId, programs }: { planYearId: string; programs: Program[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addExpenseAction, null);
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState("");
  const [amount, setAmount] = useState("");
  const [ackChecked, setAckChecked] = useState(false);

  const selected = programs.find((p) => p.id === programId);
  const remaining = selected ? selected.allocated - selected.spent : 0;
  const wouldOverspend = !!selected && selected.allocated > 0 && Number(amount || 0) > remaining;

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
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ex-program">البرنامج (اختياري)</label>
              <select
                id="ex-program"
                name="programId"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
              >
                <option value="">— بلا ربط —</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <Field label="التصنيف" name="category" />
            <Field label="المورّد (اختياري)" name="supplier" />
            <Field label="رقم الفاتورة (اختياري)" name="paymentReference" />
          </div>
          {/* B3: «البند» قائمة اختيارية بقيم ثابتة تُخزَّن في العمود النصي items نفسه */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ex-items">البند</label>
            <select
              id="ex-items"
              name="items"
              defaultValue=""
              className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
            >
              <option value="">— بدون —</option>
              <option value="المستلزمات">المستلزمات</option>
              <option value="النشاط">النشاط</option>
            </select>
          </div>
          {/* B2: إرفاق فاتورة اختياري — يُحفظ عبر خط الشواهد الآمن ويُربط بالمصروف بعد حفظه */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="ex-invoice">إرفاق الفاتورة</label>
            <input
              id="ex-invoice"
              name="invoice"
              type="file"
              accept="image/*,application/pdf"
              className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">يمكن رفع صورة أو ملف PDF، والحقل اختياري.</p>
          </div>
          <TextArea label="ملاحظات" name="notes" rows={2} />

          {wouldOverspend && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3">
              <p className="text-sm font-medium text-red-800">
                تنبيه تجاوز: هذا المصروف ({Number(amount).toLocaleString("ar")}) يتجاوز المتبقي من مخصص البرنامج
                ({remaining.toLocaleString("ar")}). يُسمح بالتسجيل مع إقرار صريح — ولن تُغيَّر أي قيمة مالية.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-red-800">
                <input type="checkbox" name="overspendAck" checked={ackChecked} onChange={(e) => setAckChecked(e.target.checked)} />
                أقرّ بتسجيل هذا المصروف رغم تجاوزه المخصص
              </label>
              {ackChecked && (
                <input name="overspendAckReason" placeholder="سبب الإقرار بالتجاوز" className="mt-2 w-full rounded border border-red-300 px-2 py-1 text-sm" />
              )}
            </div>
          )}

          <SubmitButton confirmText={wouldOverspend && !ackChecked ? "المصروف يتجاوز المخصص — أقرّ بالتجاوز أولاً" : undefined}>
            حفظ المصروف
          </SubmitButton>
          {wouldOverspend && !ackChecked && (
            <p className="text-xs text-red-600">علّم إقرار التجاوز لحفظ مصروف يتجاوز المخصص.</p>
          )}
        </form>
      )}
    </div>
  );
}

export function DeleteButton({ kind, id }: { kind: "income" | "expense"; id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() =>
          startTransition(async () => {
            if (!window.confirm("حذف هذا السجل؟")) return;
            const res = kind === "income" ? await deleteIncomeAction(id) : await deleteExpenseAction(id);
            if (res?.error) setError(res.error);
          })
        }
        className="text-xs text-red-500 hover:underline"
      >
        حذف
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function AcknowledgeOverspendForm({ expenseId }: { expenseId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(acknowledgeOverspendAction.bind(null, expenseId), null);
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button onClick={() => setOpen(!open)} className="text-xs text-red-600 underline">إقرار التجاوز</button>
      {open && (
        <form action={formAction} className="flex items-center gap-1">
          {state?.error && <span role="alert" className="text-xs text-red-600">{state.error}</span>}
          <input name="reason" placeholder="السبب" required className="rounded border border-red-300 px-2 py-0.5 text-xs" />
          <button className="rounded bg-red-600 px-2 py-0.5 text-xs text-white">تأكيد</button>
        </form>
      )}
    </span>
  );
}

"use client";

/**
 * تصحيح حالات البرامج المتناقضة (v2.4.1 §5.3/§5.4).
 *
 * قاعدتان حاكمتان في هذه الواجهة:
 *  1. **لا تُنتقى «مكتمل» مسبقاً أبداً** — القائمة تبدأ بخيار «اختر الحالة الصحيحة» فارغ،
 *     حتى لا يعيد المستخدم إنتاج التناقض نفسه بضغطة حفظ.
 *  2. الاعتماد والإقفال لا يُمسّان من هنا — لهما إجراءاتهما المدقَّقة في صفحة البرنامج.
 */

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { correctProgramConsistencyAction, bulkCorrectProgramsAction, type ActionState } from "../actions";
import { FOLLOWUP_STATUSES } from "@/lib/plan/followup";

const selectCls =
  "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0";

function useRefreshOnSuccess(state: ActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);
}

export function CorrectProgramForm({
  programId,
  programName,
  currentStatus,
  currentProgress,
  hasCompletedAt,
  locked,
  canOverride,
}: {
  programId: string;
  programName: string;
  currentStatus: string;
  currentProgress: number;
  hasCompletedAt: boolean;
  /** البرنامج مقفل نهائياً — التصحيح يتطلب صلاحية التجاوز */
  locked: boolean;
  canOverride: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [seenSuccess, setSeenSuccess] = useState<string | undefined>(undefined);
  const [state, formAction] = useActionState<ActionState, FormData>(
    correctProgramConsistencyAction.bind(null, programId),
    null,
  );
  useRefreshOnSuccess(state);
  // طيّ النموذج بعد النجاح — تعديل حالة أثناء التصيير لا داخل تأثير
  if (state?.success && state.success !== seenSuccess) {
    setSeenSuccess(state.success);
    setOpen(false);
  }

  if (locked && !canOverride) {
    return (
      <p className="text-xs text-gray-500">
        البرنامج مقفل نهائياً — تصحيح سجله يتطلب صلاحية التجاوز.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800 hover:bg-brand-50"
      >
        تصحيح الحالة
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <p className="mb-2 text-sm font-medium text-brand-900">تصحيح حالة «{programName}»</p>
      {locked && (
        <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
          هذا سجل مقفل — التصحيح يُنفَّذ بصلاحية التجاوز ويُسجَّل في التدقيق.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`status-${programId}`} className="mb-1 block text-sm font-medium text-gray-700">
            حالة التنفيذ الصحيحة
          </label>
          {/* بلا قيمة مبدئية — «مكتمل» ليست منتقاة مسبقاً بالتصميم */}
          <select id={`status-${programId}`} name="executionStatus" required defaultValue="" className={selectCls}>
            <option value="" disabled>
              اختر الحالة الصحيحة…
            </option>
            {FOLLOWUP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">الحالة الحالية: {currentStatus}</p>
        </div>

        <div>
          <label htmlFor={`progress-${programId}`} className="mb-1 block text-sm font-medium text-gray-700">
            نسبة التقدم
          </label>
          <input
            id={`progress-${programId}`}
            name="progress"
            type="number"
            min="0"
            max="100"
            required
            defaultValue={currentProgress}
            className={selectCls}
          />
        </div>

        <div>
          <label htmlFor={`completedAt-${programId}`} className="mb-1 block text-sm font-medium text-gray-700">
            تاريخ الاكتمال
          </label>
          <select id={`completedAt-${programId}`} name="completedAt" defaultValue="keep" className={selectCls}>
            <option value="keep">إبقاء كما هو ({hasCompletedAt ? "موثق" : "غير موثق"})</option>
            <option value="clear">مسح تاريخ الاكتمال</option>
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`note-${programId}`} className="mb-1 block text-sm font-medium text-gray-700">
          سبب التصحيح (إلزامي — يُحفظ في سجل التدقيق)
        </label>
        <textarea
          id={`note-${programId}`}
          name="note"
          required
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {state?.error && <p className="mt-2 text-xs text-red-700">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <SubmitButton>حفظ التصحيح</SubmitButton>
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

/** تصحيح جماعي محدود — بمعاينة الاختيار وعدده وتأكيد صريح. لا «أصلح كل شيء». */
export function BulkCorrectPanel({
  candidates,
  canOverride,
}: {
  candidates: { id: string; label: string; locked: boolean }[];
  canOverride: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [seenSuccess, setSeenSuccess] = useState<string | undefined>(undefined);
  const [state, formAction] = useActionState<ActionState, FormData>(bulkCorrectProgramsAction, null);
  useRefreshOnSuccess(state);
  // تفريغ الاختيار بعد النجاح — تعديل حالة أثناء التصيير لا داخل تأثير
  if (state?.success && state.success !== seenSuccess) {
    setSeenSuccess(state.success);
    setSelected([]);
  }

  const selectable = candidates.filter((c) => !c.locked || canOverride);

  return (
    <details className="rounded-xl border border-sand-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-bold text-brand-900">
        تصحيح جماعي محدود ({selectable.length} برنامج متاح)
      </summary>
      <p className="mt-2 text-xs text-gray-600">
        عمليتان متجانستان فقط. لا يوجد إجراء «أصلح كل التناقضات» — كل برنامج يُختار صراحةً.
      </p>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="programIds" value={selected.join(",")} />

        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 p-2">
          {selectable.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  setSelected((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)))
                }
              />
              <span>
                {c.label}
                {c.locked && <span className="text-amber-700"> — مقفل</span>}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="bulk-op" className="mb-1 block text-sm font-medium text-gray-700">
              العملية
            </label>
            <select id="bulk-op" name="operation" defaultValue="" required className={selectCls}>
              <option value="" disabled>
                اختر العملية…
              </option>
              <option value="resetToNotStarted">إعادة الحالة إلى «لم يبدأ» (وتصفير التقدم والتاريخ)</option>
              <option value="clearCompletionDate">مسح تاريخ الاكتمال فقط</option>
            </select>
          </div>
          <div>
            <label htmlFor="bulk-note" className="mb-1 block text-sm font-medium text-gray-700">
              سبب التصحيح الجماعي (إلزامي)
            </label>
            <input id="bulk-note" name="note" required className={selectCls} />
          </div>
        </div>

        {/* المعاينة والعدد قبل التأكيد */}
        <p className="mt-3 rounded-lg bg-sand-50 p-2 text-xs text-gray-700">
          سيُطبَّق التصحيح على <span className="font-bold tabular-nums">{selected.length}</span> برنامج.
        </p>

        <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
          <input type="checkbox" name="confirm" value="1" required />
          أؤكد تنفيذ العملية الجماعية على البرامج المختارة
        </label>

        {state?.error && <p className="mt-2 text-xs text-red-700">{state.error}</p>}
        {state?.success && <p className="mt-2 text-xs text-emerald-700">{state.success}</p>}

        {/* الزر يظهر فقط عند وجود اختيار — الخادم يرفض القائمة الفارغة أيضاً */}
        <div className="mt-3">
          {selected.length === 0 ? (
            <p className="text-xs text-gray-500">اختر برنامجاً واحداً على الأقل لتفعيل التصحيح الجماعي.</p>
          ) : (
            <SubmitButton>تنفيذ التصحيح الجماعي</SubmitButton>
          )}
        </div>
      </form>
    </details>
  );
}

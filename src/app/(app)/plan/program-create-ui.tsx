"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { createProgramAction, type ActionState } from "./actions";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";

/**
 * «إضافة برنامج» (v2.2 §A1) — نموذج مطوي يفتح داخل صفحة الخطة التشغيلية.
 *
 * كل الحقول اختيارية: الحفظ بمعلومات ناقصة مسموح، والبرنامج بلا عنوان يُعرض «بدون عنوان».
 * لا يُنشئ الحفظ أي أنشطة أو معالم تلقائياً (D-024).
 *
 * منع الإنشاء المكرر طبقتان: `SubmitButton` يعطّل نفسه أثناء التنفيذ على العميل، والخادم
 * يرفض طلباً مطابقاً من المستخدم نفسه خلال نافذة قصيرة. الطبقتان معاً تغطيان النقر المزدوج
 * السريع وإعادة إرسال النموذج.
 */
export function AddProgramPanel() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(createProgramAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const formRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const nameId = useId();
  const domainId = useId();
  const ownerId = useId();
  const periodId = useId();
  const goalId = useId();

  // بعد نجاح الحفظ تُفرَّغ الحقول (تفريغ النموذج فعل على DOM لا حالة React)، فلا تُرسَل
  // القيم نفسها مرة أخرى بالخطأ ويبقى النموذج جاهزاً لإضافة برنامج تالٍ.
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state?.success]);

  const inputCls =
    "w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={headingId}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 lg:min-h-0"
      >
        <span aria-hidden>+</span>
        <span>إضافة برنامج</span>
      </button>

      {open && (
        <div id={headingId} className="mt-3 rounded-xl border border-sand-200 bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-sm font-bold text-brand-900">إضافة برنامج جديد</h2>
          <p className="mb-3 text-xs text-gray-500">
            كل الحقول اختيارية — يمكنك حفظ البرنامج الآن وإكمال تفاصيله لاحقاً من صفحته.
          </p>
          <form ref={formRef} action={formAction} className="space-y-3">
            {state?.error && (
              <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">
                {state.error}
              </div>
            )}
            {state?.success && (
              <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">
                {state.success} — يمكنك إضافة برنامج آخر أو الإغلاق.
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label htmlFor={nameId} className="mb-1 block text-xs text-gray-500">اسم البرنامج</label>
                <input id={nameId} name="name" type="text" maxLength={300} className={inputCls} />
              </div>
              <div>
                <label htmlFor={domainId} className="mb-1 block text-xs text-gray-500">المجال</label>
                <input id={domainId} name="domain" type="text" maxLength={200} className={inputCls} />
              </div>
              <div>
                <label htmlFor={ownerId} className="mb-1 block text-xs text-gray-500">مسؤول التنفيذ</label>
                <input id={ownerId} name="ownerPosition" type="text" maxLength={200} className={inputCls} />
              </div>
              <div>
                <label htmlFor={periodId} className="mb-1 block text-xs text-gray-500">الفترة</label>
                <input id={periodId} name="periodText" type="text" maxLength={200} className={inputCls} />
              </div>
            </div>
            <div>
              <label htmlFor={goalId} className="mb-1 block text-xs text-gray-500">الهدف العام</label>
              <textarea id={goalId} name="generalGoal" rows={2} maxLength={1000} className={inputCls} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton>حفظ البرنامج</SubmitButton>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-sand-100 lg:min-h-0"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

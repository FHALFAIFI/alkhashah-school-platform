"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui";
import type { DeletionImpact } from "@/lib/lifecycle-delete";

/**
 * لوحة الحذف النهائي (v2.4.1 §1.3) — سطح موحّد لحذف المنسوب وحذف دورة الأداء معاً،
 * فلا تتفرع صياغة التحذير ولا خطوات التأكيد بين شاشتين.
 *
 * الترتيب مقصود: **معاينة الأثر أولاً** (ماذا يُحذف وماذا يبقى بالأعداد الفعلية)، ثم
 * الاسم المكتوب حرفياً، ثم السبب الإلزامي، ثم إقرار صريح، وأخيراً الزر الأحمر. كل هذه
 * الشروط مُعادة على الخادم — الواجهة تشرح ولا تحرس.
 */

type ActionState = { error?: string; success?: string } | null;

export function PermanentDeletePanel({
  action,
  impact,
  cta,
  heading,
  intro,
  confirmFieldLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  impact: DeletionImpact;
  /** نص الزر الأحمر — «حذف الموظف نهائياً» أو «حذف دورة الأداء» */
  cta: string;
  heading: string;
  intro: string;
  /** «اسم الموظف» أو «سنة الدورة» */
  confirmFieldLabel: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);

  const expected = impact.confirmName.trim() || "حذف نهائي";
  const blocked = impact.blockers.length > 0;
  const ready = typed.trim() === expected && reason.trim().length >= 5 && ack;
  const totalOwned = impact.owned.reduce((s, l) => s + l.count, 0);

  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
      <h3 className="font-bold text-red-900">{heading}</h3>
      <p className="mt-1 text-xs text-red-800">{intro}</p>
      <p className="mt-1 text-xs text-red-700">
        الحذف النهائي <strong>لا يمكن التراجع عنه</strong> إلا باستعادة نسخة احتياطية كاملة للمنصة.
      </p>

      {blocked ? (
        <ul className="mt-3 space-y-1 rounded-lg border border-red-300 bg-white p-3 text-xs text-red-800">
          {impact.blockers.map((b) => (
            <li key={b} role="alert">⛔ {b}</li>
          ))}
        </ul>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="mt-3 min-h-11 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-800 hover:bg-red-50 lg:min-h-0"
          >
            {open ? "إلغاء" : cta}
          </button>

          {open && (
            <form action={formAction} className="mt-3 space-y-3">
              {state?.error && <div role="alert" className="rounded bg-red-100 p-2 text-xs text-red-800">{state.error}</div>}

              <section className="rounded-lg border border-red-200 bg-white p-3">
                <h4 className="mb-2 text-xs font-bold text-red-900">معاينة الأثر — سجلات تُحذف نهائياً ({totalOwned})</h4>
                <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                  {impact.owned.map((l) => (
                    <li key={l.type} className="flex justify-between gap-2 border-b border-red-50 pb-0.5">
                      <span className="text-gray-700">{l.labelAr}</span>
                      <span className="tabular-nums font-medium text-red-800">{l.count}</span>
                    </li>
                  ))}
                </ul>
                {impact.shared.length > 0 && (
                  <>
                    <h4 className="mb-2 mt-4 text-xs font-bold text-emerald-900">
                      سجلات مؤسسية مشتركة — تبقى كما هي وتُفكّ صلتها فقط
                    </h4>
                    <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                      {impact.shared.map((l) => (
                        <li key={l.type} className="flex justify-between gap-2 border-b border-emerald-50 pb-0.5">
                          <span className="text-gray-700">{l.labelAr}</span>
                          <span className="tabular-nums font-medium text-emerald-800">{l.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <div>
                <label htmlFor="pd-typed" className="mb-1 block text-sm font-medium text-gray-700">
                  اكتب {confirmFieldLabel} حرفياً للتأكيد: <span className="font-bold text-red-800">{expected}</span>
                </label>
                <input
                  id="pd-typed"
                  name="typedName"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0"
                />
              </div>

              <div>
                <label htmlFor="pd-reason" className="mb-1 block text-sm font-medium text-gray-700">
                  سبب الحذف (إلزامي — يُحفظ في شاهد الحذف)
                </label>
                <textarea
                  id="pd-reason"
                  name="reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-red-900">
                <input
                  type="checkbox"
                  name="confirm"
                  value="1"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>أُقرّ بأن الحذف نهائي ولا يمكن التراجع عنه، وأن السجلات المعروضة أعلاه ستُمحى من قاعدة البيانات.</span>
              </label>

              {ready ? (
                <SubmitButton variant="danger" confirmText={`${cta} — ${impact.displayRef}؟ لا يمكن التراجع.`}>
                  {cta}
                </SubmitButton>
              ) : (
                <p className="text-xs text-gray-500">
                  أكمل الحقول الثلاثة أعلاه ليصبح زر التنفيذ متاحاً.
                </p>
              )}
            </form>
          )}
        </>
      )}
    </div>
  );
}

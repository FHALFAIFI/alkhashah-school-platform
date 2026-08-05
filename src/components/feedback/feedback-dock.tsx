"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { submitFeedbackAction, type FeedbackSubmitState } from "@/app/(app)/feedback/actions";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_MODULES,
  moduleFromPath,
} from "@/lib/feedback/constants";
import { useRefreshAfterTransition } from "@/components/form-reset";

/**
 * «إرسال ملاحظة» (v2.3 §19) — زر مدمج في الشريط العلوي الثابت لا زر عائم:
 * أيقونة بمسمى وصفي متاحة في كل الصفحات، لا تغطي المحتوى ولا أزرار المخطط ولا
 * الجداول. النموذج المفتوح لوح جانبي (z-50) فوق كل شيء، رأسي بالكامل وصالح
 * للاستخدام على 390×844.
 */
export function FeedbackDock({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ ref: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  const formRef = useRef<HTMLFormElement>(null);

  // قفل تمرير الصفحة أثناء فتح النموذج على الجوال + إغلاق بـ Escape
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled) return null;
  if (pathname.startsWith("/admin/feedback")) return null; // لا داعي للزر داخل شاشة الإدارة نفسها

  function close() {
    setOpen(false);
    setError(null);
    setDone(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("pagePath", pathname);
    fd.set("viewport", `${window.innerWidth}×${window.innerHeight}`);
    startTransition(async () => {
      const res: FeedbackSubmitState = await submitFeedbackAction(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.ok && res.ref) {
        setDone({ ref: res.ref });
        form.reset();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => {
          setDone(null);
          setError(null);
          setOpen(true);
        }}
        aria-label="إرسال ملاحظة عن هذه الصفحة"
        title="إرسال ملاحظة"
        data-testid="feedback-open"
        className="no-print flex min-h-11 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100 lg:min-h-0"
      >
        <span aria-hidden>✎</span>
        <span className="hidden sm:inline">إرسال ملاحظة</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="إرسال ملاحظة عن التشغيل التجريبي"
          className="no-print fixed inset-0 z-50 flex flex-col bg-white lg:inset-y-0 lg:end-0 lg:start-auto lg:w-[440px] lg:border-s lg:border-sand-200 lg:shadow-xl"
        >
          <div
            className="flex items-center justify-between border-b border-sand-200 px-3 py-2"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg text-amber-600" aria-hidden>✎</span>
              <span className="font-bold text-brand-900">إرسال ملاحظة</span>
            </div>
            <button
              onClick={close}
              aria-label="إغلاق"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-sand-100"
            >
              ✕
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto p-4"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {done ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center" data-testid="feedback-success">
                <p className="text-lg font-bold text-emerald-900">تم تسجيل ملاحظتك</p>
                <p className="mt-2 text-sm text-emerald-800">
                  الرقم المرجعي: <span className="font-bold tabular-nums" dir="ltr">{done.ref}</span>
                </p>
                <p className="mt-1 text-xs text-emerald-700">يمكنك متابعتها لاحقاً في مركز الملاحظات.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => {
                      setDone(null);
                      setError(null);
                    }}
                    className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    إرسال ملاحظة أخرى
                  </button>
                  <button onClick={close} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    إغلاق
                  </button>
                </div>
              </div>
            ) : (
              <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
                <p className="rounded-lg bg-sand-50 p-2 text-xs text-gray-500">
                  نلتقط تلقائياً مسار الصفحة ونوع الجهاز ونسخة التطبيق فقط — لا نلتقط أي محتوى أو بيانات من الشاشة.
                </p>
                {error && (
                  <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                    {error}
                  </div>
                )}

                <Labeled label="الوحدة">
                  <select name="module" defaultValue={moduleFromPath(pathname)} className={selectCls}>
                    {FEEDBACK_MODULES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Labeled>

                <Labeled label="الفئة">
                  <select name="category" defaultValue="مشكلة" className={selectCls}>
                    {FEEDBACK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Labeled>

                <Labeled label="الأهمية">
                  <select name="severity" defaultValue="ملاحظة بسيطة" className={selectCls}>
                    {FEEDBACK_SEVERITIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </Labeled>

                <Labeled label="عنوان مختصر">
                  <input name="title" maxLength={200} className={inputCls} placeholder="مثال: زر الحفظ لا يستجيب" />
                </Labeled>

                <Labeled label="ما الذي كنت تحاول عمله؟">
                  <textarea name="attempted" rows={2} className={textareaCls} />
                </Labeled>

                <Labeled label="ما الذي حدث؟">
                  <textarea name="happened" rows={2} className={textareaCls} />
                </Labeled>

                <Labeled label="ما الذي كنت تتوقعه؟">
                  <textarea name="expected" rows={2} className={textareaCls} />
                </Labeled>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" name="blocked" className="h-5 w-5 rounded border-gray-300" />
                  هذه المشكلة تمنعني من إكمال العمل
                </label>

                <Labeled label="مرفق اختياري (صورة أو مستند)">
                  <input
                    type="file"
                    name="attachment"
                    accept="image/*,.pdf,.docx,.xlsx,.txt"
                    className="block w-full text-sm text-gray-600 file:me-3 file:rounded-lg file:border-0 file:bg-sand-100 file:px-3 file:py-2 file:text-sm"
                  />
                </Labeled>

                <button
                  type="submit"
                  disabled={pending}
                  className="min-h-12 w-full rounded-lg bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {pending ? "جارٍ الإرسال…" : "إرسال الملاحظة"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const inputCls =
  "min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
const textareaCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
const selectCls =
  "min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

function Labeled({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        <span>{label}</span>
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}

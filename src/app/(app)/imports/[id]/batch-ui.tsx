"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import {
  commitBatchAction,
  rollbackBatchAction,
  cancelBatchAction,
  correctRowAction,
  excludeRowAction,
  markRowReadyAction,
  deferRowAction,
  returnRowToReviewAction,
  undoRowDecisionAction,
  type RowActionResult,
} from "../actions";
import { Badge, SubmitButton } from "@/components/ui";
import { useRefreshAfterTransition } from "@/components/form-reset";

/*
 * حالة الصف المؤكَّدة من العميل (D-069).
 *
 * كانت شارة حالة الصف تُصيَّر من الخادم وحده، فلا تتغير إلا بوصول تحديث الصفحة الذي يلي
 * الإجراء — وقد ثبت أن بناء الإنتاج كان يُسقط ذلك التحديث بانتظام (عيب Next 16.2 مع حدود
 * `loading.tsx` — تفصيله في D-069) فلا يظهر «مستبعد» رغم نجاح الإجراء في القاعدة. ومع زوال
 * المسبِّب، تبقى القاعدة: الحالة المرئية الحرِجة لا تُعلَّق على تحديثٍ لاحق أصلاً. يعيد
 * إجراء القرار الحالة الجديدة
 * في استجابته، وتُنشر هنا في مخزن وحدةٍ مشترك تقرؤه نسختا الصف (بطاقة الجوال وجدول سطح
 * المكتب) معاً — فتظهر الحالة الجديدة فور استقرار نتيجة الإجراء، ويبقى تحديث الصفحة مصالحةً
 * للعدادات وبوابة التنفيذ لا شرطاً لرؤية الحالة. حين يلحق تصيير الخادم بالقيمة المؤكدة
 * يُحذف التجاوز فيعود الخادم مصدر الحقيقة الوحيد.
 */
const rowStatusOverrides = new Map<string, string>();
const rowStatusListeners = new Set<() => void>();

function publishRowStatus(rowId: string, status: string) {
  rowStatusOverrides.set(rowId, status);
  for (const listener of rowStatusListeners) listener();
}

function useRowStatus(rowId: string, serverStatus: string): string {
  const subscribe = useCallback((onChange: () => void) => {
    rowStatusListeners.add(onChange);
    return () => {
      rowStatusListeners.delete(onChange);
    };
  }, []);
  const override = useSyncExternalStore(
    subscribe,
    () => rowStatusOverrides.get(rowId),
    () => undefined,
  );
  useEffect(() => {
    // تصيير الخادم لحق بالقيمة المؤكدة — التجاوز أدى غرضه ويُحذف
    if (override !== undefined && override === serverStatus) rowStatusOverrides.delete(rowId);
  }, [override, serverStatus, rowId]);
  return override ?? serverStatus;
}

/** شارة حالة الصف — تعرض الحالة المؤكدة من العميل فور القرار، وحالة الخادم فيما عدا ذلك */
export function RowStatusBadge({ rowId, status }: { rowId: string; status: string }) {
  return <Badge value={useRowStatus(rowId, status)} />;
}

export function BatchActions({
  batchId,
  status,
  canCommit,
  canRollback,
  rollbackPreflight,
  reviewCount,
  deferredCount,
  fileName,
  confirmTitle,
  confirmItems,
}: {
  batchId: string;
  status: string;
  canCommit: boolean;
  canRollback: boolean;
  rollbackPreflight?: {
    importedCount: number;
    dependencies: { type: string; labelAr: string; count: number }[];
    blocked: boolean;
  } | null;
  reviewCount: number;
  deferredCount: number;
  fileName: string;
  confirmTitle: string;
  confirmItems: { label: string; value: number }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredHref, setSessionExpiredHref] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار.
  // يُستثنى انتهاء الجلسة: التحديث حينها يُحوّل إلى صفحة الدخول فيمحو رسالة «انتهت الجلسة»
  // ورابط العودة إلى الدفعة قبل أن يراهما المستخدم — وهو بالضبط ما يحتاجه ليكمل.
  useRefreshAfterTransition(pending, { skip: sessionExpiredHref !== null });

  return (
    <div className="mb-4 rounded-xl border border-sand-200 bg-white p-4">
      {sessionExpiredHref && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">انتهت الجلسة. لم يتم تنفيذ الاستيراد. سجّل الدخول ثم ارجع إلى الدفعة.</p>
          <a
            href={sessionExpiredHref}
            className="mt-2 inline-block rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
          >
            تسجيل الدخول والعودة إلى الدفعة
          </a>
        </div>
      )}
      {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="flex flex-wrap items-center gap-3">
        {status === "معاينة" && !confirming && (
          <>
            <button
              disabled={!canCommit || pending}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              موافقة صريحة وتنفيذ الاستيراد
            </button>
            {reviewCount > 0 && (
              <span className="text-sm text-amber-700">
                لا يمكن التنفيذ قبل تصحيح أو استبعاد {reviewCount} صفاً بحاجة إلى مراجعة
              </span>
            )}
            {deferredCount > 0 && (
              <span className="text-sm text-indigo-700">
                لا يمكن التنفيذ قبل حسم {deferredCount} صفاً مؤجلاً (تأكيد/تصحيح/استبعاد)
              </span>
            )}
          </>
        )}
        {status === "معاينة" && confirming && (
          <div className="w-full rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="mb-2 font-bold text-brand-900">{confirmTitle}</p>
            <ul className="mb-3 space-y-1 text-sm text-brand-900">
              <li>اسم الملف: <span className="font-medium">{fileName}</span></li>
              {confirmItems.map((it) => (
                <li key={it.label}>
                  {it.label}: <span className="font-medium tabular-nums">{it.value}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    setSessionExpiredHref(null);
                    try {
                      const res = await commitBatchAction(batchId);
                      if (res?.code === "SESSION_EXPIRED") {
                        // انتهت الجلسة: أوقف المؤشر، أظهر الرسالة ورابط الدخول، ولا تُعِد المحاولة
                        setSessionExpiredHref(res.loginHref ?? "/login");
                        return;
                      }
                      if (res?.code === "ALREADY_EXECUTED") {
                        // نُفّذت مسبقاً: حالة راهنة ناجحة — تُعرض «تم الاستيراد» بلا خطأ مُفزع
                        // بعد التحديث الذي يلي انتهاء الانتقال (D-053)
                        return;
                      }
                      if (res?.code === "PERMISSION_DENIED") {
                        setError(res.error ?? "لا تملك صلاحية تنفيذ الاستيراد. لم يتم تنفيذ الاستيراد.");
                        return;
                      }
                      if (res?.error) {
                        // فشل مُبلَّغ من الخادم: أبقِ اللوحة مفتوحة وأظهر الخطأ — الحالة
                        // تُعاد قراءتها بالتحديث الذي يلي انتهاء الانتقال (D-053)
                        setError(res.error);
                        return;
                      }
                      // نجاح: «تم الاستيراد» تظهر بعد التحديث الذي يلي انتهاء الانتقال
                    } catch {
                      // استجابة غير مؤكدة (انقطاع/إجهاض): لا تُعِد المحاولة تلقائياً —
                      // أعد تحميل حالة الدفعة أولاً ووجّه المستخدم لمراجعتها قبل أي محاولة ثانية
                      setError(
                        "تعذّر تأكيد نتيجة التنفيذ. أعدنا تحميل حالة الدفعة — راجع الحالة أعلاه: إن ظهرت «منفذة» فقد تم الاستيراد ولا تُعد المحاولة، وإلا فأعد المحاولة.",
                      );
                      // التحديث يتم بعد انتهاء الانتقال (D-053) — لا داخله
                    }
                  })
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "جارٍ تنفيذ الاستيراد…" : "تأكيد التنفيذ"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-sand-100 disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
        {status === "معاينة" && !confirming && (
          <button
            disabled={pending}
            onClick={() => {
              if (!confirm("إلغاء دفعة المعاينة هذه؟ لن تُنفذ، وتُحفظ كـ«ملغاة» ويمكنك رفع الملف من جديد بعدها.")) return;
              startTransition(async () => {
                setError(null);
                const res = await cancelBatchAction(batchId);
                if (res?.error) setError(res.error);
              });
            }}
            className="rounded-lg border border-sand-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-sand-100 disabled:opacity-50"
          >
            إلغاء الدفعة (لن تُنفذ)
          </button>
        )}
        {canRollback && (
          rollbackPreflight?.blocked ? (
            // تبعيات قائمة → التراجع الكامل غير متاح (حارس الخادم يرفضه أيضاً)
            <div className="w-full rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-bold text-red-900">التراجع الكامل عن الدفعة:</span>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  غير متاح لوجود سجلات مرتبطة
                </span>
              </div>
              <p className="text-sm text-red-800">
                يرتبط بعض موظفي هذه الدفعة بسجلات عمل لاحقة. لن تُحذف هذه السجلات ولن تُعدّل. أنواع الارتباطات وأعدادها:
              </p>
              <ul className="my-2 list-disc space-y-0.5 pe-6 text-sm text-red-900">
                {rollbackPreflight.dependencies.map((d) => (
                  <li key={d.type}>
                    {d.labelAr}: <span className="font-medium tabular-nums">{d.count}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-red-800">
                لتعديل موظف بعينه، استخدم تصحيح بياناته أو تعطيله فردياً من «سجل المعلمين والموظفين» بدلاً من التراجع الكامل عن الدفعة.
              </p>
              <button
                type="button"
                disabled
                title="غير متاح لوجود سجلات مرتبطة"
                className="mt-3 cursor-not-allowed rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-400 opacity-60"
              >
                تراجع كامل عن الدفعة
              </button>
            </div>
          ) : (
            // لا تبعيات → التراجع الكامل متاح
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={pending}
                onClick={() => {
                  if (!confirm("هل أنت متأكد من التراجع الكامل عن هذه الدفعة؟ ستحذف السجلات المنشأة منها.")) return;
                  startTransition(async () => {
                    setError(null);
                    const res = await rollbackBatchAction(batchId);
                    if (res?.error) setError(res.error);
                  });
                }}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                تراجع كامل عن الدفعة
              </button>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">متاح</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export type RowHistoryEntry = {
  at: string;
  action: string;
  by: string;
  from: { status: string };
  to: { status: string };
  resolvedWarnings?: string[];
};

/** زر إجراء موحد لأزرار الصف — هدف لمس ≥44px على الجوال ومضغوط على سطح المكتب */
function rowBtn(extra: string) {
  return `min-h-11 rounded border px-2 py-1 text-xs lg:min-h-0 ${extra}`;
}

export function RowEditor({
  rowId,
  batchId,
  fields,
  values,
  status: serverStatus,
  history = [],
}: {
  rowId: string;
  batchId: string;
  fields: { key: string; label: string }[];
  values: Record<string, string>;
  status: string;
  history?: RowHistoryEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  // D-069: الأزرار تُبنى على الحالة الفعلية — المؤكدة من العميل إن سبقت تصيير الخادم
  const status = useRowStatus(rowId, serverStatus);

  // نتيجة القرار تُنشر فور استقرارها: الشارة والأزرار تتغير دون انتظار تحديث الصفحة
  const decide = (fn: () => Promise<RowActionResult>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
      else if (res?.status) publishRowStatus(rowId, res.status);
    });

  if (!open) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => setOpen(true)} className={rowBtn("border-sand-200 hover:bg-sand-100")}>
            تصحيح
          </button>
          {status !== "جاهز" && (
            <button
              disabled={pending}
              onClick={() => decide(() => markRowReadyAction(rowId, batchId))}
              className={rowBtn("border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50")}
            >
              تأكيد كجاهز
            </button>
          )}
          {status !== "مستبعد" && (
            <button
              disabled={pending}
              onClick={() => decide(() => excludeRowAction(rowId, batchId))}
              className={rowBtn("border-sand-200 text-gray-500 hover:bg-sand-100 disabled:opacity-50")}
            >
              استبعاد
            </button>
          )}
          {status !== "مؤجل" && (
            <button
              disabled={pending}
              onClick={() => decide(() => deferRowAction(rowId, batchId))}
              className={rowBtn("border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50")}
            >
              تأجيل
            </button>
          )}
          {status !== "يحتاج مراجعة" && (
            <button
              disabled={pending}
              onClick={() => decide(() => returnRowToReviewAction(rowId, batchId))}
              className={rowBtn("border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50")}
            >
              إعادة إلى المراجعة
            </button>
          )}
          {history.length > 0 && (
            <button
              disabled={pending}
              onClick={() => decide(() => undoRowDecisionAction(rowId, batchId))}
              className={rowBtn("border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50")}
            >
              تراجع عن آخر قرار
            </button>
          )}
        </div>
        {history.length > 0 && <RowHistory history={history} />}
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        {pending && <p className="text-xs text-gray-400">جارٍ التنفيذ…</p>}
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await correctRowAction(rowId, batchId, fd);
          if (res?.error) {
            setError(res.error);
            return;
          }
          if (res?.status) publishRowStatus(rowId, res.status);
          setOpen(false);
        })
      }
      className="w-full max-w-64 space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-2"
    >
      {fields.map((f) => (
        <div key={f.key}>
          <label className="block text-xs text-gray-500">{f.label}</label>
          {f.key === "category" ? (
            <select name={`f_${f.key}`} defaultValue={values[f.key] ?? "موظف"} className="w-full rounded border border-gray-300 px-2 py-1 text-base lg:text-xs">
              <option value="معلم">معلم</option>
              <option value="موظف">موظف</option>
            </select>
          ) : (
            <input name={`f_${f.key}`} defaultValue={values[f.key] ?? ""} className="w-full rounded border border-gray-300 px-2 py-1 text-base lg:text-xs" />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <SubmitButton>حفظ كجاهز</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">
          إلغاء
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {pending && <p className="text-xs text-gray-400">جارٍ الحفظ…</p>}
    </form>
  );
}

/** سجل قرارات الصف — يعرض القرارات بترتيبها مع التحذيرات المحسومة وقت كل قرار */
function RowHistory({ history }: { history: RowHistoryEntry[] }) {
  return (
    <details className="text-xs text-gray-500">
      <summary className="cursor-pointer select-none py-1 text-gray-400 hover:text-gray-600">
        سجل القرارات ({history.length})
      </summary>
      <ol className="ms-3 mt-1 space-y-1 border-s border-sand-200 ps-2">
        {history.map((h, i) => (
          <li key={i}>
            <span className="font-medium text-gray-600">{h.action}</span>
            {" — "}
            {h.from.status} ← {h.to.status}
            {" · "}
            {h.by}
            {" · "}
            <span dir="ltr" className="tabular-nums">{h.at.slice(0, 16).replace("T", " ")}</span>
            {h.resolvedWarnings?.map((w, j) => (
              <div key={j} className="text-amber-600">⚠ {w}</div>
            ))}
          </li>
        ))}
      </ol>
    </details>
  );
}

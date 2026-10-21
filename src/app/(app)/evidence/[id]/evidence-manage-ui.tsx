"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveEvidenceAction,
  deleteEvidenceAction,
  replaceEvidenceContentAction,
  restoreEvidenceAction,
  type ActionState,
} from "../actions";
import { Card, Field, SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";

/**
 * إدارة الشاهد: استبدال المحتوى (مع حفظ النسخة السابقة)، الأرشفة، الاستعادة، والحذف
 * النهائي المشروط. كلها تحافظ على روابط الشاهد — لا يُكسر أي سجل مرتبط.
 */
export function EvidenceManageUI({
  evidenceId,
  currentKind,
  archived,
  canDelete,
}: {
  evidenceId: string;
  currentKind: string;
  archived: boolean;
  /** الحذف النهائي متاح فقط حين لا توجد أي ارتباطات (يُقيَّم في الخادم أيضاً) */
  canDelete: boolean;
}) {
  const [replaceState, replaceAction] = useActionState<ActionState, FormData>(replaceEvidenceContentAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(replaceState);
  const [archiveState, archiveAction] = useActionState<ActionState, FormData>(archiveEvidenceAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(archiveState);
  const [kind, setKind] = useState(currentKind);
  const [showReplace, setShowReplace] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  /*
   * D-065: الاستعادة كانت تنجح وتُظهر رسالتها، وتبقى الصفحة تعرض الشاهد مؤرشفاً وزر
   * «استعادة الشاهد» في مكانه — لأن `archived` قيمة من الخادم. التحديث بعد انتهاء الانتقال.
   */
  useRefreshAfterTransition(pending);

  return (
    <div className="space-y-4">
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg p-3 text-sm ${notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}
        >
          {notice.text}
        </div>
      )}

      {!archived && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-brand-900">استبدال المحتوى</h2>
            <button
              onClick={() => setShowReplace(!showReplace)}
              className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0"
            >
              {showReplace ? "إغلاق" : "استبدال الملف"}
            </button>
          </div>
          <p className="text-xs text-gray-600">
            الاستبدال يحفظ النسخة الحالية في سجل النسخ ويبقي كل السجلات المرتبطة مشيرةً إلى الشاهد نفسه — لا حاجة
            لإعادة الربط، ويعود الشاهد إلى «لم يراجع» لأن محتواه تغيّر.
          </p>
          {showReplace && (
            <form action={replaceAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
              {replaceState?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{replaceState.error}</div>}
              {replaceState?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{replaceState.success}</div>}
              <input type="hidden" name="evidenceId" value={evidenceId} />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">نوع المحتوى البديل</label>
                <div className="flex gap-3 text-sm">
                  {[["file", "ملف"], ["link", "رابط"], ["text", "نص"]].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-1">
                      <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              {kind === "file" && (
                <input name="file" type="file" className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
              )}
              {kind === "link" && <Field label="الرابط البديل" name="url" dir="ltr" placeholder="https://..." />}
              {kind === "text" && (
                <textarea name="textContent" rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="نص الشاهد البديل" />
              )}
              <Field label="سبب الاستبدال" name="reason" required hint="يُحفظ مع النسخة السابقة في سجل التدقيق" />
              <SubmitButton>حفظ النسخة الجديدة</SubmitButton>
            </form>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-bold text-gray-800">الأرشفة والحذف</h2>
        {archived ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">هذا الشاهد مؤرشف — مخفي من الوحدات مع بقاء كل روابطه وبياناته.</p>
            <button
              onClick={() =>
                startTransition(async () => {
                  setNotice(null);
                  const res = await restoreEvidenceAction(evidenceId);
                  if (res?.error) setNotice({ kind: "error", text: res.error });
                  else setNotice({ kind: "ok", text: res?.success ?? "استُعيد الشاهد" });
                })
              }
              className="min-h-11 rounded-lg border border-sand-200 px-4 py-2 text-sm font-medium hover:bg-sand-100 lg:min-h-0"
            >
              استعادة الشاهد
            </button>
          </div>
        ) : (
          <form action={archiveAction} className="space-y-3">
            {archiveState?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{archiveState.error}</div>}
            {archiveState?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{archiveState.success}</div>}
            <input type="hidden" name="evidenceId" value={evidenceId} />
            <Field label="سبب الأرشفة" name="reason" required hint="الأرشفة إخفاء غير مدمّر — لا يُحذف أي رابط ويمكن الاستعادة في أي وقت" />
            <SubmitButton variant="secondary">أرشفة الشاهد</SubmitButton>
          </form>
        )}

        {canDelete && (
          <div className="mt-4 border-t border-sand-100 pt-3">
            <button
              onClick={() =>
                startTransition(async () => {
                  if (!window.confirm("حذف الشاهد نهائياً؟ لا يمكن التراجع.")) return;
                  setNotice(null);
                  const res = await deleteEvidenceAction(evidenceId);
                  if (res?.error) setNotice({ kind: "error", text: res.error });
                  // تنقّل داخل التطبيق لا تحميل كامل — القاعدة الجديدة في eslint-config-next 16.3
                  else router.push("/evidence");
                })
              }
              className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 lg:min-h-0"
            >
              حذف نهائي
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

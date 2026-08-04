"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createIssueAction, transitionIssueAction, updateIssueReportFieldsAction, type ActionState } from "../actions";
import { ISSUE_TRANSITIONS, transitionLabel } from "@/lib/building/maintenance-lifecycle";
import { Field, TextArea, SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
import { MAINTENANCE_CATEGORIES, MAINTENANCE_FIELD_UNSET } from "@/lib/building/maintenance-report";

export function NewIssueForm({
  rooms,
  people,
}: {
  rooms: { id: string; label: string }[];
  people: { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createIssueAction, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label="عنوان البلاغ" name="title" />
        </div>
        <div className="min-w-56 max-w-full">
          <label className="mb-1 block text-sm font-medium text-gray-700">الغرفة</label>
          <select name="roomId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— غير محددة —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">الأولوية</label>
          <select name="priority" defaultValue="متوسطة" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="عالية">عالية</option>
            <option value="متوسطة">متوسطة</option>
            <option value="منخفضة">منخفضة</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label="الوصف" name="description" />
        </div>
        <div className="min-w-56 max-w-full">
          <label className="mb-1 block text-sm font-medium text-gray-700">المكلف بالإصلاح (اختياري)</label>
          <select name="ownerPersonId" className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
            <option value="">— بلا تكليف —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="max-w-full">
          <label className="mb-1 block text-sm font-medium text-gray-700">صورة (اختياري)</label>
          <input name="photo" type="file" accept="image/*" className="w-full max-w-64 text-sm" />
          <p className="mt-1 text-xs text-gray-400">التقط صورة أو اختر ملفاً من الجهاز</p>
        </div>
        <SubmitButton>تسجيل البلاغ</SubmitButton>
      </div>
    </form>
  );
}

/**
 * التحكم في دورة حياة البلاغ (v2.3 §18) — الأزرار من خريطة الانتقالات المسموحة نفسها
 * المنفَّذة على الخادم؛ الانتقالات ذات الحقول (الإرسال/نتيجة المعالجة/إغلاق «لم يتم
 * الإصلاح») تفتح نموذجاً صغيراً بالحقول المطلوبة.
 */
export function IssueWorkflowControl({
  issueId,
  status,
  resolution,
}: {
  issueId: string;
  status: string;
  resolution: string | null;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(transitionIssueAction, null);
  const router = useRouter();
  // بعد نجاح الانتقال: تحديث فوري للعرض — لا شاشة قديمة تحتاج تحديثاً يدوياً
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  const allowed = ISSUE_TRANSITIONS[status] ?? [];
  if (allowed.length === 0) return null;

  return (
    // يُطوى نموذج الانتقال بعد **اكتمال** الانتقال لا في لحظة وصول النتيجة: تفكيك النموذج
    // أثناء تدفّق استجابة الإجراء يُجهض التدفّق فتضيع إعادة التصيير (انظر components/form-reset).
    <div key={state?.success && !isPending ? state.success : "init"}>
      <WorkflowButtons state={state} formAction={formAction} issueId={issueId} allowed={allowed} resolution={resolution} />
    </div>
  );
}

function WorkflowButtons({
  state,
  formAction,
  issueId,
  allowed,
  resolution,
}: {
  state: ActionState;
  formAction: (formData: FormData) => void;
  issueId: string;
  allowed: string[];
  resolution: string | null;
}) {
  const [openTransition, setOpenTransition] = useState<string | null>(null);

  const needsForm = (to: string) =>
    to === "تم الإرسال" ||
    to === "تم الإصلاح" ||
    to === "لم يتم الإصلاح" ||
    (to === "مغلق" && resolution === "لم يتم الإصلاح");

  return (
    <div className="space-y-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="flex flex-wrap gap-1.5">
        {allowed.map((to) =>
          needsForm(to) ? (
            <button
              key={to}
              type="button"
              onClick={() => setOpenTransition(openTransition === to ? null : to)}
              className="min-h-11 rounded-lg border border-sand-200 px-2.5 py-1 text-xs hover:bg-sand-100 lg:min-h-0"
            >
              {transitionLabel(to)}
            </button>
          ) : (
            <form key={to} action={formAction} className="inline">
              <input type="hidden" name="issueId" value={issueId} />
              <input type="hidden" name="toStatus" value={to} />
              <SubmitButton variant="secondary">{transitionLabel(to)}</SubmitButton>
            </form>
          ),
        )}
      </div>

      {openTransition && (
        <form action={formAction} className="space-y-2 rounded-lg bg-sand-50 p-3">
          <input type="hidden" name="issueId" value={issueId} />
          <input type="hidden" name="toStatus" value={openTransition} />
          <p className="text-xs font-bold text-gray-600">{transitionLabel(openTransition)}</p>

          {openTransition === "تم الإرسال" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="الجهة المستلمة (شركة الصيانة / الجهة المسؤولة)" name="sentTo" required />
              <Field label="تاريخ الإرسال" name="sentAt" type="date" />
            </div>
          )}

          {(openTransition === "تم الإصلاح" || openTransition === "لم يتم الإصلاح") && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="تاريخ زيارة الصيانة" name="visitDate" type="date" />
              <Field label="الإجراء المتخذ" name="actionTaken" />
              <Field label="ملاحظة الإصلاح" name="repairNote" />
            </div>
          )}

          {openTransition === "مغلق" && resolution === "لم يتم الإصلاح" && (
            <div className="space-y-2">
              <Field label="سبب الإغلاق دون إصلاح" name="closureReason" required />
              <Field label="توصية المتابعة" name="followupRecommendation" required />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">هل يلزم تصعيد أو بلاغ جديد؟ <span className="text-red-500">*</span></label>
                <select name="escalationNeeded" required defaultValue="" className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0">
                  <option value="" disabled>اختر</option>
                  <option value="نعم">نعم — يلزم تصعيد أو بلاغ جديد</option>
                  <option value="لا">لا</option>
                </select>
              </div>
            </div>
          )}

          <Field label="ملاحظة على الانتقال (اختياري)" name="note" />
          <div className="flex gap-2">
            <SubmitButton>تأكيد</SubmitButton>
            <button type="button" onClick={() => setOpenTransition(null)} className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0">
              إلغاء
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * v2.4.1 §1.2: بيانات تقرير الصيانة الرسمي على بلاغ قائم — التصنيف وأثر السلامة والأثر
 * التشغيلي والإجراء المطلوب. كلها اختيارية، وقابلة للتعديل قبل الاعتماد وبعده: تصحيح
 * وصف عطل بعد الاعتماد لا يستدعي إلغاء الاعتماد ولا إعادة إنشاء البلاغ.
 */
export function IssueReportFieldsForm({
  issueId,
  category,
  safetyImpact,
  operationalImpact,
  requestedAction,
}: {
  issueId: string;
  category: string | null;
  safetyImpact: string | null;
  operationalImpact: string | null;
  requestedAction: string | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateIssueReportFieldsAction.bind(null, issueId),
    null,
  );
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div>
        <label htmlFor={`cat-${issueId}`} className="mb-1 block text-sm font-medium text-gray-700">تصنيف الصيانة</label>
        <select
          id={`cat-${issueId}`}
          name="category"
          defaultValue={category ?? ""}
          className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
        >
          <option value="">— {MAINTENANCE_FIELD_UNSET} —</option>
          {MAINTENANCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <TextArea label="أثر السلامة" name="safetyImpact" rows={2} defaultValue={safetyImpact ?? ""} />
      <TextArea label="الأثر التشغيلي" name="operationalImpact" rows={2} defaultValue={operationalImpact ?? ""} />
      <TextArea label="الإجراء المطلوب" name="requestedAction" rows={2} defaultValue={requestedAction ?? ""} />
      <p className="text-xs text-gray-400">كل الحقول اختيارية — تظهر في تقرير الصيانة الرسمي، والفارغ منها يُعرض «{MAINTENANCE_FIELD_UNSET}».</p>
      <SubmitButton variant="secondary">حفظ بيانات التقرير</SubmitButton>
    </form>
  );
}

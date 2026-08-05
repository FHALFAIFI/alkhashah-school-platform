"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import {
  approveProgramAction, reopenProgramAction, createChangeRequestAction, decideChangeRequestAction,
  approvePackageAction, updateProgramExecutionAction,
  archiveProgramAction, unarchiveProgramAction,
  closeProgramAction, reopenClosedProgramAction,
  completeProgramAction, resumeProgramAction, updateProgramAction,
  type ActionState,
} from "../actions";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";
import { FOLLOWUP_STATUSES } from "@/lib/plan/followup";

export function ApproveProgramButton({ programId }: { programId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div>
      {error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveProgramAction(programId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد
      </button>
    </div>
  );
}

/**
 * إدخال تقدم البرنامج وحالة تنفيذه مباشرةً — البرنامج نفسه وحدة التنفيذ (D-024).
 * v2.4.1 §1.6: متاح في كل الحالات؛ `reasonRequired` يعني أن قيمة البرنامج مستقرة
 * تاريخياً (مكتمل/مغلق/سنة مقفلة) فيلزم سبب مكتوب يدخل «سجل التغييرات».
 */
export function ProgramExecutionForm({
  programId,
  progress,
  executionStatus,
  reasonRequired = false,
}: {
  programId: string;
  progress: number;
  executionStatus: string;
  reasonRequired?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateProgramExecutionAction.bind(null, programId), null);
  useRefreshOnSuccess(state);
  const currentStatus = (FOLLOWUP_STATUSES as readonly string[]).includes(executionStatus) ? executionStatus : "في المسار";
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div className="basis-40">
        <label htmlFor={`prog-${programId}`} className="mb-1 block text-xs text-gray-500">نسبة الإنجاز (٪)</label>
        <input
          id={`prog-${programId}`}
          name="progress"
          type="number"
          min={0}
          max={100}
          defaultValue={progress}
          className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="basis-40">
        <label htmlFor={`st-${programId}`} className="mb-1 block text-xs text-gray-500">حالة التنفيذ</label>
        <select
          id={`st-${programId}`}
          name="executionStatus"
          defaultValue={currentStatus}
          className="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {FOLLOWUP_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {reasonRequired && (
        <div className="basis-full sm:basis-64">
          <label htmlFor={`rsn-${programId}`} className="mb-1 block text-xs text-gray-500">
            سبب التعديل (إلزامي — البرنامج مكتمل أو مغلق)
          </label>
          <input
            id={`rsn-${programId}`}
            name="reason"
            className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      )}
      <SubmitButton variant="secondary">حفظ التقدم والحالة</SubmitButton>
    </form>
  );
}

export function ReopenForm({ programId }: { programId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await reopenProgramAction(programId, fd);
          if (res?.error) setError(res.error);
        })
      }
      className="space-y-2"
    >
      {error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <input
        name="reason"
        required
        placeholder="سبب إعادة الفتح (إلزامي)"
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <button disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50">
        إعادة فتح بسبب موثق
      </button>
    </form>
  );
}

const FIELD_OPTIONS = [
  { value: "name", label: "اسم البرنامج" },
  { value: "specificGoal", label: "الهدف الخاص" },
  { value: "mechanism", label: "آلية التنفيذ" },
  { value: "periodText", label: "فترة التنفيذ" },
  { value: "ownerPosition", label: "مسؤول التنفيذ" },
  { value: "participants", label: "المشاركون" },
  { value: "kpiText", label: "مؤشر النجاح" },
  { value: "targetText", label: "المستهدف" },
  { value: "deliverableText", label: "المخرج المطلوب" },
  { value: "evidenceText", label: "الشواهد" },
  { value: "expectedImpact", label: "الأثر المتوقع" },
];

export function ChangeRequestForm({ programId }: { programId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createChangeRequestAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const [field, setField] = useState(FIELD_OPTIONS[0].value);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-sand-50 p-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <div>
        <label className="block text-xs text-gray-500">الحقل</label>
        <select
          name="field"
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {FIELD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input type="hidden" name="fieldLabel" value={FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field} />
      </div>
      <div className="min-w-0 flex-1 basis-52">
        {/* حقل تجاري اختياري (v2.1 §H): يُسمح بقيمة فارغة لمسح الحقل عبر طلب تغيير موثق */}
        <label className="block text-xs text-gray-500">القيمة الجديدة</label>
        <input name="newValue" className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div className="min-w-0 flex-1 basis-52">
        <label className="block text-xs text-gray-500">السبب (إلزامي)</label>
        <input name="reason" required className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <SubmitButton variant="secondary">طلب تغيير</SubmitButton>
    </form>
  );
}

export function ChangeRequestDecision({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div className="mt-2 flex gap-2">
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { await decideChangeRequestAction(requestId, "معتمد"); })}
        className="rounded bg-brand-600 px-3 py-1 text-xs text-white"
      >
        اعتماد التغيير
      </button>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => { await decideChangeRequestAction(requestId, "مرفوض"); })}
        className="rounded border border-red-200 px-3 py-1 text-xs text-red-600"
      >
        رفض
      </button>
    </div>
  );
}

export function ApprovePackageButton({ deliverableId }: { deliverableId: string }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(async () => { await approvePackageAction(deliverableId); })}
      className="rounded bg-brand-600 px-3 py-1 text-xs text-white"
    >
      اعتماد الحزمة
    </button>
  );
}

/**
 * أرشفة البرنامج (حذف ناعم، v2.1 §A1): تأكيد عربي يسمّي البرنامج، وسبب اختياري.
 * عند وجود سجلات مرتبطة يوضّح التأكيد أن البرنامج سيُخفى مع الاحتفاظ بالسجلات التاريخية.
 * يستخدم SubmitButton (confirmText) لمنع الإرسال المزدوج بالخطأ.
 */
export function ArchiveProgramForm({
  programId, programName, hasLinkedData,
}: {
  programId: string;
  programName: string;
  hasLinkedData: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(archiveProgramAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  const confirmText =
    (hasLinkedData
      ? "هذا البرنامج مرتبط بسجلات أخرى. سيتم إخفاؤه من الاستخدام مع الاحتفاظ بالسجلات التاريخية.\n\n"
      : "") + `هل أنت متأكد من حذف هذا البرنامج؟\n«${programName}»`;
  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <p className="text-xs text-gray-500">
        {hasLinkedData
          ? "هذا البرنامج مرتبط بسجلات أخرى. الأرشفة تخفيه من الاستخدام مع الاحتفاظ بكل سجلاته التاريخية، ويمكن استرجاعه لاحقاً."
          : "الأرشفة تخفي البرنامج من القوائم والتقارير، ويمكن استرجاعه لاحقاً."}
      </p>
      <input
        name="reason"
        placeholder="سبب الأرشفة (اختياري)"
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton variant="danger" confirmText={confirmText}>أرشفة البرنامج</SubmitButton>
    </form>
  );
}

/**
 * «تعليم البرنامج كمكتمل» (سير العمل ثلاثي الحالات §A) — متاح لبرنامج «قيد التنفيذ».
 * لا شرط شواهد ولا مالية ولا أنشطة؛ ملاحظة الاكتمال اختيارية، والبرنامج يبقى قابلاً للتحرير.
 */
export function CompleteProgramForm({ programId, programName }: { programId: string; programName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(completeProgramAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <p className="text-xs text-gray-500">
        الاكتمال قرارك المباشر — لا يشترط عدد شواهد ولا اكتمال ميزانية ولا أي حقل. يبقى البرنامج
        بعد اكتماله قابلاً للتحرير وإضافة الشواهد والوثائق، ويظهر في عروض البرامج المكتملة.
      </p>
      <input
        name="note"
        placeholder="ملاحظة الاكتمال (اختيارية)"
        maxLength={2000}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton confirmText={`هل تريد تعليم هذا البرنامج كمكتمل؟\n«${programName}»\n\nيبقى قابلاً للتحرير وإضافة الشواهد، ويمكن إعادته للتنفيذ في أي وقت.`}>
        تعليم البرنامج كمكتمل
      </SubmitButton>
    </form>
  );
}

/** «إعادة البرنامج للتنفيذ» — من «مكتمل» إلى «قيد التنفيذ» مع بقاء تاريخ الاكتمال في السجل */
export function ResumeProgramForm({ programId, programName }: { programId: string; programName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(resumeProgramAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <input
        name="note"
        placeholder="سبب الإعادة للتنفيذ (اختياري)"
        maxLength={2000}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton variant="secondary" confirmText={`هل تريد إعادة هذا البرنامج للتنفيذ؟\n«${programName}»\n\nيعود إلى «قيد التنفيذ» ويبقى تاريخ اكتماله السابق محفوظاً في السجل.`}>
        إعادة البرنامج للتنفيذ
      </SubmitButton>
    </form>
  );
}

/**
 * «إقفال البرنامج نهائياً» (v2.2 §A2 + §B) — متاح للبرامج «المكتملة» فقط.
 *
 * حالة عمل مستقلة عن الأرشفة (حذف ناعم) وعن الاعتماد وعن إقفال السنة. لا يشترط شاهداً ولا
 * نشاطاً ولا نسبة جاهزية ولا اكتمال ميزانية ولا نتائج — وملاحظة الإقفال اختيارية. يبقى
 * السجل كاملاً في التقارير والعروض التاريخية.
 */
export function CloseProgramForm({ programId, programName }: { programId: string; programName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(closeProgramAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <p className="text-xs text-gray-500">
        الإقفال النهائي يجعل البرنامج <span className="font-medium">للقراءة فقط</span> ويرفعه من
        القوائم التشغيلية. يبقى كاملاً في التقارير والعروض التاريخية بكل شواهده ووثائقه ومراجعه
        المالية، ويبقى متاحاً للعرض والطباعة والتصدير. يمكن إعادة فتحه لاحقاً.
      </p>
      <input
        name="note"
        placeholder="ملاحظة الإقفال (اختيارية)"
        maxLength={2000}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton confirmText={`هل تريد إقفال هذا البرنامج نهائياً؟\n«${programName}»\n\nيصبح البرنامج للقراءة فقط: لا تعديل ولا متابعة حتى يُعاد فتحه. يبقى كاملاً في التقارير والعروض التاريخية ويبقى متاحاً للعرض والطباعة والتصدير.`}>
        إقفال البرنامج نهائياً
      </SubmitButton>
    </form>
  );
}

/** «إعادة فتح البرنامج» — يعيد برنامجاً مغلقاً إلى حالة «مكتمل» (لا إلى قيد التنفيذ تلقائياً) */
export function ReopenClosedProgramForm({ programId, programName }: { programId: string; programName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(reopenClosedProgramAction.bind(null, programId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <p className="text-xs text-gray-500">
        إعادة الفتح تعيد البرنامج بحالة «مكتمل» ويعود قابلاً للتحرير — ولا يعود «قيد التنفيذ»
        تلقائياً. سجل الإقفال السابق يبقى محفوظاً كاملاً.
      </p>
      <input
        name="note"
        placeholder="سبب إعادة الفتح (اختياري)"
        maxLength={2000}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton variant="secondary" confirmText={`هل تريد إعادة فتح هذا البرنامج؟\n«${programName}»\n\nيعود بحالة «مكتمل» ويعود قابلاً للتحرير، ويبقى سجل إقفاله السابق محفوظاً.`}>
        إعادة فتح البرنامج
      </SubmitButton>
    </form>
  );
}

/** استرجاع برنامج مؤرشف — يعيده للاستخدام والقوائم التشغيلية */
export function UnarchiveProgramButton({ programId }: { programId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div className="space-y-2">
      {error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await unarchiveProgramAction(programId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg border border-emerald-300 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
      >
        استرجاع
      </button>
    </div>
  );
}

/**
 * v2.4.1 §1.6: «تعديل البرنامج» — متاح في كل حالات دورة الحياة.
 *
 * التحذير يظهر ولا يمنع، والسبب يصبح إلزامياً بعد الاعتماد أو الاكتمال أو الإقفال،
 * وكل حقل يتغيّر يُقيَّد في «سجل التغييرات» بقيمته السابقة والجديدة. الحالة والاعتماد
 * لا يتغيّران بالتعديل إطلاقاً.
 *
 * ── لماذا الحقول **محكومة** بحالة React لا `defaultValue` ────────────────────
 * React 19 يعيد ضبط النموذج غير المحكوم تلقائياً بعد اكتمال `action`، **حتى حين تعيد
 * النتيجة خطأً**. مع سبب إلزامي بعد الاعتماد يعني ذلك أن أول حفظ بلا سبب يمسح كل ما
 * كتبه المدير في خمسة وعشرين حقلاً ويعيدها لقيمها الأصلية بصمت — ثم يبدو الحفظ الثاني
 * وكأنه «لا تغييرات لحفظها». اكتُشف في متصفح حقيقي لا في اختبار وحدة.
 * الحقول المحكومة تُبقي المُدخَل عبر الأخطاء، ويُزامَن من الخادم عند النجاح فقط.
 */
export function EditProgramForm({
  programId,
  values,
  warnings,
  reasonRequired,
  updatedToken,
  initiallyOpen = false,
}: {
  programId: string;
  values: { key: string; label: string; value: string | null; multiline: boolean }[];
  warnings: string[];
  reasonRequired: boolean;
  updatedToken: string;
  /** v2.5.0 §5.1: يصل المستخدم من رابط «تعديل البرنامج» فيجد النموذج مفتوحاً */
  initiallyOpen?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateProgramAction.bind(null, programId), null);
  useRefreshOnSuccess(state);
  const [open, setOpen] = useState(initiallyOpen);

  const serverValues = useMemo(
    () => Object.fromEntries(values.map((f) => [f.key, f.value ?? ""])) as Record<string, string>,
    [values],
  );
  const [draft, setDraft] = useState<Record<string, string>>(serverValues);
  const [reason, setReason] = useState("");
  // بعد نجاح الحفظ تصير قيم الخادم هي المرجع — نُزامن المسودة معها مرة واحدة لكل نجاح
  const [syncedAt, setSyncedAt] = useState<unknown>(null);
  if (state?.success && state !== syncedAt) {
    setSyncedAt(state);
    setDraft(serverValues);
    setReason("");
  }

  const set = (key: string, v: string) => setDraft((prev) => ({ ...prev, [key]: v }));
  const inputClass =
    "min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0"
      >
        {open ? "إغلاق التعديل" : "تعديل البرنامج"}
      </button>
      {open && (
        <form action={formAction} className="mt-3 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}

          {/* تحذير معلوماتي — التعديل مسموح ولا يتوقف عليه */}
          {warnings.map((w) => (
            <p key={w} role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              {w}
            </p>
          ))}

          <input type="hidden" name="updatedToken" value={updatedToken} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {values.map((f) => (
              <div key={f.key} className={f.multiline ? "sm:col-span-2" : undefined}>
                <label htmlFor={`field_${f.key}`} className="mb-1 block text-sm font-medium text-gray-700">
                  {f.label}
                </label>
                {f.multiline ? (
                  <textarea
                    id={`field_${f.key}`}
                    name={`field_${f.key}`}
                    rows={2}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                ) : (
                  <input
                    id={`field_${f.key}`}
                    name={`field_${f.key}`}
                    value={draft[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    autoComplete="off"
                    data-1p-ignore=""
                    data-lpignore="true"
                    className={inputClass}
                  />
                )}
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="edit-reason" className="mb-1 block text-sm font-medium text-gray-700">
              {reasonRequired ? "سبب التعديل (إلزامي — يُحفظ في سجل التغييرات)" : "سبب التعديل (اختياري)"}
            </label>
            <textarea
              id="edit-reason"
              name="reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <SubmitButton>حفظ التعديل</SubmitButton>
        </form>
      )}
    </div>
  );
}

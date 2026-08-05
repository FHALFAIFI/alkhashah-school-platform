"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createModelAction, addIndicatorAction, deleteIndicatorAction, approveModelAction, reopenModelAction,
  archiveModelAction, restoreModelAction, deleteModelAction,
  type ActionState,
} from "../actions";
import { Field, SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess, useRefreshAfterTransition } from "@/components/form-reset";
import { PermanentDeletePanel } from "@/components/permanent-delete";
import type { DeletionImpact } from "@/lib/lifecycle-delete";

export function NewModelForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createModelAction, null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      <div className="min-w-64 flex-1">
        <Field label="اسم النموذج" name="nameAr" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">الفئة</label>
        <select name="audience" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="موظف">موظف — مصمم داخلياً</option>
          <option value="معلم">معلم — للنماذج الرسمية</option>
        </select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="official" />
        نموذج رسمي (منقول نصياً من ملف الوزارة بعد فحص بصري)
      </label>
      <SubmitButton>إنشاء</SubmitButton>
    </form>
  );
}

export function IndicatorForm({ modelId }: { modelId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(addIndicatorAction.bind(null, modelId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-sand-100 pt-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-64 flex-1">
        <Field label="مؤشر جديد" name="nameAr" />
      </div>
      <div className="w-28">
        <Field label="الوزن ٪" name="weight" type="number" required />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="requiresEvidence" defaultChecked />
        يتطلب شواهد
      </label>
      <SubmitButton variant="secondary">إضافة مؤشر</SubmitButton>
    </form>
  );
}

export function DeleteIndicatorButton({ indicatorId }: { indicatorId: string }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => deleteIndicatorAction(indicatorId))}
      className="text-xs text-red-500 hover:underline"
    >
      حذف
    </button>
  );
}

export function ApproveModelButton({ modelId, disabled, total }: { modelId: string; disabled: boolean; total: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div className="text-end">
      {error && <div role="alert" className="mb-1 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveModelAction(modelId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        اعتماد النموذج
      </button>
      {disabled && <p className="mt-1 text-xs text-amber-600">مجموع الأوزان {total}٪ — يجب 100٪ تماماً</p>}
    </div>
  );
}

/** أرشفة النموذج — المسار الافتراضي للنموذج المستخدم؛ لا تمس التقييمات التاريخية (v2.4 §6) */
export function ArchiveModelForm({ modelId, modelName }: { modelId: string; modelName: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(archiveModelAction.bind(null, modelId), null);
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(state);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="w-full rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
      <input
        name="reason"
        placeholder="سبب الأرشفة (اختياري)"
        className="min-w-52 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
      />
      <SubmitButton
        variant="secondary"
        confirmText={`هل تريد أرشفة نموذج «${modelName}»؟ يختفي النموذج من اختيار الدورات الجديدة وتبقى كل تقييماته وتقاريره التاريخية سليمة، ويمكن استعادته لاحقاً.`}
      >
        أرشفة النموذج
      </SubmitButton>
    </form>
  );
}

export function RestoreModelButton({ modelId }: { modelId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <div className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await restoreModelAction(modelId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800 hover:bg-brand-50 disabled:opacity-50"
      >
        استعادة النموذج
      </button>
    </div>
  );
}

/**
 * حذف نموذج التقييم نهائياً (v2.5.0 §8.1).
 *
 * كان الحذف قبل هذا الإصدار `window.confirm` واحداً بلا اسم مكتوب ولا سبب ولا شاهد،
 * وبلا معاينة لما سيُحذف. صار يمرّ بلوحة الحذف النهائي نفسها المستعملة للموظف ولدورة
 * الأداء: معاينة الأثر، ثم الاسم حرفياً، ثم السبب الإلزامي، ثم إقرار صريح (§8.4، §12.9).
 */
export function DeleteModelPanel({
  modelId,
  impact,
}: {
  modelId: string;
  impact: DeletionImpact;
}) {
  return (
    <PermanentDeletePanel
      action={deleteModelAction.bind(null, modelId)}
      impact={impact}
      heading="حذف نموذج التقييم نهائياً"
      cta="حذف النموذج نهائياً"
      confirmFieldLabel="اسم النموذج"
      intro="يمحو النموذج ومعاييره. لا يُتاح إلا لنموذج لا ترتبط به أي دورة تقييم — الدورة سجل الموظف لا سجل النموذج، وحذفها بقرار عن قالب غير مقبول. للنموذج المستخدم: «أرشفة النموذج» تُبقي كل التقييمات والتقارير التاريخية سليمة."
    />
  );
}

export function ReopenModelForm({ modelId }: { modelId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await reopenModelAction(modelId, fd);
          if (res?.error) setError(res.error);
        })
      }
      className="flex items-center gap-2"
    >
      {error && <span className="text-xs text-red-600">{error}</span>}
      <input name="reason" required placeholder="سبب إعادة الفتح (إلزامي)" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <button disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50">
        إعادة فتح
      </button>
    </form>
  );
}

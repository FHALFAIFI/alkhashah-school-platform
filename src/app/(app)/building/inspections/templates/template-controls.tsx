"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activateTemplateAction,
  deactivateTemplateAction,
  duplicateTemplateAction,
  deleteTemplateDraftAction,
} from "../../template-actions";

function ActionButton({
  onRun,
  children,
  variant = "secondary",
  confirm,
}: {
  onRun: () => Promise<{ error?: string; success?: string; newId?: string } | null>;
  children: React.ReactNode;
  variant?: "primary" | "danger" | "secondary";
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const cls =
    variant === "primary"
      ? "bg-brand-600 text-white hover:bg-brand-700"
      : variant === "danger"
        ? "border border-red-300 text-red-700 hover:bg-red-50"
        : "border border-sand-200 bg-white text-gray-700 hover:bg-sand-100";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await onRun();
          if (res?.error) window.alert(res.error);
          if (res?.newId) router.push(`/building/inspections/templates/${res.newId}`);
          else router.refresh();
        });
      }}
      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${cls}`}
    >
      {pending && <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function ActivateButton({ templateId }: { templateId: string }) {
  return (
    <ActionButton variant="primary" onRun={() => activateTemplateAction(templateId)} confirm="تفعيل هذا الإصدار؟ سيصبح القالب المستخدَم للفحص.">
      تفعيل
    </ActionButton>
  );
}
export function DeactivateButton({ templateId }: { templateId: string }) {
  return (
    <ActionButton onRun={() => deactivateTemplateAction(templateId)} confirm="إلغاء تفعيل هذا القالب؟">
      إلغاء التفعيل
    </ActionButton>
  );
}
export function DuplicateButton({ templateId }: { templateId: string }) {
  return <ActionButton onRun={() => duplicateTemplateAction(templateId)}>تكرار القالب</ActionButton>;
}
export function DeleteDraftButton({ templateId }: { templateId: string }) {
  return (
    <ActionButton variant="danger" onRun={() => deleteTemplateDraftAction(templateId)} confirm="حذف هذه المسودة نهائياً؟">
      حذف المسودة
    </ActionButton>
  );
}
export function NewVersionButton({ templateId }: { templateId: string }) {
  // «إصدار جديد» = فتح المحرر على نسخة قابلة للتحرير؛ الحفظ سينشئ الإصدار الجديد فعلياً
  return (
    <a
      href={`/building/inspections/templates/${templateId}/edit`}
      className="inline-flex min-h-9 items-center rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-800"
    >
      إصدار جديد
    </a>
  );
}

"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui";
import { useRefreshOnSuccess } from "@/components/form-reset";
import { duplicateTemplateAction, deleteTemplateAction, type ActionState } from "../builder/actions";

/**
 * نسخ القالب وحذفه (v2.5.0 §4.5).
 *
 * الحذف يطلب تأكيداً صريحاً واحداً — لا اسماً مكتوباً ولا سبباً إلزامياً. هذا مقصود:
 * ضوابط §12.9 الثقيلة للحذف الذي لا رجعة فيه، وحذف القالب ليس منه — لا يمحو بياناً ولا
 * وثيقةً صادرة، وإعادة بنائه دقيقة واحدة. تحميله بضوابط الحذف النهائي يُفقد تلك الضوابط
 * معناها حين تُطلب في موضعها الصحيح.
 */
export function TemplateRowActions({
  templateId,
  name,
  canEdit,
}: {
  templateId: string;
  name: string;
  canEdit: boolean;
}) {
  const [dupState, dupAction] = useActionState<ActionState, FormData>(
    duplicateTemplateAction.bind(null, templateId),
    null,
  );
  // D-053: الإجراء لا يُبطل أي مسار — التحديث من العميل بعد استقرار النتيجة
  useRefreshOnSuccess(dupState);
  const [delState, delAction] = useActionState<ActionState, FormData>(
    deleteTemplateAction.bind(null, templateId),
    null,
  );
  useRefreshOnSuccess(delState);

  const error = dupState?.error ?? delState?.error;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      <form action={dupAction}>
        <SubmitButton variant="secondary">نسخ</SubmitButton>
      </form>
      {canEdit && (
        <form action={delAction}>
          <input type="hidden" name="confirm" value="1" />
          <SubmitButton
            variant="danger"
            confirmText={`حذف القالب «${name}»؟ لا يُحذف معه أي تقرير صادر ولا أي بيانات.`}
          >
            حذف
          </SubmitButton>
        </form>
      )}
    </span>
  );
}

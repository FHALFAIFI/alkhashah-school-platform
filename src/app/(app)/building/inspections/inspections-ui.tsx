"use client";

import { useState } from "react";
import { approveInspectionTemplateAction } from "../actions";
import { SubmitButton } from "@/components/ui";

export function ApproveTemplateButton({ templateId }: { templateId: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={async () => {
        setError(null);
        const res = await approveInspectionTemplateAction(templateId);
        if (res?.error) setError(res.error);
      }}
      className="flex items-center gap-2"
    >
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
      <SubmitButton variant="secondary" confirmText="اعتماد القالب؟ بعد الاعتماد يصبح متاحاً للفحص الميداني.">
        اعتماد
      </SubmitButton>
    </form>
  );
}

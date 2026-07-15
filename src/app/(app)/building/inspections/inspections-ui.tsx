"use client";

import { useState, useTransition } from "react";
import { approveInspectionTemplateAction } from "../actions";

export function ApproveTemplateButton({ templateId }: { templateId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      {error && <span className="me-2 text-xs text-red-600">{error}</span>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await approveInspectionTemplateAction(templateId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded bg-brand-600 px-3 py-1 text-xs text-white disabled:opacity-50"
      >
        اعتماد
      </button>
    </div>
  );
}

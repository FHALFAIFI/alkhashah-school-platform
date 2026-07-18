"use client";

import { useState, useTransition } from "react";
import { toggleTemplateActiveAction } from "../actions";

/**
 * تفعيل/تعطيل قالب رسمي — لا حذف. زر واحد يقلب الحالة، ويعرض خطأ الخادم إن وُجد.
 */
export function TemplateActiveToggle({ templateId, active }: { templateId: string; active: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"}`}>
        {active ? "مُفعَّل" : "مُعطَّل"}
      </span>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await toggleTemplateActiveAction(templateId, !active);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg border border-sand-200 px-3 py-1 text-xs hover:bg-sand-100 disabled:opacity-50"
      >
        {active ? "تعطيل القالب" : "تفعيل القالب"}
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

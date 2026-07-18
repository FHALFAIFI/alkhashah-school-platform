"use client";

import { useState, useTransition } from "react";
import { rollbackGeometryAction } from "../../actions";

/** تراجع موثق إلى نسخة سابقة — يطلب سبباً إلزامياً ثم يُنشئ مسودة جديدة منها. */
export function RollbackButton({ versionId, version }: { versionId: string; version: number }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        onClick={() => {
          const reason = window.prompt(`سبب التراجع إلى النسخة ${version} (إلزامي — يُوثَّق):`);
          if (!reason) return;
          startTransition(async () => {
            setMsg(null);
            const r = await rollbackGeometryAction(versionId, reason);
            setMsg(r?.error ?? r?.success ?? null);
          });
        }}
        className="rounded border border-amber-300 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-50"
      >
        تراجع إلى هذه النسخة
      </button>
      {msg && <span className="ms-1 text-xs text-gray-600">{msg}</span>}
    </span>
  );
}

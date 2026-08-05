"use client";

import { useState, useTransition } from "react";
import { rollbackGeometryAction, publishGeometryAction } from "../../actions";
import { useRefreshAfterTransition } from "@/components/form-reset";

/** نشر نسخة مسودة بعد تأكيد صريح — لا يستبدل النسخ السابقة (تُؤرشف المنشورة السابقة). */
export function PublishButton({ versionId, version }: { versionId: string; version: number }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span>
      <button
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`نشر النسخة ${version}؟ ستصبح المخطط المعتمد وتُزامَن الغرف (لا حذف للنسخ السابقة).`)) return;
          startTransition(async () => {
            setMsg(null);
            const r = await publishGeometryAction(versionId);
            setMsg(r?.error ?? r?.success ?? null);
            // D-053: التحديث بعد انتهاء الانتقال لا داخله (useRefreshAfterTransition)
          });
        }}
        className="rounded border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
      >
        نشر هذه النسخة
      </button>
      {msg && <span className="ms-1 text-xs text-gray-600">{msg}</span>}
    </span>
  );
}

/** تراجع موثق إلى نسخة سابقة — يطلب سبباً إلزامياً ثم يُنشئ مسودة جديدة منها. */
export function RollbackButton({ versionId, version }: { versionId: string; version: number }) {
  const [pending, startTransition] = useTransition();
  // D-053: التحديث بعد اكتمال الانتقال — الإجراء لم يعد يُبطل أي مسار
  useRefreshAfterTransition(pending);
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

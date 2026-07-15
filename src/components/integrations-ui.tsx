"use client";

import { useState, useTransition } from "react";
import { aiMeetingSummaryAction, emailDocumentAction, type AiState, type EmailState } from "@/app/(app)/integrations-actions";

/** لوحة المساعد الذكي — تظهر فقط عند تفعيل الذكاء الاصطناعي؛ مخرجاتها مسودات للمراجعة البشرية */
export function AiMeetingAssistant({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<AiState>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
      <h2 className="mb-2 font-bold text-purple-900">المساعد الذكي (محلي)</h2>
      <p className="mb-2 text-xs text-purple-800">
        يولد مسودة تلخيص ومقترح قرارات وتوصيات من المناقشات — مسودة للمراجعة تنسخها بنفسك، ولا يكتب المساعد في أي سجل رسمي.
      </p>
      <button
        disabled={pending}
        onClick={() => startTransition(async () => setState(await aiMeetingSummaryAction(meetingId)))}
        className="rounded-lg bg-purple-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? "جارٍ التوليد…" : "توليد مسودة تلخيص"}
      </button>
      {state?.error && <div role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      {state?.draft && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-purple-200 bg-white p-3 text-sm">{state.draft}</div>
      )}
    </div>
  );
}

/** إرسال وثيقة بالبريد: مسودة M365 عند التفعيل، وإلا بديل يدوي واضح */
export function EmailDocumentButton({ docId, docNumber, pdfFileId }: { docId: string; docNumber: string; pdfFileId: string | null }) {
  const [state, setState] = useState<EmailState>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-brand-700 underline">
        بريد
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-sand-200 bg-sand-50 p-2 text-start">
      <form
        action={(fd) => startTransition(async () => setState(await emailDocumentAction(docId, fd)))}
        className="flex items-center gap-1"
      >
        <input name="to" type="email" dir="ltr" placeholder="بريد المستلم (اختياري)" className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
        <button disabled={pending} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">إنشاء مسودة</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400">×</button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      {state?.webLink && (
        <p className="mt-1 text-xs text-emerald-700">
          أنشئت المسودة — <a href={state.webLink} target="_blank" rel="noopener noreferrer" className="underline">افتحها للمراجعة والإرسال</a>. لا يرسل النظام البريد نهائياً بالنيابة عنك.
        </p>
      )}
      {state?.fallback && (
        <p className="mt-1 text-xs text-amber-700">
          تكامل البريد غير مفعل — البديل: {pdfFileId && (
            <a href={`/api/files/${pdfFileId}`} className="underline">نزل PDF</a>
          )}{" "}
          ثم <a href={`mailto:?subject=${encodeURIComponent(docNumber)}`} className="underline">افتح مسودة بريد</a> وأرفق الملف يدوياً.
        </p>
      )}
    </div>
  );
}

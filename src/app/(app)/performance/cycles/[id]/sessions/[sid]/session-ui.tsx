"use client";

import { useActionState, useState, useTransition } from "react";
import {
  saveRatingsAction, uploadSignedReportAction, completeSessionAction, reopenSessionAction,
  type ActionState,
} from "../../../../actions";
import { Field, TextArea, SubmitButton } from "@/components/ui";
import { orFallback } from "@/lib/format";

type IndicatorRow = {
  id: string;
  nameAr: string;
  weight: number;
  requiresEvidence: boolean;
  rating: number | null;
  note: string;
  evidenceCount: number;
};

export function RatingsForm({
  sessionId,
  editable,
  indicators,
  sessionFields,
}: {
  sessionId: string;
  editable: boolean;
  indicators: IndicatorRow[];
  sessionFields: {
    sessionDate: string;
    notes: string;
    strengths: string;
    improvementAreas: string;
    actionsText: string;
    nextFollowupDate: string;
  };
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveRatingsAction.bind(null, sessionId), null);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-sm text-emerald-700">{state.success}</div>}

      <div className="overflow-x-auto rounded-xl border border-sand-200">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-sand-200 bg-sand-100">
              <th className="px-3 py-2 text-start font-medium text-gray-600">م</th>
              <th className="px-3 py-2 text-start font-medium text-gray-600">المؤشر</th>
              <th className="px-3 py-2 text-start font-medium text-gray-600">الوزن</th>
              <th className="px-3 py-2 text-start font-medium text-gray-600">التقدير (1–5)</th>
              <th className="px-3 py-2 text-start font-medium text-gray-600">الدرجة الموزونة</th>
              <th className="px-3 py-2 text-start font-medium text-gray-600">الشواهد</th>
              <th className="px-3 py-2 text-start font-medium text-gray-600">ملاحظة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {indicators.map((ind, i) => (
              <IndicatorRowView key={ind.id} ind={ind} index={i} editable={editable} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="تاريخ الجلسة" name="sessionDate" type="date" defaultValue={sessionFields.sessionDate} />
        <Field label="موعد المتابعة القادمة" name="nextFollowupDate" type="date" defaultValue={sessionFields.nextFollowupDate} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextArea label="الملاحظات" name="notes" defaultValue={sessionFields.notes} rows={2} />
        <TextArea label="نقاط القوة" name="strengths" defaultValue={sessionFields.strengths} rows={2} />
        <TextArea label="فرص التحسين" name="improvementAreas" defaultValue={sessionFields.improvementAreas} rows={2} />
        <TextArea label="التوصيات" name="actionsText" defaultValue={sessionFields.actionsText} rows={2} />
      </div>
      {editable && <SubmitButton>حفظ التقديرات (تحسب النتيجة تلقائياً)</SubmitButton>}
    </form>
  );
}

function IndicatorRowView({ ind, index, editable }: { ind: IndicatorRow; index: number; editable: boolean }) {
  const [rating, setRating] = useState<string>(ind.rating === null ? "" : String(ind.rating));
  const numeric = rating === "" ? null : Number(rating);
  const weighted = numeric !== null && numeric >= 1 && numeric <= 5 ? ((numeric / 5) * ind.weight).toFixed(2) : "—";
  return (
    <tr>
      <td className="px-3 py-2 tabular-nums">{index + 1}</td>
      <td className="px-3 py-2">
        {orFallback(ind.nameAr)}
        {ind.requiresEvidence && <span className="ms-1 text-xs text-purple-600">(شواهد موصى بها)</span>}
      </td>
      <td className="px-3 py-2 tabular-nums">{ind.weight}٪</td>
      <td className="px-3 py-2">
        {editable ? (
          <select
            name={`rating_${ind.id}`}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">غير مقيم</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        ) : (
          <span className="tabular-nums">{ind.rating ?? "غير مقيم"}</span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-gray-500">{weighted}٪</td>
      <td className="px-3 py-2 text-xs tabular-nums">
        {ind.evidenceCount > 0 ? (
          <span className="text-emerald-600">{ind.evidenceCount} ✓</span>
        ) : ind.requiresEvidence ? (
          <span className="text-amber-600">0</span>
        ) : (
          "0"
        )}
      </td>
      <td className="px-3 py-2">
        {editable ? (
          <input name={`note_${ind.id}`} defaultValue={ind.note} className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
        ) : (
          <span className="text-xs">{ind.note}</span>
        )}
      </td>
    </tr>
  );
}

export function SignedReportUpload({ sessionId }: { sessionId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(uploadSignedReportAction.bind(null, sessionId), null);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state?.error && <div role="alert" className="w-full rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
      <div className="min-w-64 flex-1">
        <label className="mb-1 block text-sm font-medium text-gray-700">رفع التقرير الموقع</label>
        <input name="file" type="file" accept="application/pdf,image/*" className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
      </div>
      <SubmitButton variant="secondary">رفع</SubmitButton>
    </form>
  );
}

export function CompleteSessionButton({ sessionId, isFinal, disabled }: { sessionId: string; isFinal: boolean; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div>
      {error && <div role="alert" className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      <button
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await completeSessionAction(sessionId);
            if (res?.error) setError(res.error);
          })
        }
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {isFinal ? "اعتماد التقييم النهائي" : "اعتماد اكتمال الجلسة"}
      </button>
      {disabled && <p className="mt-1 text-xs text-amber-600">يتطلب إصدار التقرير أولاً</p>}
    </div>
  );
}

export function ReopenSessionForm({ sessionId }: { sessionId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await reopenSessionAction(sessionId, fd);
          if (res?.error) setError(res.error);
        })
      }
      className="flex flex-wrap items-center gap-2"
    >
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
      <input name="reason" required placeholder="سبب إعادة الفتح (إلزامي)" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      <button disabled={pending} className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50">
        إعادة فتح بسبب موثق
      </button>
    </form>
  );
}

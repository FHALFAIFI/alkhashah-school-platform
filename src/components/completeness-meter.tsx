import {
  COMPLETENESS_HINT,
  COMPLETENESS_LABEL,
  computeCompleteness,
  missingSentence,
  type CompletenessField,
} from "@/lib/completeness";

/**
 * مؤشّر اكتمال البيانات (v2.5.0 §13) — **معلوماتي بحت**.
 *
 * لا يمنع حفظاً ولا إجراءً، ولا يُصبغ حقلاً بالأحمر، ولا يُخزَّن. تسميته «اكتمال
 * البيانات» صراحةً حتى لا تُقرأ كحالة سير عمل أو كنسبة إنجاز (التكليف يمنع ذلك نصاً).
 *
 * يُسمّي النواقص بأسمائها بدل «توجد حقول ناقصة»: الجملة المبهمة تدفع المستخدم إلى فحص
 * النموذج كله، والاسم يدلّه على الحقل مباشرةً.
 */
export function CompletenessMeter({
  fields,
  className,
}: {
  fields: CompletenessField[];
  className?: string;
}) {
  const c = computeCompleteness(fields);
  const missing = missingSentence(c);
  const tone = c.percent === 100 ? "emerald" : c.missingCritical.length > 0 ? "amber" : "sand";

  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-sand-200 bg-sand-50 text-gray-700"
      } ${className ?? ""}`}
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {COMPLETENESS_LABEL}: <span className="tabular-nums">{c.percent}٪</span>{" "}
          <span className="font-normal text-gray-500">
            ({c.filled} من {c.total} حقلاً)
          </span>
        </span>
        {c.percent < 100 && <span className="text-gray-600">{COMPLETENESS_HINT}</span>}
      </div>

      {/* شريط بلا نص بديل مضلّل — القيمة مذكورة نصاً أعلاه */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white" aria-hidden>
        <div
          className={`h-full ${tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-brand-400"}`}
          style={{ width: `${c.percent}%` }}
        />
      </div>

      {missing && (
        <p className="mt-2">
          {c.missingCritical.length > 0 && (
            <span className="font-medium">حقول يؤثر غيابها في التقارير والتكامل: </span>
          )}
          <span className="text-gray-600">غير مُدخَل: {missing}</span>
        </p>
      )}
    </div>
  );
}

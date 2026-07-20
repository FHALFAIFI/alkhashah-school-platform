import { RESPONSE_TYPE_LABELS, type TemplateSection, type TemplateResponseType } from "@/lib/building/inspection-template-defs";

/** معاينة القالب — يعرض تماماً ما سيراه الفاحص (عناصر تحكم معطّلة). */
function ResponseControl({ type, ratingMax }: { type: TemplateResponseType; ratingMax?: number }) {
  switch (type) {
    case "yes_no":
      return <span className="text-xs text-gray-500">◯ نعم ◯ لا</span>;
    case "compliant":
      return <span className="text-xs text-gray-500">◯ مطابق ◯ غير مطابق</span>;
    case "numeric":
      return <input disabled placeholder="0" className="w-20 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs" />;
    case "rating":
      return <span className="text-xs text-gray-500">تقدير من {ratingMax ?? 5}</span>;
    case "text":
      return <input disabled placeholder="نص" className="w-40 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs" />;
    case "date":
      return <input disabled type="date" className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs" />;
    case "photo":
      return <span className="text-xs text-gray-500">📷 صورة</span>;
    case "attachment":
      return <span className="text-xs text-gray-500">📎 مرفق</span>;
  }
}

export function TemplatePreview({ sections }: { sections: TemplateSection[] }) {
  if (!sections || sections.length === 0) return <p className="text-sm text-gray-400">لا عناصر في هذا القالب.</p>;
  return (
    <div className="space-y-4">
      {sections.map((sec) => (
        <div key={sec.key} className="rounded-xl border border-sand-200 bg-white p-3">
          <h3 className="mb-1 font-bold text-brand-900">{sec.title}</h3>
          {sec.instructions && <p className="mb-2 text-xs text-gray-500">{sec.instructions}</p>}
          <ul className="space-y-2">
            {sec.items.map((it) => (
              <li key={it.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-sand-100 px-2 py-1.5 text-sm">
                <span className="min-w-40 flex-1">
                  {it.label}
                  {it.required && <span className="text-red-500"> *</span>}
                  {it.instructions && <span className="block text-xs text-gray-400">{it.instructions}</span>}
                </span>
                <ResponseControl type={it.responseType} ratingMax={it.ratingMax} />
                <span className="text-[10px] text-gray-400">{RESPONSE_TYPE_LABELS[it.responseType]}</span>
                {it.severityOnFail && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">خطورة: {it.severityOnFail}</span>}
                {it.correctiveActionRequired && <span className="rounded bg-red-100 px-1 text-[10px] text-red-700">إجراء تصحيحي</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

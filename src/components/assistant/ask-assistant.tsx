import Link from "next/link";

/** رابط سياقي «اسأل المساعد» — يفتح صفحة المساعد بسياق السجل الحالي */
export function AskAssistant({ type, id, label }: { type: string; id: string; label: string }) {
  const params = new URLSearchParams({ نوع: type, معرف: id, تسمية: label });
  return (
    <Link
      href={`/assistant?${params.toString()}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100 lg:min-h-0"
    >
      <span aria-hidden>✦</span>
      اسأل المساعد
    </Link>
  );
}

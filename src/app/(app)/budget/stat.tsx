import Link from "next/link";
import { Card } from "@/components/ui";

/** بطاقة مؤشر مالي — تدعم الربط العميق إلى التقرير أو صفحة التفصيل المقابلة */
export function Stat({
  label,
  value,
  tone = "plain",
  href,
  hint,
}: {
  label: string;
  value: string;
  tone?: "plain" | "good" | "bad" | "warn";
  href?: string;
  hint?: string;
}) {
  const toneCls =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-brand-900";
  const body = (
    <>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${toneCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
    </>
  );
  return (
    <Card className={href ? "transition hover:border-brand-300" : undefined}>
      {href ? <Link href={href} className="block">{body}</Link> : body}
    </Card>
  );
}

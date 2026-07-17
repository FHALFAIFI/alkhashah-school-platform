import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-brand-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-sand-200 bg-white p-4 ${className}`}>{children}</div>;
}

const badgeColors: Record<string, string> = {
  "مسودة": "bg-gray-100 text-gray-700",
  "معتمد": "bg-emerald-100 text-emerald-800",
  "معتمدة": "bg-emerald-100 text-emerald-800",
  "مقفل": "bg-slate-200 text-slate-700",
  "مقفلة": "bg-slate-200 text-slate-700",
  "مكتمل": "bg-emerald-100 text-emerald-800",
  "مكتملة": "bg-emerald-100 text-emerald-800",
  "قيد التنفيذ": "bg-blue-100 text-blue-800",
  "لم يبدأ": "bg-gray-100 text-gray-600",
  "متأخر": "bg-red-100 text-red-800",
  "جديدة": "bg-blue-50 text-blue-700",
  "ملغاة": "bg-gray-100 text-gray-500",
  "عالية": "bg-red-100 text-red-800",
  "متوسطة": "bg-amber-100 text-amber-800",
  "منخفضة": "bg-gray-100 text-gray-600",
  "معاينة": "bg-amber-100 text-amber-800",
  "جاهزة": "bg-blue-100 text-blue-800",
  "منفذة": "bg-emerald-100 text-emerald-800",
  "متراجع عنها": "bg-red-100 text-red-800",
  "يحتاج مراجعة": "bg-amber-100 text-amber-800",
  "جاهز": "bg-emerald-50 text-emerald-700",
  "مؤجل": "bg-indigo-100 text-indigo-800",
  "مستبعد": "bg-gray-100 text-gray-500",
  "منفذ": "bg-emerald-100 text-emerald-800",
  "غير مكتملة": "bg-gray-100 text-gray-600",
  "جاهزة للاعتماد": "bg-blue-100 text-blue-800",
  "قيد الاعتماد": "bg-amber-100 text-amber-800",
  "مرفوض": "bg-red-100 text-red-800",
  "بانتظار التوقيع": "bg-amber-100 text-amber-800",
  "بانتظار التقرير الموقع": "bg-amber-100 text-amber-800",
  "بانتظار الاعتماد الرسمي": "bg-purple-100 text-purple-800",
  "نشطة": "bg-emerald-100 text-emerald-800",
  "مفتوح": "bg-red-100 text-red-800",
  "قيد الإصلاح": "bg-amber-100 text-amber-800",
  "تم الإصلاح": "bg-blue-100 text-blue-800",
  "مغلق ومتحقق": "bg-emerald-100 text-emerald-800",
  "مؤرشفة": "bg-gray-100 text-gray-500",
  "منشورة": "bg-emerald-100 text-emerald-800",
  "إجازة": "bg-amber-100 text-amber-800",
  "معلم": "bg-brand-100 text-brand-800",
  "موظف": "bg-blue-100 text-blue-800",
  "غير معتمد": "bg-gray-100 text-gray-600",
  "خارج الخدمة": "bg-red-100 text-red-800",
  "تحتاج صيانة": "bg-amber-100 text-amber-800",
  "مؤرشف": "bg-gray-100 text-gray-500",
  "ممتازة": "bg-emerald-100 text-emerald-800",
  "جيدة": "bg-emerald-50 text-emerald-700",
  "بانتظار التأكيد": "bg-amber-100 text-amber-800",
  "ملغي": "bg-gray-100 text-gray-500",
  "لم يراجع": "bg-amber-50 text-amber-700",
  "مقبول": "bg-emerald-100 text-emerald-800",
};

export function Badge({ value }: { value: string }) {
  const cls = badgeColors[value] ?? "bg-gray-100 text-gray-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{value}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center">
      <p className="font-medium text-gray-600">{title}</p>
      {hint && <p className="mt-1 text-sm text-gray-400">{hint}</p>}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-sand-200 bg-sand-100 text-start">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2.5 text-start font-medium text-gray-600">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-100">{children}</tbody>
      </table>
    </div>
  );
}

export function DualDate({
  primary,
  secondary,
}: {
  primary: string;
  secondary?: string;
}) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="tabular-nums">{primary}</span>
      {secondary && <span className="text-xs text-gray-400 tabular-nums">{secondary}</span>}
    </span>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const cls =
    variant === "primary"
      ? "bg-brand-600 text-white hover:bg-brand-700"
      : "border border-sand-200 bg-white text-gray-700 hover:bg-sand-100";
  return (
    <Link href={href} className={`inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm font-medium transition lg:min-h-0 ${cls}`}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
  dir,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  dir?: "ltr" | "rtl";
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        dir={dir}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0"
      />
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  required,
  rows = 3,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  rows?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? undefined}
        required={required}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
    </div>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? undefined}
        required={required}
        className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export { SubmitButton } from "./submit-button";

/**
 * مؤشر مراحل سير العمل — يعرض المراحل المكتملة والحالية والمتبقية بالعربية.
 * `current` هو فهرس المرحلة الحالية (يبدأ من 0)؛ فهرس أكبر من آخر مرحلة يعني اكتمال الكل.
 */
export function WorkflowSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-xs" aria-label="مراحل سير العمل">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const circle =
          state === "done"
            ? "bg-emerald-500 text-white"
            : state === "current"
              ? "bg-brand-600 text-white ring-2 ring-brand-200"
              : "bg-sand-200 text-gray-500";
        const text =
          state === "done" ? "text-emerald-700" : state === "current" ? "font-bold text-brand-900" : "text-gray-400";
        return (
          <li key={label} className="flex items-center">
            <span className="flex items-center gap-1.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${circle}`} aria-hidden>
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={text} aria-current={state === "current" ? "step" : undefined}>{label}</span>
            </span>
            {i < steps.length - 1 && <span className="mx-2 h-px w-4 bg-sand-300 sm:w-6" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-full rounded-full ${v >= 100 ? "bg-emerald-500" : v > 0 ? "bg-brand-500" : "bg-sand-200"}`}
          style={{ width: `${v}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 tabular-nums">{v}٪</span>
    </div>
  );
}

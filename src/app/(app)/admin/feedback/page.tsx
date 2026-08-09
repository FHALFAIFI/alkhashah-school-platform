import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { listFeedback, type FeedbackFilters } from "@/lib/feedback/service";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_MODULES,
} from "@/lib/feedback/constants";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import { orFallback } from "@/lib/format";
import { FeedbackListActions } from "./list-actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

function parseDate(s: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? undefined : d;
}

export default async function FeedbackAdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("feedback.manage");
  const sp = await searchParams;

  const archived = (["all", "active", "archived"].includes(one(sp.archived)) ? one(sp.archived) : "active") as
    | "all"
    | "active"
    | "archived";
  const to = parseDate(one(sp.to));
  const filters: FeedbackFilters = {
    module: one(sp.module) || undefined,
    category: one(sp.category) || undefined,
    severity: one(sp.severity) || undefined,
    status: one(sp.status) || undefined,
    from: parseDate(one(sp.from)),
    // شامل ليوم النهاية: أضف يوماً كاملاً حتى نهايته
    to: to ? new Date(to.getTime() + 24 * 3600 * 1000 - 1) : undefined,
    archived,
  };

  const rows = await listFeedback(filters);

  // بناء رابط تصدير Excel محافظاً على المرشّحات الحالية
  const qs = new URLSearchParams();
  for (const k of ["module", "category", "severity", "status", "from", "to", "archived"] as const) {
    const v = one(sp[k]);
    if (v) qs.set(k, v);
  }
  const exportHref = `/api/export/feedback-xlsx${qs.toString() ? `?${qs}` : ""}`;

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "medium" }).format(d) +
    " · " +
    new Intl.DateTimeFormat("en-GB", { dateStyle: "short" }).format(d);

  return (
    <div>
      <PageHeader
        title="مركز ملاحظات التشغيل التجريبي"
        subtitle={`${rows.length} ملاحظة${archived === "archived" ? " مؤرشفة" : archived === "all" ? " (شاملة المؤرشفة)" : ""} — لا حذف نهائي؛ الأرشفة فقط بسبب موثق`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <SectionReportsLink category="usage" report="feedback-register" />
            <FeedbackListActions exportHref={exportHref} />
          </span>
        }
      />

      {/* المرشّحات — نموذج GET بسيط لا يظهر في الطباعة */}
      <Card className="no-print mb-4">
        <form method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect name="module" label="الوحدة" value={one(sp.module)} options={[...FEEDBACK_MODULES]} />
          <FilterSelect name="category" label="الفئة" value={one(sp.category)} options={[...FEEDBACK_CATEGORIES]} />
          <FilterSelect name="severity" label="الأهمية" value={one(sp.severity)} options={[...FEEDBACK_SEVERITIES]} />
          <FilterSelect name="status" label="الحالة" value={one(sp.status)} options={[...FEEDBACK_STATUSES]} />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">من تاريخ</label>
            <input type="date" name="from" defaultValue={one(sp.from)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">إلى تاريخ</label>
            <input type="date" name="to" defaultValue={one(sp.to)} className={inputCls} />
          </div>
          <FilterSelect
            name="archived"
            label="الأرشفة"
            value={archived === "active" ? "" : archived}
            options={[]}
            customOptions={[
              { value: "", label: "غير المؤرشفة" },
              { value: "archived", label: "المؤرشفة فقط" },
              { value: "all", label: "الكل" },
            ]}
          />
          <div className="flex items-end gap-2">
            <button type="submit" className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0 lg:py-2">
              تطبيق
            </button>
            <Link prefetch={false} href="/admin/feedback" className="min-h-11 rounded-lg border border-sand-200 px-4 py-2 text-sm text-gray-600 hover:bg-sand-100 lg:min-h-0">
              مسح
            </Link>
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="لا توجد ملاحظات مطابقة" hint="غيّر المرشّحات أو انتظر أول ملاحظة من التشغيل التجريبي." />
      ) : (
        <>
          {/* الجوال: بطاقات رأسية بلا تمرير أفقي */}
          <div className="space-y-3 lg:hidden">
            {rows.map((r) => (
              <Link prefetch={false}
                key={r.id}
                href={`/admin/feedback/${r.id}`}
                className="block rounded-xl border border-sand-200 bg-white p-4"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-bold tabular-nums text-brand-800" dir="ltr">{r.ref}</span>
                  <Badge value={r.status} />
                </div>
                <p className="mb-1 break-words font-medium text-brand-900">{orFallback(r.title)}</p>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge value={r.category} />
                  <Badge value={r.severity} />
                  {r.blocked && <Badge value="متأخر" />}
                  {r.archivedAt && <Badge value="مؤرشف" />}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {r.module} · {r.createdByName ?? "—"} · {fmtDate(r.createdAt)}
                </p>
              </Link>
            ))}
          </div>

          {/* سطح المكتب/الطباعة: جدول */}
          <div className="hidden lg:block print:block">
            <Table headers={["الرقم", "العنوان", "الوحدة", "الفئة", "الأهمية", "الحالة", "المُرسِل", "التاريخ", ""]}>
              {rows.map((r) => (
                <tr key={r.id} className={r.archivedAt ? "opacity-60" : ""}>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{r.ref}</td>
                  <td className="px-3 py-2">
                    {orFallback(r.title)}
                    {r.blocked && <span className="ms-1 text-xs text-red-600">(يعيق العمل)</span>}
                  </td>
                  <td className="px-3 py-2">{r.module}</td>
                  <td className="px-3 py-2"><Badge value={r.category} /></td>
                  <td className="px-3 py-2"><Badge value={r.severity} /></td>
                  <td className="px-3 py-2"><Badge value={r.status} /></td>
                  <td className="px-3 py-2">{r.createdByName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Link prefetch={false} href={`/admin/feedback/${r.id}`} className="text-brand-700 underline-offset-2 hover:underline">
                      فتح
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 lg:min-h-0";

function FilterSelect({
  name,
  label,
  value,
  options,
  customOptions,
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
  customOptions?: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <select name={name} defaultValue={value} className={`${inputCls} bg-white`}>
        {customOptions ? (
          customOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))
        ) : (
          <>
            <option value="">الكل</option>
            {options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </>
        )}
      </select>
    </div>
  );
}

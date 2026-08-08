import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Table, EmptyState, LinkButton, Badge, Field, Select, SubmitButton } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { searchInstances } from "@/lib/reports/instances/service";
import { INSTANCE_TYPES, instanceTypeByKey, INSTANCE_STATUSES } from "@/lib/reports/instances/types";
import { dualNumericCell } from "@/lib/dates";
import { orDash } from "@/lib/format";

export const metadata = { title: "أرشيف التقارير" };
export const dynamic = "force-dynamic";

/**
 * أرشيف التقارير المحفوظة (v2.6 §B).
 *
 * التقرير المحفوظ رابع الأنواع (§25): مسودة تُبنى وتُعدَّل، ثم تقرير نهائي برقم لا
 * يتكرر ولقطة لا تتغير بتغيّر البيانات، ثم مؤرشف يبقى محتواه كما اعتُمد. البحث يقرأ
 * العناوين والأرقام والأنواع والفترات — لا يفتّش داخل اللقطات.
 */
export default async function ReportArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("reports.read");
  const sp = await searchParams;
  const one = (key: string) => {
    const v = sp[key];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };

  const criteria = {
    search: one("search"),
    statuses: one("status") ? [one("status")!] : undefined,
    typeKeys: one("type") ? [one("type")!] : undefined,
    dateFrom: one("dateFrom"),
    dateTo: one("dateTo"),
    page: one("page") ? Number(one("page")) : 1,
  };
  const { rows, total, page, pageSize } = await searchInstances(criteria, user);
  const canBuild = user.permissions.has("reports.builder");

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const key of ["search", "status", "type", "dateFrom", "dateTo"]) {
      const v = one(key);
      if (v) params.set(key, v);
    }
    params.set("page", String(p));
    return `/reports/archive?${params.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports" label="عودة إلى مركز التقارير" />
      </div>
      <PageHeader
        title="أرشيف التقارير"
        subtitle="التقارير المحفوظة: مسودات تُبنى، وتقارير نهائية مرقّمة لا تتغير، وأرشيف يُبحث فيه"
        actions={
          canBuild ? (
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/reports/archive/new">تقرير جديد</LinkButton>
              <LinkButton href="/reports/archive/styles" variant="secondary">قوالب الإخراج</LinkButton>
            </div>
          ) : undefined
        }
      />

      <Card>
        <form method="get" action="/reports/archive" className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Field label="بحث بالعنوان أو الرقم" name="search" defaultValue={criteria.search ?? ""} />
          <Select
            label="الحالة"
            name="status"
            defaultValue={one("status") ?? ""}
            options={[{ value: "", label: "الكل" }, ...INSTANCE_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
          <Select
            label="النوع"
            name="type"
            defaultValue={one("type") ?? ""}
            options={[{ value: "", label: "الكل" }, ...INSTANCE_TYPES.map((t) => ({ value: t.key, label: t.labelAr }))]}
          />
          <Field label="من تاريخ" name="dateFrom" type="date" defaultValue={criteria.dateFrom ?? ""} />
          <Field label="إلى تاريخ" name="dateTo" type="date" defaultValue={criteria.dateTo ?? ""} />
          <div className="flex items-center gap-3 md:col-span-5">
            <SubmitButton>بحث</SubmitButton>
            <Link className="text-xs text-brand-700 underline" href="/reports/archive">
              مسح البحث
            </Link>
            <span className="text-xs text-gray-500">عدد النتائج: {total}</span>
          </div>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="لا تقارير محفوظة مطابقة"
            hint={canBuild ? "أنشئ أول تقرير من زر «تقرير جديد» أو من منشئ التقارير" : undefined}
          />
        ) : (
          <Table headers={["الرقم", "العنوان", "النوع", "الحالة", "الفترة", "أُنشئ في", "فتح"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{orDash(r.reportNumber)}</td>
                <td className="px-3 py-2 font-medium">{r.title}</td>
                <td className="px-3 py-2">{instanceTypeByKey(r.typeKey)?.labelAr ?? r.typeKey}</td>
                <td className="px-3 py-2">
                  <Badge value={r.status} />
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.periodFrom || r.periodTo
                    ? `${r.periodFrom ? dualNumericCell(r.periodFrom) : "…"} ← ${r.periodTo ? dualNumericCell(r.periodTo) : "…"}`
                    : "—"}
                </td>
                <td className="px-3 py-2 text-xs">{dualNumericCell(r.createdAt.toISOString().slice(0, 10))}</td>
                <td className="px-3 py-2">
                  <Link className="text-brand-700 underline" href={`/reports/archive/${r.id}`}>
                    فتح
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {pages > 1 ? (
          <div className="mt-3 flex items-center gap-2 text-xs">
            {page > 1 ? (
              <Link className="text-brand-700 underline" href={pageHref(page - 1)}>
                السابق
              </Link>
            ) : null}
            <span>
              صفحة {page} من {pages}
            </span>
            {page < pages ? (
              <Link className="text-brand-700 underline" href={pageHref(page + 1)}>
                التالي
              </Link>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

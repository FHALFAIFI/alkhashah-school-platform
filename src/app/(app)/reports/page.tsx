import Link from "next/link";
import { asc, eq, isNull } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { financialItems, people } from "@/db/schema";
import { PageHeader, Card, Table, EmptyState, LinkButton, Badge } from "@/components/ui";
import { formatMoney, orDash, orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import {
  REPORT_CATEGORIES,
  categoryByKey,
  reportsInCategory,
  isSortableColumn,
  type CategoryKey,
  type ReportColumn,
  type ReportFilters,
} from "@/lib/reports/catalog";
import { runReport } from "@/lib/reports/loaders";
import { clampPage, clampPageSize } from "@/lib/reports/export-safety";
import { ReportFilterBar } from "./report-filters";
import { Tutorial } from "@/components/tutorial";

export const metadata = { title: "مركز التقارير" };
export const dynamic = "force-dynamic";

/**
 * مركز التقارير المركزي (v2.2 §D).
 *
 * محرّك واحد لكل الأقسام: الفئة والتقرير والمرشّحات كلها في عنوان URL، فكل عرض رابط عميق
 * قابل للمشاركة، وزر «تقارير القسم» في أي قسم يفتح فئته مباشرةً بمرشّحاتها.
 *
 * التفويض على حدود الخادم: تُفحص صلاحية الفئة وصلاحية التقرير قبل تشغيل أي استعلام —
 * إخفاء البطاقة ليس تفويضاً.
 */

/** تنسيق خلية حسب نوع العمود — null-safe دائماً: لا «null» ولا NaN ولا صفر مُختلق */
function renderCell(value: string | number | null, column: ReportColumn): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (column.type) {
    case "money":
      return formatMoney(value as number);
    case "percent":
      return typeof value === "number" ? `${value}٪` : orDash(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString("ar-SA") : orDash(value);
    case "date":
      // عرض مزدوج ميلادي (هجري) لكل أعمدة التاريخ — D-033
      return typeof value === "string" ? dualNumericCell(value) : orDash(value);
    default:
      return orDash(value);
  }
}

function buildHref(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) if (v) sp.set(k, v);
  return `/reports?${sp.toString()}`;
}

/**
 * خيارات مرشّح «الحالة» — قوائم مغلقة معروفة لكل تقرير، لا قيم حرة من قاعدة البيانات،
 * فلا يتسرّب محتوى غير متوقع إلى عنصر الاختيار.
 */
function statusOptionsFor(reportKey: string): string[] {
  switch (reportKey) {
    case "programs-active":
      return ["مسودة", "معتمد", "مقفل"];
    case "income-register":
      return ["مستلم", "متوقع", "ملغى"];
    case "committee-register":
      return ["مسودة", "معتمدة", "مقفلة"];
    case "meetings-register":
      return ["مسودة", "مكتمل", "معتمد"];
    case "maintenance-register":
      return ["مسودة", "معتمد", "تم الإرسال", "تحت المعالجة", "تم الإصلاح", "لم يتم الإصلاح", "مغلق"];
    case "import-batches":
      return ["معاينة", "معتمد", "ملغى"];
    case "perf-evaluations":
    case "perf-incomplete":
      return ["مسودة", "مكتملة", "مقفلة"];
    case "plan-followups":
      return ["في المسار", "متأخر", "متوقف مؤقتاً", "مكتمل", "لم يتم التحديث هذا الأسبوع"];
    case "programs-by-domain":
    case "programs-by-owner":
      return ["مسودة", "معتمد", "مقفل"];
    case "plan-followup-log":
      return ["في المسار", "متأخر", "متوقف مؤقتاً", "مكتمل"];
    case "improvement-plans":
      return ["مقترحة", "معتمدة", "منفذة"];
    default:
      return [];
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const user = await requirePermission("reports.read");
  const sp = await searchParams;

  // الفئات المرئية لهذا المستخدم فقط
  const visibleCategories = REPORT_CATEGORIES.filter((c) => user.permissions.has(c.permission));
  const requested = sp.category ? categoryByKey(sp.category) : undefined;
  const category = requested && user.permissions.has(requested.permission) ? requested : visibleCategories[0];

  if (!category) {
    return (
      <div className="space-y-4">
        <PageHeader title="مركز التقارير" />
        <EmptyState title="لا تملك صلاحية عرض أي فئة تقارير" />
      </div>
    );
  }

  const categoryReports = reportsInCategory(category.key as CategoryKey).filter((r) => user.permissions.has(r.permission));
  const selectedReport = sp.report ? categoryReports.find((r) => r.key === sp.report) : undefined;

  // مرشّحات مُطهَّرة: الصفحة وحجمها محصوران، والترتيب مقيَّد بأعمدة التقرير نفسه
  const filters: ReportFilters = {
    search: sp.search,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    status: sp.status,
    personId: sp.personId,
    itemId: sp.itemId,
    sort: selectedReport && sp.sort && isSortableColumn(selectedReport.key, sp.sort) ? sp.sort : undefined,
    dir: sp.dir === "desc" ? "desc" : "asc",
    page: clampPage(sp.page ?? 1),
    pageSize: clampPageSize(sp.pageSize),
  };

  const result = selectedReport ? await runReport(selectedReport.key, filters) : null;

  // خيارات المرشّحات تُحمَّل فقط حين يعلنها التقرير المعروض — لا استعلام بلا داعٍ
  const needsItems = selectedReport?.filters?.includes("item") ?? false;
  const needsPeople = selectedReport?.filters?.includes("person") ?? false;
  const [itemRows, personRows] = await Promise.all([
    needsItems
      ? db
          .select({ id: financialItems.id, name: financialItems.nameAr })
          .from(financialItems)
          .where(isNull(financialItems.archivedAt))
          .orderBy(asc(financialItems.sortOrder))
      : Promise.resolve([] as { id: string; name: string | null }[]),
    needsPeople
      ? db.select({ id: people.id, name: people.fullName }).from(people).where(eq(people.active, true)).orderBy(asc(people.fullName))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const baseParams: Record<string, string | undefined> = {
    category: category.key,
    report: selectedReport?.key,
    search: sp.search,
    dateFrom: sp.dateFrom,
    dateTo: sp.dateTo,
    status: sp.status,
    personId: sp.personId,
    itemId: sp.itemId,
    sort: filters.sort,
    dir: filters.dir,
  };
  const exportQuery = (format: "csv" | "xlsx" | "pdf" | "docx") => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(baseParams)) if (v) p.set(k, v);
    p.set("format", format);
    return `/api/reports/export?${p.toString()}`;
  };

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;
  const canExport = user.permissions.has("reports.generate");

  return (
    <div className="space-y-5">
      <PageHeader
        title="مركز التقارير"
        subtitle="محرّك تقارير واحد لكل الأقسام — كل رقم يعود إلى سجله المصدري"
        actions={
          user.permissions.has("reports.executive") ? (
            // التسمية كما اعتادها المدير في النسخة السابقة — إعادة تصميم مركز التقارير
            // لا تستلزم تغيير اسم إجراء قائم يعرفه المستخدم.
            <LinkButton href="/reports/executive" variant="secondary">إصدار التقرير التنفيذي</LinkButton>
          ) : undefined
        }
      />

      <Tutorial
        id="reports"
        title="توليد التقارير وتنزيلها"
        steps={[
          "اختر الفئة ثم التقرير — كل الحالة في الرابط فيمكن مشاركته.",
          "رشّح بالبحث والتاريخ والحالة — المرشّحات الفعّالة تظهر داخل التقرير المولَّد.",
          "نزّل PDF أو Word (وExcel للجداول) — الاسم يتضمن التقرير والمدرسة وتاريخ التوليد.",
          "الوثائق الرسمية المرقّمة تُصدر من صفحات أقسامها وتبقى لقطاتها مجمّدة.",
        ]}
      />

      <nav aria-label="فئات التقارير" className="flex flex-wrap gap-2 print:hidden">
        {visibleCategories.map((c) => (
          <Link
            key={c.key}
            href={`/reports?category=${c.key}`}
            className={`inline-flex min-h-11 items-center rounded-lg border px-3 py-2 text-sm transition lg:min-h-0 ${
              c.key === category.key
                ? "border-brand-500 bg-brand-50 font-medium text-brand-800"
                : "border-sand-200 bg-white text-gray-700 hover:bg-sand-100"
            }`}
          >
            {c.label}
          </Link>
        ))}
      </nav>

      <p className="text-sm text-gray-500 print:hidden">{category.description}</p>

      {categoryReports.length === 0 ? (
        <EmptyState title="لا تقارير متاحة في هذه الفئة" hint="قد لا تملك صلاحية تشغيلها" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 print:hidden">
          {categoryReports.map((r) => (
            <Card key={r.key} className={r.key === selectedReport?.key ? "border-brand-400" : undefined}>
              <h3 className="font-bold text-brand-900">{r.label}</h3>
              <p className="mt-1 text-xs text-gray-500">{r.description}</p>
              <div className="mt-3">
                <LinkButton href={`/reports?category=${category.key}&report=${r.key}`} variant="secondary">
                  {r.key === selectedReport?.key ? "معروض" : "عرض"}
                </LinkButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selectedReport && result && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-brand-900">{selectedReport.label}</h2>
              <p className="text-xs text-gray-500">
                {result.total.toLocaleString("ar-SA")} سجل
                {result.total > pageSize ? ` — صفحة ${page} من ${totalPages}` : ""}
              </p>
            </div>
            {canExport && (
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {/* كل تقرير قابل للتنزيل PDF وWord (v2.3 §7) إضافة إلى CSV/Excel */}
                <a
                  href={exportQuery("pdf")}
                  className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0"
                >
                  تنزيل PDF
                </a>
                <a
                  href={exportQuery("docx")}
                  className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0"
                >
                  تنزيل Word
                </a>
                <a
                  href={exportQuery("xlsx")}
                  className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0"
                >
                  تصدير Excel
                </a>
                <a
                  href={exportQuery("csv")}
                  className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0"
                >
                  CSV
                </a>
              </div>
            )}
          </div>

          <div className="print:hidden">
            <ReportFilterBar
              report={selectedReport}
              statusOptions={statusOptionsFor(selectedReport.key)}
              itemOptions={itemRows.map((i) => ({ id: i.id, label: orFallback(i.name, "بند بدون اسم") }))}
              personOptions={personRows.map((p) => ({ id: p.id, label: p.name }))}
            />
          </div>

          {result.rows.length === 0 ? (
            <EmptyState title="لا نتائج مطابقة" hint="جرّب توسيع المرشّحات أو مسحها" />
          ) : (
            <>
              <Table
                headers={selectedReport.columns.map((c) => c.label)}
                sortLinks={selectedReport.columns.map((c) =>
                  buildHref(baseParams, {
                    sort: c.key,
                    dir: filters.sort === c.key && filters.dir === "asc" ? "desc" : "asc",
                    page: undefined,
                  }),
                )}
              >
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {selectedReport.columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 text-sm ${
                          c.type === "money" || c.type === "number" || c.type === "percent" ? "tabular-nums" : ""
                        }`}
                      >
                        {renderCell(row[c.key] ?? null, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>

              {totalPages > 1 && (
                <nav aria-label="تنقّل الصفحات" className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
                  <LinkButton href={buildHref(baseParams, { page: String(Math.max(1, page - 1)) })} variant="secondary">
                    السابق
                  </LinkButton>
                  <Badge value={`${page} / ${totalPages}`} />
                  <LinkButton href={buildHref(baseParams, { page: String(Math.min(totalPages, page + 1)) })} variant="secondary">
                    التالي
                  </LinkButton>
                </nav>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

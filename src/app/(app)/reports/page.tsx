import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Table, EmptyState, LinkButton, Badge } from "@/components/ui";
import { formatMoney, orDash } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import {
  REPORT_CATEGORIES,
  REPORT_SECTIONS,
  categoriesInSection,
  categoryByKey,
  isGroupableColumn,
  isSortableColumn,
  reportsInCategory,
  type CategoryKey,
  type ReportColumn,
  type ReportDefinition,
  type SectionKey,
} from "@/lib/reports/catalog";
import {
  parseReportFilters,
  describeFilters,
  writeListParam,
  canonicalListQuery,
  REPORT_MODES,
} from "@/lib/reports/filters";
import { redirect } from "next/navigation";
import { runReport } from "@/lib/reports/loaders";
import { loadFilterOptions, loadFilterLabelMaps } from "@/lib/reports/filter-options";
import { statusOptionsFor } from "@/lib/reports/status-options";
import { LARGE_REPORT_ROWS, MAX_EXPORT_ROWS } from "@/lib/reports/export-safety";
import { FilterPanel } from "@/components/report-filters";
import { Tutorial } from "@/components/tutorial";

export const metadata = { title: "مركز التقارير" };
export const dynamic = "force-dynamic";

/**
 * مركز التقارير (v2.2 §D · أُعيد تنظيمه في v2.5.0 §14/§15).
 *
 * محرّك واحد لكل الأقسام: القسم والفئة والتقرير والمرشّحات كلها في عنوان URL، فكل عرض
 * رابط عميق قابل للمشاركة، وزر «تقارير القسم» في أي قسم يفتح فئته مباشرةً بمرشّحاتها.
 *
 * ما تغيّر في v2.5.0:
 *  • **تنظيم مجالي** — ثلاث عشرة فئة صارت ستة أقسام يفكّر بها المدير، ولكل تقرير وصف
 *    تحت اسمه يوضّح الفرق بينه وبين جاره (§14).
 *  • **معاينة قبل التوليد** — عدد النتائج وصفوف تمثيلية والمرشّحات الفعّالة، مع تحذيرات
 *    صريحة: لا نتائج، أعمدة فارغة تماماً، تقرير ضخم، بيانات أداء فردية حسّاسة (§15).
 *  • **مرشّحات موحّدة** — اللوحة نفسها المستعملة في الشاشات التشغيلية، والتصدير يقرأ
 *    معاملات العنوان ذاتها فيخرج مطابقاً للشاشة (§3.4).
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

const SECTION_ORDER: SectionKey[] = ["programs", "performance", "councils", "finance", "building", "custom", "records"];

/**
 * مداخل الأداء المطلوبة في §7.1 و§14، كل واحد برابط يحمل مرشّحه مسبقاً.
 *
 * الفرق بين «تقرير المعلمين» و«تقرير الإداريين» و«تقرير الجميع» مرشّح واحد لا ثلاثة
 * تقارير، لكن المدير يطلبها بأسمائها — فتظهر بأسمائها ويقودها المرشّح نفسه.
 */
const PERFORMANCE_QUICK_LINKS = [
  {
    label: "التقرير التفصيلي الفردي (معلم أو موظف إداري)",
    description: "خطوات صريحة: النوع ← الموظف ← الدورة ← المعاينة ← الإصدار، مع بيان سبب أي نقص في البيانات.",
    href: "/reports/individual",
  },
  {
    label: "تقرير المعلمين",
    description: "نتائج المعلمين وحدهم بالأسماء والنتائج والفئات.",
    href: "/reports?category=performance&report=perf-results&empType=معلم",
  },
  {
    label: "تقرير الموظفين الإداريين",
    description: "نتائج الموظفين الإداريين وحدهم بالأسماء والنتائج والفئات.",
    href: "/reports?category=performance&report=perf-results&empType=موظف إداري",
  },
  {
    label: "تقرير جميع الموظفين",
    description: "كل الموظفين في تقرير واحد — معلمين وإداريين معاً.",
    href: "/reports?category=performance&report=perf-results",
  },
  {
    label: "الأداء المنخفض بالأسماء",
    description: "أقل من 70٪ افتراضياً، والعتبة قابلة للتعديل — بالأسماء والمعايير الضعيفة والتوصيات.",
    href: "/reports?category=performance&report=perf-low-performers",
  },
  {
    label: "التقييمات غير المكتملة",
    description: "الدورات التي لم تكتمل تقديراتها بعد، مع سبب النقص لكل دورة.",
    href: "/reports?category=performance&report=perf-results&flag=incomplete",
  },
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePermission("reports.read");
  const sp = await searchParams;

  /*
   * D-066: عنوانٌ بمفاتيح مكرّرة (رابط أو إشارة مرجعية من قبل هذا الإصدار) يُوحَّد هنا قبل
   * أي تصيير. لولاه لبقي مفتاح جزء الصفحة عند موجّه Next محسوباً من آخر تكرار وحده، فيقع
   * أول رفعٍ لقيمة في العطل نفسه. العنوان الموحَّد أصلاً لا يمرّ من هنا.
   */
  const canonicalQuery = canonicalListQuery(sp);
  if (canonicalQuery !== null) redirect(`/reports?${canonicalQuery}`);
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  // الفئات المرئية لهذا المستخدم فقط
  const visibleCategories = REPORT_CATEGORIES.filter((c) => user.permissions.has(c.permission));
  const requested = first("category") ? categoryByKey(first("category")!) : undefined;
  const category = requested && user.permissions.has(requested.permission) ? requested : undefined;

  if (visibleCategories.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="مركز التقارير" />
        <EmptyState title="لا تملك صلاحية عرض أي فئة تقارير" />
      </div>
    );
  }

  const categoryReports = category
    ? reportsInCategory(category.key as CategoryKey).filter((r) => user.permissions.has(r.permission))
    : [];
  const selectedReport = first("report") ? categoryReports.find((r) => r.key === first("report")) : undefined;

  const filters = selectedReport
    ? parseReportFilters(sp, {
        allowedSort: (k) => isSortableColumn(selectedReport.key, k),
        allowedColumns: selectedReport.columns.map((c) => c.key),
      })
    : parseReportFilters(sp);
  if (selectedReport && filters.group && !isGroupableColumn(selectedReport.key, filters.group)) filters.group = undefined;

  const result = selectedReport ? await runReport(selectedReport.key, filters) : null;
  /* §4.4: الأعمدة المختارة — من القالب أو من المنشئ — تُطبَّق على العرض بترتيبها
     المختار. الفراغ يعني كل أعمدة التقرير. القائمة مُصفّاة أصلاً بأعمدة التقرير
     المعلَنة في المحلّل، فلا يمر اسم عمود غير معلَن. */
  const shownColumns =
    selectedReport && filters.columns?.length
      ? filters.columns.flatMap((k) => selectedReport.columns.filter((c) => c.key === k))
      : (selectedReport?.columns ?? []);

  // خيارات المرشّحات تُحمَّل فقط لما أعلنه التقرير المعروض — لا استعلام بلا داعٍ
  const filterKeys = selectedReport?.filters ?? [];
  const [options, labelMaps] = await Promise.all([
    filterKeys.length
      ? loadFilterOptions(filterKeys, { statuses: statusOptionsFor(selectedReport!.key) })
      : Promise.resolve({}),
    selectedReport ? loadFilterLabelMaps(filters) : Promise.resolve({}),
  ]);

  const baseParams: Record<string, string | undefined> = {
    category: category?.key,
    report: selectedReport?.key,
  };
  const exportQuery = (format: "csv" | "xlsx" | "pdf" | "docx") => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string") p.append(k, v);
      else if (Array.isArray(v)) writeListParam(p, k, v);
    }
    p.set("format", format);
    return `/api/reports/export?${p.toString()}`;
  };

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1;
  const canExport = user.permissions.has("reports.generate");
  const activeChips = selectedReport ? describeFilters(filters, labelMaps) : [];

  // §15: الأعمدة الفارغة تماماً على كل النتائج — تحذير قبل توليد تقرير بأعمدة بيضاء
  const emptyColumns =
    selectedReport && result && result.rows.length > 0
      ? shownColumns.filter((c) => result.rows.every((r) => r[c.key] === null || r[c.key] === undefined || r[c.key] === ""))
      : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="مركز التقارير"
        subtitle="محرّك تقارير واحد لكل الأقسام — كل رقم يعود إلى سجله المصدري"
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/reports/builder">منشئ التقارير</LinkButton>
            <LinkButton href="/reports/archive" variant="secondary">أرشيف التقارير</LinkButton>
            {user.permissions.has("reports.executive") && (
              // التسمية كما اعتادها المدير في النسخة السابقة — إعادة تصميم مركز التقارير
              // لا تستلزم تغيير اسم إجراء قائم يعرفه المستخدم.
              <LinkButton href="/reports/executive" variant="secondary">إصدار التقرير التنفيذي</LinkButton>
            )}
          </div>
        }
      />

      <Tutorial
        id="reports"
        title="توليد التقارير وتنزيلها"
        steps={[
          "اختر القسم ثم التقرير — كل الحالة في الرابط فيمكن مشاركته.",
          "رشّح بما تحتاجه: واحد أو عدة أو الكل — عدد النتائج يظهر فوراً قبل التوليد.",
          "راجع الصفوف التمثيلية والتحذيرات، ثم نزّل PDF أو Word أو Excel أو CSV بالمرشّحات نفسها.",
          "لتقرير غير موجود في القائمة: «منشئ التقارير» يبني تقريرك ويحفظه قالباً لإعادة تشغيله.",
        ]}
      />

      {/* §14: خريطة الأقسام — كل قسم يحمل فئاته ووصف كل فئة تحت اسمها */}
      <nav aria-label="أقسام التقارير" className="space-y-4 print:hidden">
        {SECTION_ORDER.map((sectionKey) => {
          const cats = categoriesInSection(sectionKey).filter((c) => user.permissions.has(c.permission));
          if (sectionKey === "custom") {
            return (
              <section key={sectionKey}>
                <h2 className="mb-2 text-sm font-bold text-gray-600">{REPORT_SECTIONS.custom}</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <Card>
                    <h3 className="font-bold text-brand-900">منشئ التقارير</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      ابنِ تقريراً بمصدره ومرشّحاته وأعمدته وترتيبه وتجميعه، ثم شغّله أو احفظه قالباً.
                    </p>
                    <div className="mt-3"><LinkButton href="/reports/builder" variant="secondary">فتح المنشئ</LinkButton></div>
                  </Card>
                  <Card>
                    <h3 className="font-bold text-brand-900">القوالب المحفوظة</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      إعدادات تقارير محفوظة بأسمائها — شغّلها كما هي أو عدّلها أو انسخها.
                    </p>
                    <div className="mt-3"><LinkButton href="/reports/templates" variant="secondary">فتح القوالب</LinkButton></div>
                  </Card>
                  <Card>
                    <h3 className="font-bold text-brand-900">أرشيف التقارير</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      التقارير المحفوظة: مسودات تُبنى وتُعاين، وتقارير نهائية مرقّمة بلقطات لا تتغير، وأرشيف يُبحث فيه.
                    </p>
                    <div className="mt-3"><LinkButton href="/reports/archive" variant="secondary">فتح الأرشيف</LinkButton></div>
                  </Card>
                  <Card>
                    <h3 className="font-bold text-brand-900">التقارير الصادرة</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      الوثائق الرسمية المرقّمة التي صدرت فعلاً بلقطاتها المجمّدة — لا تُعاد كتابتها.
                    </p>
                    <div className="mt-3"><LinkButton href="/documents" variant="secondary">سجل الوثائق</LinkButton></div>
                  </Card>
                </div>
              </section>
            );
          }
          if (cats.length === 0) return null;
          return (
            <section key={sectionKey}>
              <h2 className="mb-2 text-sm font-bold text-gray-600">{REPORT_SECTIONS[sectionKey]}</h2>
              {/* §14 §7.1: مداخل الأداء المطلوبة بأسمائها، مرشَّحة مسبقاً — لا يبحث المدير
                  عن «المعلمون فقط» داخل لوحة مرشّحات */}
              {sectionKey === "performance" && user.permissions.has("performance.individual.read") && (
                <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {PERFORMANCE_QUICK_LINKS.map((q) => (
                    <Card key={q.href}>
                      <h3 className="font-bold text-brand-900">{q.label}</h3>
                      <p className="mt-1 text-xs text-gray-500">{q.description}</p>
                      <div className="mt-3"><LinkButton href={q.href} variant="secondary">فتح</LinkButton></div>
                    </Card>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {cats.map((c) => {
                  const count = reportsInCategory(c.key).filter((r) => user.permissions.has(r.permission)).length;
                  const isActive = c.key === category?.key;
                  return (
                    <Card key={c.key} className={isActive ? "border-brand-400" : undefined}>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-brand-900">{c.label}</h3>
                        <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs tabular-nums text-gray-600">{count}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{c.description}</p>
                      <div className="mt-3">
                        <LinkButton href={`/reports?category=${c.key}`} variant="secondary">
                          {isActive ? "معروضة" : "عرض التقارير"}
                        </LinkButton>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>

      {category && (
        <section className="print:hidden">
          <h2 className="mb-2 text-sm font-bold text-gray-600">{category.label}</h2>
          {categoryReports.length === 0 ? (
            <EmptyState title="لا تقارير متاحة في هذه الفئة" hint="قد لا تملك صلاحية تشغيلها" />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {categoryReports.map((r) => (
                <ReportCard key={r.key} report={r} category={category.key} active={r.key === selectedReport?.key} />
              ))}
            </div>
          )}
        </section>
      )}

      {selectedReport && result && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-brand-900">{selectedReport.label}</h2>
              <p className="text-xs text-gray-500">{selectedReport.description}</p>
              <p className="mt-1 text-xs text-gray-500">
                عدد النتائج: <span className="font-bold tabular-nums text-brand-900">{result.total.toLocaleString("ar-SA")}</span>
                {result.total > pageSize ? ` — صفحة ${page} من ${totalPages}` : ""}
                {filters.mode ? ` · نمط العرض: ${REPORT_MODES[filters.mode]}` : ""}
              </p>
            </div>
            {canExport && (
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {/* §3.4: التصدير يقرأ معاملات العنوان نفسها — المرشّحات الفعّالة تنطبق حرفياً */}
                <a href={exportQuery("pdf")} className="inline-flex min-h-11 items-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0">تنزيل PDF</a>
                <a href={exportQuery("docx")} className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0">تنزيل Word</a>
                <a href={exportQuery("xlsx")} className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0">تصدير Excel</a>
                <a href={exportQuery("csv")} className="inline-flex min-h-11 items-center rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0">CSV</a>
              </div>
            )}
          </div>

          {filterKeys.length > 0 && (
            <FilterPanel
              filterKeys={[...filterKeys]}
              options={options}
              resultCount={result.total}
              storageKey={`report:${selectedReport.key}`}
              keep={baseParams}
            />
          )}

          {/* §15: التحذيرات قبل التوليد — لا يُولَّد PDF فارغ بصمت */}
          <ReportWarnings
            report={selectedReport}
            total={result.total}
            emptyColumns={emptyColumns}
            hasFilters={activeChips.length > 0}
          />

          {result.rows.length === 0 ? (
            <EmptyState
              title="لا نتائج مطابقة"
              hint={
                activeChips.length > 0
                  ? `المرشّحات الفعّالة: ${activeChips.map((c) => `${c.label}: ${c.value}`).join(" · ")} — امسحها أو وسّعها`
                  : "لا توجد سجلات في هذا التقرير بعد"
              }
            />
          ) : (
            <>
              <Table
                headers={shownColumns.map((c) => c.label)}
                sortLinks={shownColumns.map((c) => sortHref(sp, c.key, filters.sort === c.key && filters.dir === "asc" ? "desc" : "asc"))}
              >
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {shownColumns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 text-sm ${c.type === "money" || c.type === "number" || c.type === "percent" ? "tabular-nums" : ""}`}
                      >
                        {renderCell(row[c.key] ?? null, c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>

              {totalPages > 1 && (
                <nav aria-label="تنقّل الصفحات" className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
                  <LinkButton href={pageHref(sp, Math.max(1, page - 1))} variant="secondary">السابق</LinkButton>
                  <Badge value={`${page} / ${totalPages}`} />
                  <LinkButton href={pageHref(sp, Math.min(totalPages, page + 1))} variant="secondary">التالي</LinkButton>
                </nav>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function ReportCard({ report, category, active }: { report: ReportDefinition; category: CategoryKey; active: boolean }) {
  return (
    <Card className={active ? "border-brand-400" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-brand-900">{report.label}</h3>
        {report.sensitive && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">بيانات حسّاسة</span>}
      </div>
      {/* §14: وصف تحت كل اسم — يفرّق بين تقريرين متجاورين متشابهي الاسم */}
      <p className="mt-1 text-xs text-gray-500">{report.description}</p>
      <div className="mt-3">
        <LinkButton href={`/reports?category=${category}&report=${report.key}`} variant="secondary">
          {active ? "معروض" : "عرض"}
        </LinkButton>
      </div>
    </Card>
  );
}

/**
 * تحذيرات المعاينة (§15).
 *
 * لا يُترك أي من هذه الأحوال ليكتشفه المستخدم بعد فتح ملف PDF: صفر نتيجة، أعمدة فارغة
 * تماماً، تقرير ضخم، أو بيانات أداء فردية حسّاسة يُصدَّر بها ملف قابل للمشاركة.
 */
function ReportWarnings({
  report,
  total,
  emptyColumns,
  hasFilters,
}: {
  report: ReportDefinition;
  total: number;
  emptyColumns: ReportColumn[];
  hasFilters: boolean;
}) {
  const warnings: string[] = [];
  if (total === 0) {
    warnings.push(
      hasFilters
        ? "لا سجلات مطابقة للمرشّحات الحالية — التصدير سيُنتج تقريراً فارغاً."
        : "لا سجلات في هذا التقرير — التصدير سيُنتج تقريراً فارغاً.",
    );
  }
  if (emptyColumns.length > 0) {
    warnings.push(
      `أعمدة بلا أي قيمة في كل النتائج: ${emptyColumns.map((c) => c.label).join("، ")} — ستظهر فارغة في المُصدَّر.`,
    );
  }
  if (total > LARGE_REPORT_ROWS) {
    warnings.push(
      `تقرير كبير (${total.toLocaleString("ar-SA")} صفاً) — قد يستغرق التوليد وقتاً، والتصدير يقف عند ${MAX_EXPORT_ROWS.toLocaleString("ar-SA")} صف.`,
    );
  }
  if (report.sensitive) {
    warnings.push("يتضمن هذا التقرير بيانات أداء فردية — الملف المُصدَّر قابل للمشاركة، فتعامل معه وفق سياسة الخصوصية.");
  }
  if (warnings.length === 0) return null;
  return (
    <ul className="mb-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 print:hidden">
      {warnings.map((w) => (
        <li key={w} role="status">⚠ {w}</li>
      ))}
    </ul>
  );
}

/** روابط الترتيب والصفحات تحافظ على كل معاملات المرشّحات المتعدّدة كما هي */
function paramsFrom(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") p.append(k, v);
    else if (Array.isArray(v)) writeListParam(p, k, v);
  }
  return p;
}

function sortHref(sp: Record<string, string | string[] | undefined>, column: string, dir: "asc" | "desc"): string {
  const p = paramsFrom(sp);
  p.set("sort", column);
  p.set("dir", dir);
  p.delete("page");
  return `/reports?${p.toString()}`;
}

function pageHref(sp: Record<string, string | string[] | undefined>, page: number): string {
  const p = paramsFrom(sp);
  p.set("page", String(page));
  return `/reports?${p.toString()}`;
}

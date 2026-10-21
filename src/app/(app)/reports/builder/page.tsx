import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Table, EmptyState, LinkButton, Badge } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { FilterPanel } from "@/components/report-filters";
import { loadFilterOptions } from "@/lib/reports/filter-options";
import { statusOptionsFor } from "@/lib/reports/status-options";
import {
  REPORT_SOURCES,
  builderReports,
  isSortableColumn,
  isGroupableColumn,
  modesFor,
  type ReportDefinition,
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
import { LARGE_REPORT_ROWS } from "@/lib/reports/export-safety";
import { allowedVisibilities, getTemplate } from "@/lib/reports/templates";
import { formatMoney, orDash } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import { getInstance } from "@/lib/reports/instances/service";
import { parseInstanceOptions } from "@/lib/reports/instances/options";
import { templateChoices } from "@/lib/reports/instances/style-templates";
import { BuilderControls, SaveTemplateForm, SaveAsInstanceForm } from "./builder-ui";

export const metadata = { title: "منشئ التقارير" };
export const dynamic = "force-dynamic";

/**
 * منشئ التقارير (v2.5.0 §4).
 *
 * ── لماذا فوق المحرّك القائم لا بجواره ──────────────────────────────────────
 * التكليف يمنع صراحةً محرّك تقارير ثانياً. فالمنشئ **واجهة تأليف** فوق السجل نفسه
 * (`lib/reports/catalog`) والمحمّلات نفسها (`lib/reports/loaders`): يختار المستخدم مصدر
 * بيانات ثم تقريراً منه، ثم يرشّح ويختار الأعمدة وترتيبها والتجميع ونمط العرض. الناتج
 * ليس استعلاماً جديداً بل **نفس** استدعاء `runReport` الذي يخدم مركز التقارير.
 *
 * ── ولماذا هذا آمن ──────────────────────────────────────────────────────────
 * لا اسم عمود ولا مفتاح ترتيب ولا تجميع يصل من الواجهة إلى SQL: كلها تُصفَّى بقائمة
 * بيضاء من تعريف التقرير نفسه (§22). ما يبنيه المستخدم هو **اختيار من معلَن**، لا نص
 * يُمرَّر.
 */
export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePermission("reports.read", "reports.builder");
  const sp = await searchParams;

  /*
   * D-066: عنوانٌ بمفاتيح مكرّرة (رابط أو إشارة مرجعية من قبل هذا الإصدار) يُوحَّد هنا قبل
   * أي تصيير. لولاه لبقي مفتاح جزء الصفحة عند موجّه Next محسوباً من آخر تكرار وحده، فيقع
   * أول رفعٍ لقيمة في العطل نفسه. العنوان الموحَّد أصلاً لا يمرّ من هنا.
   */
  const canonicalQuery = canonicalListQuery(sp);
  if (canonicalQuery !== null) redirect(`/reports/builder?${canonicalQuery}`);
  const first = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  // التقارير المتاحة للمنشئ = ما أعلن مصدر بيانات **و** يملك المستخدم صلاحيته
  const available = builderReports().filter((r) => user.permissions.has(r.permission));
  const bySource = new Map<string, ReportDefinition[]>();
  for (const r of available) {
    const list = bySource.get(r.source!) ?? [];
    list.push(r);
    bySource.set(r.source!, list);
  }

  const selected = first("report") ? available.find((r) => r.key === first("report")) : undefined;
  const editingId = first("template");
  const editing = editingId ? await getTemplate(editingId, user) : null;
  // v2.6: المنشئ هو محرّر التقرير المحفوظ أيضاً — `instance=<id>` يفتحه للتعديل هنا
  const instanceId = first("instance");
  const instance = instanceId ? await getInstance(instanceId, user) : null;
  const instanceOptions = instance ? parseInstanceOptions(instance.options) : null;

  const filters = selected
    ? parseReportFilters(sp, {
        allowedSort: (k) => isSortableColumn(selected.key, k),
        allowedColumns: selected.columns.map((c) => c.key),
      })
    : parseReportFilters(sp);
  if (selected && filters.group && !isGroupableColumn(selected.key, filters.group)) filters.group = undefined;

  // الأعمدة المختارة — الفراغ يعني كل أعمدة التقرير
  const chosenColumns = (filters.columns?.length ? filters.columns : selected?.columns.map((c) => c.key)) ?? [];
  const visibleColumns = selected?.columns.filter((c) => chosenColumns.includes(c.key)) ?? [];

  const result = selected ? await runReport(selected.key, { ...filters, pageSize: 10, page: 1 }) : null;
  const filterKeys = selected?.filters ?? [];
  const options = filterKeys.length
    ? await loadFilterOptions(filterKeys, { statuses: statusOptionsFor(selected!.key) })
    : {};

  const chips = selected ? describeFilters(filters) : [];
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") query.append(k, v);
    else if (Array.isArray(v)) writeListParam(query, k, v);
  }

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports" label="عودة إلى مركز التقارير" />
      </div>
      <PageHeader
        title="منشئ التقارير"
        subtitle="اختر مصدر البيانات ثم التقرير، ثم رشّح واختر الأعمدة والترتيب والتجميع — ثم شغّله أو احفظه قالباً"
        actions={<LinkButton href="/reports/templates" variant="secondary">القوالب المحفوظة</LinkButton>}
      />

      {/* ١ — مصدر البيانات والتقرير */}
      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">١. مصدر البيانات</h2>
        {available.length === 0 ? (
          <EmptyState title="لا مصادر متاحة" hint="تظهر هنا التقارير التي تملك صلاحيتها" />
        ) : (
          <div className="space-y-3">
            {[...bySource.entries()].map(([source, reports]) => (
              <div key={source}>
                <h3 className="mb-1 text-xs font-bold text-gray-600">
                  {REPORT_SOURCES[source as keyof typeof REPORT_SOURCES]}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {reports.map((r) => (
                    <LinkButton
                      key={r.key}
                      href={`/reports/builder?report=${r.key}`}
                      variant={selected?.key === r.key ? "primary" : "secondary"}
                    >
                      {r.label}
                    </LinkButton>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <>
          {/* ٢ — المرشّحات */}
          <Card>
            <h2 className="mb-2 text-sm font-bold text-brand-900">٢. المرشّحات</h2>
            {filterKeys.length === 0 ? (
              <p className="text-xs text-gray-500">هذا التقرير لا يعلن مرشّحات — يُعرض كاملاً.</p>
            ) : (
              <FilterPanel
                filterKeys={[...filterKeys]}
                options={options}
                resultCount={result?.total}
                keep={{ report: selected.key, template: editingId, instance: instanceId }}
              />
            )}
          </Card>

          {/* ٣ — الأعمدة والترتيب والتجميع ونمط العرض */}
          <Card>
            <h2 className="mb-2 text-sm font-bold text-brand-900">٣. الأعمدة والترتيب والتجميع</h2>
            <BuilderControls
              reportKey={selected.key}
              columns={selected.columns.map((c) => ({ key: c.key, label: c.label }))}
              chosen={chosenColumns}
              groupOptions={(selected.groupBy ?? []).map((k) => ({
                key: k,
                label: selected.columns.find((c) => c.key === k)?.label ?? k,
              }))}
              modes={modesFor(selected.key).map((m) => ({ key: m, label: REPORT_MODES[m] }))}
            />
          </Card>

          {/* ٤ — المعاينة (§15) */}
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-brand-900">٤. المعاينة</h2>
              <span className="text-sm text-gray-600">
                عدد النتائج:{" "}
                <span className="font-bold tabular-nums text-brand-900">{(result?.total ?? 0).toLocaleString("ar-SA")}</span>
              </span>
            </div>
            {chips.length > 0 && (
              <p className="mb-2 text-xs text-gray-500">
                المرشّحات الفعّالة: {chips.map((c) => `${c.label}: ${c.value}`).join(" · ")}
              </p>
            )}
            {(result?.total ?? 0) === 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                ⚠ لا سجلات مطابقة — التشغيل أو التصدير سيُنتج تقريراً فارغاً.
              </p>
            ) : (
              <>
                {(result?.total ?? 0) > LARGE_REPORT_ROWS && (
                  <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                    ⚠ تقرير كبير — قد يستغرق التوليد وقتاً.
                  </p>
                )}
                {visibleColumns.length === 0 ? (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">⚠ لم تُختر أي أعمدة.</p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-gray-500">صفوف تمثيلية (حتى ١٠ صفوف):</p>
                    <Table headers={visibleColumns.map((c) => c.label)}>
                      {(result?.rows ?? []).map((row, i) => (
                        <tr key={i}>
                          {visibleColumns.map((c) => (
                            <td key={c.key} className="px-3 py-2 text-sm">
                              {renderCell(row[c.key] ?? null, c.type)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-sand-100 pt-3">
              <LinkButton href={`/reports?category=${selected.category}&${query.toString()}`}>
                تشغيل التقرير في مركز التقارير
              </LinkButton>
              {selected.sensitive && <Badge value="بيانات أداء فردية" />}
            </div>
          </Card>

          {/* ٥ — الحفظ تقريراً محفوظاً (v2.6 §A) */}
          <Card>
            <h2 className="mb-1 text-sm font-bold text-brand-900">
              ٥. {instance ? `تحديث التقرير المحفوظ «${instance.title}»` : "حفظ كتقرير محفوظ"}
            </h2>
            <p className="mb-2 text-xs text-gray-500">
              التقرير المحفوظ يأخذ اختياراتك كما هي — المرشّحات والأعمدة وترتيبها والتجميع ونمط العرض — ثم يُعتمد
              برقم لا يتكرر ولقطة لا تتغير.
            </p>
            {instance && instance.status !== "مسودة" ? (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                هذا التقرير معتمد ولا يُعدَّل — أنشئ منه نسخة جديدة من صفحته.
              </p>
            ) : (
              <SaveAsInstanceForm
                reportKey={selected.key}
                query={query.toString()}
                instanceId={instance?.id}
                defaultTitle={instance?.title ?? selected.label}
                templates={await templateChoices()}
                currentTemplateKey={instanceOptions?.templateKey}
                currentFormats={instanceOptions?.outputFormats}
                periodFrom={instance?.periodFrom}
                periodTo={instance?.periodTo}
              />
            )}
          </Card>

          {/* ٦ — الحفظ كقالب إعدادات */}
          <Card>
            <h2 className="mb-2 text-sm font-bold text-brand-900">
              ٦. {editing ? `تعديل القالب «${editing.name}»` : "حفظ كقالب إعدادات"}
            </h2>
            <SaveTemplateForm
              reportKey={selected.key}
              query={query.toString()}
              columns={chosenColumns}
              visibilities={allowedVisibilities(user)}
              editing={editing ? { id: editing.id, name: editing.name, description: editing.description, visibility: editing.visibility } : null}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function renderCell(value: string | number | null, type?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money") return formatMoney(value as number);
  if (type === "percent") return typeof value === "number" ? `${value}٪` : orDash(value);
  if (type === "number") return typeof value === "number" ? value.toLocaleString("ar-SA") : orDash(value);
  if (type === "date") return typeof value === "string" ? dualNumericCell(value) : orDash(value);
  return orDash(value);
}

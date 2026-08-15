import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Table, Badge, LinkButton } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { FilterPanel } from "@/components/report-filters";
import { EvidencePanel } from "@/components/evidence-panel";
import { evidenceForEntity } from "@/lib/evidence";
import { loadFilterOptions } from "@/lib/reports/filter-options";
import { reportByKey, isSortableColumn, type FilterKey } from "@/lib/reports/catalog";
import { parseReportFilters, filtersToStored, serializeReportFilters, storedToParams } from "@/lib/reports/filters";
import { getInstance, instanceOutputs } from "@/lib/reports/instances/service";
import { buildSnapshot, SnapshotPermissionError } from "@/lib/reports/instances/snapshot";
import { readSnapshot, parseInstanceOptions, type SnapshotDoc } from "@/lib/reports/instances/options";
import { sectionsOf, instanceTypeByKey, INSTANCE_DRAFT, INSTANCE_ARCHIVED } from "@/lib/reports/instances/types";
import { templateChoices } from "@/lib/reports/instances/style-templates";
import { validateDocument } from "@/lib/reports/instances/validation";
import { linkForCell } from "@/lib/reports/instances/links";
import { latestJob, JOB_FAILED, JOB_DONE, JOB_PENDING, JOB_RUNNING, isStale } from "@/lib/reports/instances/jobs";
import { dualNumericCell } from "@/lib/dates";
import { formatMoney, orDash } from "@/lib/format";
import {
  DraftSettingsForm,
  DraftActions,
  FinalActions,
  SignedCopyForm,
  JobWatcher,
  RetryGenerationButton,
} from "./instance-ui";

export const metadata = { title: "تقرير محفوظ" };
export const dynamic = "force-dynamic";

/**
 * صفحة التقرير المحفوظ (v2.6 §A/§B/§I).
 *
 * المسودة: معاينة حية من `buildSnapshot` — مرشّحات العنوان ترجّح على المحفوظة فيتغير
 * العرض فور تغيير أي مرشّح، و«حفظ المسودة» يثبّت ما على الشاشة. التقرير المعتمد: لقطته
 * المجمّدة تُعرض كما كُتبت — البيانات الحية لا تُقرأ إطلاقاً (D-060).
 */
export default async function ReportInstancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("reports.read");
  const { id } = await params;
  const sp = await searchParams;
  const row = await getInstance(id, user);
  if (!row) notFound();

  const isDraft = row.status === INSTANCE_DRAFT;
  const options = parseInstanceOptions(row.options);
  const typeDef = instanceTypeByKey(row.typeKey);
  const sections = sectionsOf(row.typeKey, options);
  const primaryReportKey = options.reportKey ?? sections[0]?.reportKey ?? "";

  // مرشّحات العرض الحالية: معاملات العنوان إن وُجدت، وإلا المحفوظة في المسودة
  const urlHasFilters = Object.keys(sp).length > 0;
  const workingFilters = urlHasFilters
    ? parseReportFilters(sp, {
        allowedSort: (k) => isSortableColumn(primaryReportKey, k),
        allowedColumns: reportByKey(primaryReportKey)?.columns.map((c) => c.key),
      })
    : null;
  const storedFilters = workingFilters ? filtersToStored(workingFilters) : row.filters;

  // بناء الوثيقة: لقطة مجمّدة للمعتمد؛ بناء حيّ للمسودة
  let doc: SnapshotDoc | null = null;
  let buildError: string | null = null;
  if (isDraft) {
    try {
      doc = await buildSnapshot({
        instanceId: row.id,
        typeKey: row.typeKey,
        title: row.title,
        storedFilters,
        storedOptions: row.options,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        viewer: user,
      });
    } catch (e) {
      buildError = e instanceof SnapshotPermissionError ? e.message : e instanceof Error ? e.message : "تعذر بناء المعاينة";
    }
  } else {
    doc = readSnapshot(row.snapshot);
    if (!doc) buildError = "لقطة التقرير غير قابلة للقراءة";
  }

  const warnings = doc ? validateDocument(doc, { sensitive: row.sensitive }) : [];
  const outputs = await instanceOutputs(row.id);
  const job = await latestJob(row.id);
  const jobActive = !!job && (job.status === JOB_PENDING || job.status === JOB_RUNNING) && !isStale(job);

  // مرشّحات اللوحة: اتحاد مرشّحات كل الأقسام
  const filterKeySet = new Set<FilterKey>();
  for (const s of sections) for (const k of reportByKey(s.reportKey)?.filters ?? []) filterKeySet.add(k);
  const filterKeys = [...filterKeySet];
  const filterOptions = isDraft && filterKeys.length ? await loadFilterOptions(filterKeys) : {};

  // النص المسلسل للمرشّحات الحالية — يحمله نموذج «حفظ المسودة»
  const query = workingFilters
    ? serializeReportFilters(workingFilters).toString()
    : storedToParams(row.filters).toString();

  const templates = await templateChoices();
  // الشواهد والمرفقات المختارة لهذا التقرير (§A/§F) — تُجمَّد قائمتها في اللقطة عند الاعتماد
  const evidence = user.permissions.has("evidence.read") ? await evidenceForEntity("report_instance", row.id) : [];

  const downloadHref = (format: string) => `/api/reports/instances/${row.id}/download?format=${format}`;

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports/archive" label="عودة إلى أرشيف التقارير" />
      </div>
      <PageHeader
        title={row.title}
        subtitle={`${typeDef?.labelAr ?? row.typeKey}${row.reportNumber ? ` — رقم التقرير: ${row.reportNumber}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={row.status} />
            {row.sensitive ? <Badge value="بيانات أداء فردية" /> : null}
          </div>
        }
      />
      <JobWatcher instanceId={row.id} active={jobActive} />

      {row.versionOfId ? (
        <p className="text-xs text-gray-500">
          هذا التقرير نسخة جديدة من{" "}
          <Link prefetch={false} className="text-brand-700 underline" href={`/reports/archive/${row.versionOfId}`}>
            تقرير أصلي سابق
          </Link>
          .
        </p>
      ) : null}

      {/* الإجراءات */}
      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">الإجراءات</h2>
        {isDraft ? <DraftActions instanceId={row.id} /> : <FinalActions instanceId={row.id} archived={row.status === INSTANCE_ARCHIVED} />}
        {isDraft && options.reportKey ? (
          <p className="mt-3 border-t border-sand-100 pt-3 text-xs text-gray-500">
            لتعديل الأعمدة وترتيبها والتجميع ونمط العرض:{" "}
            <Link prefetch={false} className="text-brand-700 underline" href={`/reports/builder?report=${options.reportKey}&instance=${row.id}&${query}`}>
              افتح هذا التقرير في منشئ التقارير
            </Link>
            .
          </p>
        ) : null}
      </Card>

      {/* إعدادات المسودة والمرشّحات */}
      {isDraft ? (
        <>
          <Card>
            <h2 className="mb-2 text-sm font-bold text-brand-900">المرشّحات — تسري على كل الأقسام</h2>
            {filterKeys.length === 0 ? (
              <p className="text-xs text-gray-500">أقسام هذا التقرير لا تعلن مرشّحات.</p>
            ) : (
              <FilterPanel filterKeys={filterKeys} options={filterOptions} resultCount={doc?.stats.totalRows} />
            )}
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-bold text-brand-900">إعدادات التقرير</h2>
            <DraftSettingsForm
              instanceId={row.id}
              typeKey={row.typeKey}
              reportKey={options.reportKey ?? ""}
              query={query}
              title={row.title}
              periodFrom={row.periodFrom}
              periodTo={row.periodTo}
              templateKey={options.templateKey ?? typeDef?.defaultTemplateKey ?? "official"}
              showEmpty={options.showEmpty === true}
              sections={sections.map((s) => ({ key: s.key, label: s.labelAr ?? reportByKey(s.reportKey)?.label ?? s.key }))}
              hiddenSections={options.hiddenSections ?? []}
              templates={templates}
              identityOverrides={(options.identityOverrides ?? {}) as Record<string, string>}
              outputFormats={options.outputFormats ?? ["pdf", "docx", "xlsx"]}
            />
          </Card>
        </>
      ) : null}

      {/* التحذيرات (§A: التحذير لا يمنع؛ المانع يمنع) */}
      {warnings.length > 0 ? (
        <Card>
          <h2 className="mb-2 text-sm font-bold text-brand-900">فحص ما قبل {isDraft ? "الاعتماد" : "الاستخدام"}</h2>
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li
                key={w.key}
                className={`rounded-lg p-2 text-xs ${w.blocking ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}
              >
                {w.blocking ? "⛔" : "⚠"} {w.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* الشواهد والمرفقات (§A/§F) */}
      {user.permissions.has("evidence.read") ? (
        <Card>
          <h2 className="mb-1 text-sm font-bold text-brand-900">الشواهد والمرفقات</h2>
          <p className="mb-2 text-xs text-gray-500">
            ما يُربط هنا يظهر في قائمة «الشواهد والمرفقات المستعملة» داخل التقرير، ويدخل حزمة ZIP بعد الاعتماد.
          </p>
          <EvidencePanel
            entityType="report_instance"
            entityId={row.id}
            items={evidence.map((e) => ({
              id: e.item.id,
              title: e.item.title,
              kind: e.item.kind,
              role: e.item.role,
              fileId: e.item.fileId,
            }))}
            canWrite={isDraft && user.permissions.has("evidence.write")}
          />
        </Card>
      ) : null}

      {/* المخرجات والتوليد الخلفي (§I) */}
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-brand-900">المخرجات</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <a className="text-brand-700 underline" href={`/api/reports/instances/${row.id}/print`} target="_blank">
              معاينة الطباعة
            </a>
          </div>
        </div>

        {isDraft ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              مخرجات المسودة تُنزَّل مباشرة بختم «مسودة» ولا تُحفظ — المخرجات المحفوظة للتقرير المعتمد وحده.
            </p>
            <div className="flex flex-wrap gap-2">
              {["pdf", "docx", "xlsx"].map((f) => (
                <a key={f} className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-sand-100" href={downloadHref(f)}>
                  تنزيل {f.toUpperCase()}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {job ? (
              <div
                className={`rounded-lg p-2 text-xs ${
                  job.status === JOB_DONE
                    ? "bg-emerald-50 text-emerald-800"
                    : job.status === JOB_FAILED
                      ? "bg-red-50 text-red-800"
                      : "bg-blue-50 text-blue-800"
                }`}
              >
                حالة التوليد: {job.status}
                {job.attempt > 1 ? ` (المحاولة ${job.attempt})` : ""}
                {job.error ? ` — ${job.error}` : ""}
                {jobActive ? " — تُتابَع الحالة تلقائياً وتظهر النتيجة فور اكتمالها…" : ""}
                {job.status === JOB_FAILED ? (
                  <div className="mt-2">
                    <RetryGenerationButton instanceId={row.id} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {outputs.length === 0 ? (
              <p className="text-xs text-gray-500">لا مخرجات محفوظة بعد — «توليد المخرجات» ينشئها في الخلفية.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {outputs.map((o) => (
                  <a
                    key={o.id}
                    className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-sand-100"
                    href={downloadHref(o.format)}
                  >
                    تنزيل {o.format.toUpperCase()}
                    {o.size ? ` (${Math.max(1, Math.round(o.size / 1024))} ك.ب)` : ""}
                  </a>
                ))}
              </div>
            )}

            <div className="border-t border-sand-100 pt-3">
              {row.signedCopyFileId ? (
                <p className="mb-2 text-xs text-emerald-800">
                  ✓ النسخة الموقّعة محفوظة —{" "}
                  <a className="underline" href={downloadHref("signed")}>
                    تنزيلها
                  </a>
                  {" "}وتدخل حزمة ZIP تلقائياً.
                </p>
              ) : null}
              <SignedCopyForm instanceId={row.id} hasSigned={!!row.signedCopyFileId} />
            </div>
          </div>
        )}
      </Card>

      {/* المعاينة (§A: أسماء وأرقام تفاعلية تقصد مصادرها) */}
      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">
          {isDraft ? "معاينة حية — تتغير بالمرشّحات" : "اللقطة المعتمدة — كما جُمّدت لحظة الاعتماد"}
        </h2>
        {buildError ? (
          <p className="rounded-lg bg-red-50 p-3 text-xs text-red-800">{buildError}</p>
        ) : doc ? (
          <div className="space-y-5">
            <p className="text-xs text-gray-500">
              {doc.typeLabel}
              {doc.periodText ? ` — الفترة: ${doc.periodText}` : ""} — توليد: {doc.generatedAtText} — الأقسام: {doc.stats.sectionCount} — الصفوف: {doc.stats.totalRows}
            </p>
            {doc.sections.map((section, i) => (
              <section key={section.key}>
                <h3 className="mb-1 border-s-3 border-brand-600 ps-2 text-sm font-bold text-brand-900">
                  {i + 1}. {section.label}
                </h3>
                {section.filterLines.length > 0 && (
                  <p className="mb-1 text-xs text-gray-500">
                    {section.filterLines.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </p>
                )}
                <p className="mb-1 text-xs text-gray-500">عدد الصفوف: {section.total}</p>
                {section.truncated && (
                  <p className="mb-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">⚠ اقتُطع القسم عند حده الأقصى.</p>
                )}
                {section.empty ? (
                  <p className="rounded-lg bg-sand-50 p-3 text-xs text-gray-500">لا بيانات مطابقة في هذا القسم.</p>
                ) : (
                  <Table headers={section.columns.map((c) => c.label)}>
                    {section.rows.slice(0, 50).map((r, ri) => (
                      <tr key={ri}>
                        {section.columns.map((c) => {
                          const value = r[c.key] ?? null;
                          const href = linkForCell(section.reportKey, c.key, value);
                          const text = renderCell(value, c.type);
                          return (
                            <td key={c.key} className="px-3 py-2 text-sm">
                              {href ? (
                                <Link prefetch={false} className="text-brand-700 underline" href={href}>
                                  {text}
                                </Link>
                              ) : (
                                text
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Table>
                )}
                {section.rows.length > 50 && (
                  <p className="mt-1 text-xs text-gray-400">
                    عُرضت أول ٥٠ صفاً من {section.total} — الملفات المولَّدة والمطبوعة تحمل الكل.
                  </p>
                )}
              </section>
            ))}
            {doc.attachments.length > 0 && (
              <section>
                <h3 className="mb-1 border-s-3 border-brand-600 ps-2 text-sm font-bold text-brand-900">
                  الشواهد والمرفقات المستعملة
                </h3>
                <ul className="list-inside list-disc text-sm text-gray-700">
                  {doc.attachments.map((a) => (
                    <li key={a.fileId}>
                      {a.name} <span className="text-xs text-gray-400">({a.source})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : null}
      </Card>
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

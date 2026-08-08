import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { evidenceItems, evidenceLinks, reportStyleTemplates } from "@/db/schema";
import { getDocumentIdentity, resolveHeader } from "@/lib/document-identity";
import { dualNumericCell, todayIso } from "@/lib/dates";
import { reportByKey, isSortableColumn, type ReportColumn } from "../catalog";
import {
  parseReportFilters,
  filterHeaderLines,
  lowThresholdHeaderLine,
  storedToParams,
  type ReportFilters,
} from "../filters";
import { runReportForExport } from "../loaders";
import { loadFilterLabelMaps } from "../filter-options";
import { resolveStyleConfig, isBaseTemplateKey } from "./base-templates";
import { resolveTemplateKey } from "./style-templates";
import { sectionsOf, instanceTypeByKey, type InstanceSectionDef } from "./types";
import {
  parseInstanceOptions,
  type InstanceOptions,
  type SnapshotDoc,
  type SnapshotSection,
  type SnapshotAttachment,
} from "./options";

/**
 * بناء وثيقة التقرير (v2.6 — D-060): **الدالة الواحدة** التي تقرأ البيانات الحية وتبني
 * `SnapshotDoc`. تستدعيها المعاينة الحية للمسودة عند كل تحديث مرشّح، وتستدعيها معاملة
 * الاعتماد لتجميد ناتجها في `report_instances.snapshot` — فما يُعتمد هو حرفياً ما عُوين.
 *
 * الصلاحيات هنا صريحة: كل قسم يُبنى فقط إذا كان الناظر يملك صلاحية تقريره — قسم بلا
 * صلاحية **يُرفض بناؤه كله** بدل إسقاطه بصمت، فلا يعتمد المدير تقريراً ناقصاً وهو لا
 * يدري (تكوين التقرير مُعلن في نوعه، فالرفض المبكر أوضح من الفراغ الغامض).
 */

type Viewer = { id: string; permissions: Set<string> };

export class SnapshotPermissionError extends Error {
  constructor(reportLabel: string) {
    super(`لا تملك صلاحية قسم «${reportLabel}» فلا يُبنى هذا التقرير`);
    this.name = "SnapshotPermissionError";
  }
}

/** خلية فارغة: null أو نص فارغ/شرطة — تُستعمل لإخفاء الأعمدة والأقسام الفارغة (§A) */
function cellEmpty(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return false;
  const t = v.trim();
  return t === "" || t === "—" || t === "-";
}

/**
 * مرشّحات قسم واحد: مرشّحات التقرير العامة ثم إضافات القسم فوقها، ثم التطهير بالقوائم
 * البيضاء **لتقرير القسم نفسه** — فمرشّح لا يعنيه يسقط ولا يمر إلى استعلامه.
 */
export function sectionFilters(
  section: InstanceSectionDef,
  storedInstanceFilters: unknown,
  options: InstanceOptions,
  period: { from: string | null; to: string | null },
): ReportFilters {
  const def = reportByKey(section.reportKey);
  const params = storedToParams(storedInstanceFilters ?? {});
  const extra = storedToParams(options.sectionFilters?.[section.key] ?? {});
  for (const [k, v] of extra) params.append(k, v);
  // فترة التقرير تسري على كل قسم يقبل مدة — من غير أن تمحو مدةً أدق حدّدها القسم
  if (period.from && !params.get("dateFrom")) params.set("dateFrom", period.from);
  if (period.to && !params.get("dateTo")) params.set("dateTo", period.to);
  return parseReportFilters(params, {
    allowedSort: (k) => isSortableColumn(section.reportKey, k),
    allowedColumns: def?.columns.map((c) => c.key),
  });
}

/** أعمدة القسم بعد اختيار المستخدم وإخفاء الفارغ التلقائي */
function visibleColumns(
  def: { columns: ReportColumn[] },
  filters: ReportFilters,
  rows: Record<string, string | number | null>[],
  showEmpty: boolean,
): ReportColumn[] {
  const chosen = filters.columns?.length
    ? def.columns.filter((c) => filters.columns!.includes(c.key))
    : def.columns;
  if (showEmpty || rows.length === 0) return chosen;
  const nonEmpty = chosen.filter((c) => rows.some((r) => !cellEmpty(r[c.key])));
  // لو أخفينا كل الأعمدة (بيانات كلها فارغة) نعيد المختار — جدول بلا أعمدة ليس تقريراً
  return nonEmpty.length > 0 ? nonEmpty : chosen;
}

/** المرفقات والشواهد المربوطة بهذا التقرير — تُجمَّد قائمتها في اللقطة (§B/§F) */
export async function instanceAttachments(instanceId: string): Promise<SnapshotAttachment[]> {
  const links = await db
    .select({ evidenceId: evidenceLinks.evidenceId })
    .from(evidenceLinks)
    .where(and(eq(evidenceLinks.entityType, "report_instance"), eq(evidenceLinks.entityId, instanceId)));
  if (links.length === 0) return [];
  const items = await db
    .select({ id: evidenceItems.id, title: evidenceItems.title, fileId: evidenceItems.fileId })
    .from(evidenceItems)
    .where(inArray(evidenceItems.id, links.map((l) => l.evidenceId)));
  return items
    .filter((i) => i.fileId !== null)
    .map((i) => ({ fileId: i.fileId!, name: i.title, source: "شاهد مرفق بالتقرير" }));
}

/**
 * حلّ إعداد القالب (D-058): الصريح ← افتراضي النوع من الإعدادات ← قالب تعريف النوع.
 * المفتاح الأساسي يُحلّ من الشيفرة، ومعرّف النسخة المخصصة يُقرأ صفّه ويُطهَّر إعداده.
 */
export async function resolveTemplate(templateKey: string | undefined, typeKey: string) {
  const key = await resolveTemplateKey(templateKey, typeKey);
  if (isBaseTemplateKey(key)) return { templateKey: key, style: resolveStyleConfig(key) };
  const [row] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, key));
  if (!row || row.archivedAt) return { templateKey: key, style: resolveStyleConfig(key) };
  return { templateKey: key, style: resolveStyleConfig(row.baseKey, row.config) };
}

export async function buildSnapshot(opts: {
  instanceId?: string;
  typeKey: string;
  title: string;
  storedFilters: unknown;
  storedOptions: unknown;
  periodFrom: string | null;
  periodTo: string | null;
  viewer: Viewer;
}): Promise<SnapshotDoc> {
  const typeDef = instanceTypeByKey(opts.typeKey);
  if (!typeDef) throw new Error("نوع تقرير غير معروف");
  const options = parseInstanceOptions(opts.storedOptions);
  const showEmpty = options.showEmpty === true;

  // الأقسام: الترتيب المحفوظ ثم اللاحق بالافتراضي، مع إسقاط المخفي عمداً
  const declared = sectionsOf(opts.typeKey, options);
  const hidden = new Set(options.hiddenSections ?? []);
  const order = options.sectionOrder ?? [];
  const ordered = [
    ...order.map((k) => declared.find((s) => s.key === k)).filter((s): s is InstanceSectionDef => !!s),
    ...declared.filter((s) => !order.includes(s.key)),
  ].filter((s) => !hidden.has(s.key));

  if (ordered.length === 0) throw new Error("لا قسم ظاهراً في هذا التقرير — أظهر قسماً واحداً على الأقل");

  const period = { from: opts.periodFrom, to: opts.periodTo };
  const sections: SnapshotSection[] = [];
  for (const section of ordered) {
    const def = reportByKey(section.reportKey);
    if (!def) continue;
    if (!opts.viewer.permissions.has(def.permission)) throw new SnapshotPermissionError(def.label);

    const filters = sectionFilters(section, opts.storedFilters, options, period);
    const { rows, truncated } = await runReportForExport(section.reportKey, filters);
    const maps = await loadFilterLabelMaps(filters);
    const filterLines = filterHeaderLines(filters, maps);
    // v2.5.0 §7.5: تقرير يعلن حد الأداء المنخفض تذكر ترويسته الحد دائماً
    if (def.filters?.includes("lowThreshold")) filterLines.push(lowThresholdHeaderLine(filters));

    const columns = visibleColumns(def, filters, rows, showEmpty);
    sections.push({
      key: section.key,
      reportKey: section.reportKey,
      label: section.labelAr ?? def.label,
      columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rows,
      total: rows.length,
      truncated,
      filterLines,
      empty: rows.length === 0,
    });
  }

  // القسم الفارغ يُخفى تلقائياً — ويبقى مذكوراً عند «إظهار الفارغ» (§A)
  const visibleSections = showEmpty ? sections : sections.filter((s) => !s.empty);
  const finalSections = visibleSections.length > 0 ? visibleSections : sections;

  const identity = await getDocumentIdentity();
  const resolved = resolveHeader(identity, {}, options.identityOverrides ?? {});
  const { templateKey, style } = await resolveTemplate(options.templateKey, opts.typeKey);

  const attachments =
    options.attachmentsList !== false && opts.instanceId ? await instanceAttachments(opts.instanceId) : [];

  const generatedAtIso = new Date().toISOString();
  const periodText =
    opts.periodFrom || opts.periodTo
      ? `${opts.periodFrom ? dualNumericCell(opts.periodFrom) : "البداية"} ← ${opts.periodTo ? dualNumericCell(opts.periodTo) : "النهاية"}`
      : null;

  return {
    version: 1,
    typeKey: opts.typeKey,
    typeLabel: typeDef.labelAr,
    title: opts.title.trim() || typeDef.labelAr,
    periodFrom: opts.periodFrom,
    periodTo: opts.periodTo,
    periodText,
    generatedAtIso,
    generatedAtText: dualNumericCell(todayIso()),
    sections: finalSections,
    identity: {
      orgLines: resolved.orgLines,
      schoolName: resolved.schoolName,
      principalName: resolved.principalName,
      principalTitle: resolved.principalTitle,
      academicYear: resolved.academicYear,
      headerNote: resolved.headerNote,
      footerNote: resolved.footerNote,
      contactInfo: options.identityOverrides?.contactInfo ?? resolved.contactInfo ?? "",
      ministryLogoFileId: resolved.ministryLogoFileId,
      schoolLogoFileId: resolved.schoolLogoFileId,
    },
    style: style as unknown as Record<string, unknown>,
    templateKey,
    showEmpty,
    attachments,
    stats: {
      sectionCount: finalSections.length,
      totalRows: finalSections.reduce((n, s) => n + s.total, 0),
    },
  };
}

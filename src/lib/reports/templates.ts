import "server-only";
import { asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { reportTemplates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { reportByKey, isSortableColumn, isGroupableColumn } from "./catalog";
import {
  parseReportFilters,
  serializeReportFilters,
  filtersToStored,
  storedToParams,
  isReportMode,
  type ReportFilters,
} from "./filters";

/**
 * قوالب التقارير المحفوظة (v2.5.0 §4.5) — الطبقة الخادمية.
 *
 * ── الحارس المركزي ──────────────────────────────────────────────────────────
 * القالب **لا يمنح شيئاً**. كل قراءة وكل تشغيل يفحصان صلاحية **التقرير المصدر** كما لو
 * فُتح من مركز التقارير مباشرةً. فقالب مشترك لتقرير أداء فردي لا يظهر ولا يعمل لمن لا
 * يملك `performance.individual.read`. هذا هو الفرق بين «مشاركة إعداد» و«مشاركة بيانات».
 *
 * ── التطهير عند الحدود ─────────────────────────────────────────────────────
 * ما يُحفظ في `filters` هو ناتج المحلّل المُقيَّد بالقوائم البيضاء، وما يُقرأ منه يمرّ
 * بالمحلّل نفسه مرة أخرى. فحتى لو عُدِّل صفّ القالب في القاعدة مباشرةً بعمود ترتيب
 * ملفَّق أو باسم عمود غير معلَن، لا يصل شيء من ذلك إلى استعلام.
 */

export const TEMPLATE_VISIBILITY = ["خاص", "مشترك", "عام"] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITY)[number];

export function isTemplateVisibility(value: string): value is TemplateVisibility {
  return (TEMPLATE_VISIBILITY as readonly string[]).includes(value);
}

/** أقصى طول لاسم القالب ووصفه — يمنع اسماً يفسد تخطيط القائمة أو ترويسة التقرير */
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_DESCRIPTION_MAX = 300;

export type SavedTemplate = {
  id: string;
  name: string;
  description: string | null;
  reportKey: string;
  reportLabel: string;
  filters: ReportFilters;
  columns: string[];
  sortKey: string | null;
  sortDir: "asc" | "desc" | null;
  groupKey: string | null;
  mode: string | null;
  outputFormat: string | null;
  visibility: TemplateVisibility;
  ownerUserId: string | null;
  isOwner: boolean;
  canEdit: boolean;
  updatedAt: Date;
};

type Viewer = { id: string; permissions: Set<string> };

/**
 * القوالب التي يجوز لهذا المستخدم رؤيتها.
 *
 * الشرطان يجتمعان: (١) الظهور — خاص لصاحبه، أو مشترك/عام؛ و(٢) صلاحية التقرير المصدر.
 * القالب المرتبط بمفتاح تقرير لم يعد موجوداً في السجل (حُذف التقرير في إصدار لاحق)
 * يُسقَط من القائمة بدل عرضه كسطر معطوب.
 */
export async function listTemplates(viewer: Viewer): Promise<SavedTemplate[]> {
  const rows = await db
    .select()
    .from(reportTemplates)
    .where(
      or(
        eq(reportTemplates.ownerUserId, viewer.id),
        sql`${reportTemplates.visibility} in ('مشترك', 'عام')`,
      ),
    )
    .orderBy(asc(reportTemplates.name));

  return rows.flatMap((row) => {
    const def = reportByKey(row.reportKey);
    if (!def) return [];
    if (!viewer.permissions.has(def.permission)) return [];
    return [toSaved(row, def.label, viewer)];
  });
}

/** قالب واحد — يعيد `null` لغير المخوَّل بدل كشف وجوده */
export async function getTemplate(templateId: string, viewer: Viewer): Promise<SavedTemplate | null> {
  const [row] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, templateId));
  if (!row) return null;
  const def = reportByKey(row.reportKey);
  if (!def || !viewer.permissions.has(def.permission)) return null;
  const visible = row.ownerUserId === viewer.id || row.visibility === "مشترك" || row.visibility === "عام";
  if (!visible) return null;
  return toSaved(row, def.label, viewer);
}

function toSaved(row: typeof reportTemplates.$inferSelect, reportLabel: string, viewer: Viewer): SavedTemplate {
  const def = reportByKey(row.reportKey);
  // إعادة التطهير عند القراءة — الصفّ المخزَّن ليس مصدر ثقة
  const filters = parseReportFilters(storedToParams(row.filters), {
    allowedSort: (k) => isSortableColumn(row.reportKey, k),
    allowedColumns: def?.columns.map((c) => c.key),
  });
  const allowedColumns = new Set(def?.columns.map((c) => c.key) ?? []);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    reportKey: row.reportKey,
    reportLabel,
    filters,
    columns: (row.columns ?? []).filter((c) => allowedColumns.has(c)),
    sortKey: row.sortKey && isSortableColumn(row.reportKey, row.sortKey) ? row.sortKey : null,
    sortDir: row.sortDir === "desc" ? "desc" : row.sortDir === "asc" ? "asc" : null,
    groupKey: row.groupKey && isGroupableColumn(row.reportKey, row.groupKey) ? row.groupKey : null,
    mode: row.mode && isReportMode(row.mode) ? row.mode : null,
    outputFormat: row.outputFormat,
    visibility: isTemplateVisibility(row.visibility) ? row.visibility : "خاص",
    ownerUserId: row.ownerUserId,
    isOwner: row.ownerUserId === viewer.id,
    canEdit: canEditTemplate(row, viewer),
    updatedAt: row.updatedAt,
  };
}

/**
 * من يعدّل القالب؟ صاحبه دائماً. القالب **العام** يديره من يملك
 * `reports.templates.global` — لأنه يظهر للجميع فلا يُترك تعديله لصاحبه وحده وقد يكون
 * غادر. القالب **المشترك** يبقى بيد صاحبه: المشاركة ليست تنازلاً عن الملكية (§16).
 */
function canEditTemplate(row: typeof reportTemplates.$inferSelect, viewer: Viewer): boolean {
  if (row.ownerUserId === viewer.id) return true;
  if (row.visibility === "عام" && viewer.permissions.has("reports.templates.global")) return true;
  return false;
}

/** الظهور المسموح لهذا المستخدم — «مشترك» و«عام» يحتاجان صلاحيتهما */
export function allowedVisibilities(viewer: Viewer): TemplateVisibility[] {
  const out: TemplateVisibility[] = ["خاص"];
  if (viewer.permissions.has("reports.templates.share")) out.push("مشترك");
  if (viewer.permissions.has("reports.templates.global")) out.push("عام");
  return out;
}

export type TemplateInput = {
  name: string;
  description?: string;
  reportKey: string;
  filters: ReportFilters;
  columns: string[];
  visibility: string;
  outputFormat?: string;
};

export type TemplateResult = { error?: string; success?: string; templateId?: string };

/** تحقّق مشترك للإنشاء والتعديل — يعيد الرسالة العربية الأولى أو القيم المُطهَّرة */
function validate(input: TemplateInput, viewer: Viewer):
  | { error: string }
  | { value: { name: string; description: string | null; def: NonNullable<ReturnType<typeof reportByKey>>; visibility: TemplateVisibility; columns: string[] } } {
  const name = input.name.trim();
  if (name.length === 0) return { error: "اسم القالب إلزامي" };
  if (name.length > TEMPLATE_NAME_MAX) return { error: `اسم القالب أطول من ${TEMPLATE_NAME_MAX} حرفاً` };
  const description = (input.description ?? "").trim().slice(0, TEMPLATE_DESCRIPTION_MAX) || null;

  const def = reportByKey(input.reportKey);
  if (!def) return { error: "تقرير غير معروف" };
  if (!viewer.permissions.has(def.permission)) return { error: "لا تملك صلاحية هذا التقرير" };

  if (!isTemplateVisibility(input.visibility)) return { error: "نطاق المشاركة غير صحيح" };
  if (!allowedVisibilities(viewer).includes(input.visibility)) {
    return { error: `لا تملك صلاحية حفظ قالب بنطاق «${input.visibility}»` };
  }

  const allowed = new Set(def.columns.map((c) => c.key));
  const columns = [...new Set(input.columns)].filter((c) => allowed.has(c));
  return { value: { name, description, def, visibility: input.visibility, columns } };
}

export async function createTemplate(input: TemplateInput, viewer: Viewer): Promise<TemplateResult> {
  const checked = validate(input, viewer);
  if ("error" in checked) return checked;
  const { name, description, def, visibility, columns } = checked.value;

  const [row] = await db
    .insert(reportTemplates)
    .values({
      name,
      description,
      reportKey: def.key,
      filters: filtersToStored(input.filters),
      columns,
      sortKey: input.filters.sort ?? null,
      sortDir: input.filters.dir ?? null,
      groupKey: input.filters.group ?? null,
      mode: input.filters.mode ?? null,
      outputFormat: input.outputFormat ?? null,
      visibility,
      ownerUserId: viewer.id,
      createdBy: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await audit({
    actorId: viewer.id,
    action: "report_template.created",
    entityType: "report_template",
    entityId: row.id,
    summary: `إنشاء قالب تقرير «${name}» على «${def.label}» — نطاق ${visibility}`,
    detail: { reportKey: def.key, visibility, columns: columns.length },
  });
  return { success: `حُفظ القالب «${name}»`, templateId: row.id };
}

export async function updateTemplate(templateId: string, input: TemplateInput, viewer: Viewer): Promise<TemplateResult> {
  const [existing] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, templateId));
  if (!existing) return { error: "القالب غير موجود" };
  if (!canEditTemplate(existing, viewer)) return { error: "لا تملك صلاحية تعديل هذا القالب" };

  const checked = validate(input, viewer);
  if ("error" in checked) return checked;
  const { name, description, def, visibility, columns } = checked.value;

  await db
    .update(reportTemplates)
    .set({
      name,
      description,
      reportKey: def.key,
      filters: filtersToStored(input.filters),
      columns,
      sortKey: input.filters.sort ?? null,
      sortDir: input.filters.dir ?? null,
      groupKey: input.filters.group ?? null,
      mode: input.filters.mode ?? null,
      outputFormat: input.outputFormat ?? null,
      visibility,
      updatedBy: viewer.id,
      updatedAt: new Date(),
    })
    .where(eq(reportTemplates.id, templateId));

  await audit({
    actorId: viewer.id,
    action: "report_template.updated",
    entityType: "report_template",
    entityId: templateId,
    summary: `تعديل قالب تقرير «${name}»`,
    detail: {
      before: { name: existing.name, visibility: existing.visibility, reportKey: existing.reportKey },
      after: { name, visibility, reportKey: def.key },
    },
  });
  return { success: `حُدّث القالب «${name}»` };
}

/** نسخ قالب — النسخة **خاصة دائماً** بصاحبها الجديد، فلا تتسع المشاركة بالنسخ */
export async function duplicateTemplate(templateId: string, viewer: Viewer): Promise<TemplateResult> {
  const source = await getTemplate(templateId, viewer);
  if (!source) return { error: "القالب غير موجود" };

  const [row] = await db
    .insert(reportTemplates)
    .values({
      name: `${source.name} — نسخة`.slice(0, TEMPLATE_NAME_MAX),
      description: source.description,
      reportKey: source.reportKey,
      filters: filtersToStored(source.filters),
      columns: source.columns,
      sortKey: source.sortKey,
      sortDir: source.sortDir,
      groupKey: source.groupKey,
      mode: source.mode,
      outputFormat: source.outputFormat,
      visibility: "خاص",
      ownerUserId: viewer.id,
      createdBy: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await audit({
    actorId: viewer.id,
    action: "report_template.duplicated",
    entityType: "report_template",
    entityId: row.id,
    summary: `نسخ قالب تقرير من «${source.name}»`,
    detail: { sourceTemplateId: templateId },
  });
  return { success: "أُنشئت نسخة خاصة من القالب", templateId: row.id };
}

/**
 * حذف قالب — **لا يمسّ أي بيانات ولا أي تقرير صدر منه** (§4.5).
 * القالب وصفة؛ الوثائق الصادرة لقطات مستقلة في `documents` ولا مرجع لها هنا.
 */
export async function deleteTemplate(templateId: string, viewer: Viewer): Promise<TemplateResult> {
  const [existing] = await db.select().from(reportTemplates).where(eq(reportTemplates.id, templateId));
  if (!existing) return { error: "القالب غير موجود" };
  if (!canEditTemplate(existing, viewer)) return { error: "لا تملك صلاحية حذف هذا القالب" };

  await db.delete(reportTemplates).where(eq(reportTemplates.id, templateId));
  await audit({
    actorId: viewer.id,
    action: "report_template.deleted",
    entityType: "report_template",
    entityId: templateId,
    summary: `حذف قالب تقرير «${existing.name}» — لا أثر على البيانات ولا على التقارير الصادرة`,
    detail: { reportKey: existing.reportKey, visibility: existing.visibility },
  });
  return { success: `حُذف القالب «${existing.name}»` };
}

/** رابط تشغيل القالب في مركز التقارير — بمرشّحاته وأعمدته كما حُفظت */
export function templateRunHref(template: SavedTemplate): string {
  const def = reportByKey(template.reportKey);
  const sp = serializeReportFilters(template.filters);
  sp.set("category", def?.category ?? "");
  sp.set("report", template.reportKey);
  for (const c of template.columns) sp.append("col", c);
  sp.set("template", template.id);
  return `/reports?${sp.toString()}`;
}

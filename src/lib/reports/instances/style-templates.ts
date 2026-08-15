import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { reportStyleTemplates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { isUuid } from "@/lib/validation";
import {
  BASE_TEMPLATES,
  baseTemplateByKey,
  isBaseTemplateKey,
  resolveStyleConfig,
  styleConfigSchema,
  type StyleConfig,
} from "./base-templates";
import { INSTANCE_TYPES, instanceTypeByKey } from "./types";

/**
 * القوالب المخصصة ودورة حياتها (v2.6 §E — D-058).
 *
 * القوالب **الأساسية** الخمسة سجلّ في الشيفرة: لا تُحذف ولا تُعدَّل ولا تُؤرشف بالبناء،
 * لأنها ليست صفوفاً أصلاً. المخصص نسخةٌ عنها في `report_style_templates` تحمل مفتاح
 * أصلها وإعداداً **مُقيَّداً بالمخطط الصارم** — لا HTML ولا CSS حرّين، بل حقول معدودة
 * (لونان، غلاف، فهرس، مربع اعتماد، نصّا ترويسة وتذييل، كثافة).
 *
 * لا دالة حذف: الأرشفة هي الطريق الوحيد (D-058 «محمي من التعديل التدميري»)، فالتقارير
 * التي أشارت إلى قالب لا تفقد مرجعها — والمعتمدة منها تحمل إعدادها مجمّداً في لقطتها
 * أصلاً فلا يمسّها شيء.
 */

export const STYLE_NAME_MAX = 80;

type Viewer = { id: string; permissions: Set<string> };
export type StyleResult = { error?: string; success?: string; templateId?: string };

export type StyleTemplateRow = {
  id: string;
  name: string;
  baseKey: string;
  baseLabel: string;
  config: StyleConfig;
  archived: boolean;
};

/** إعداد القالب الأساسي الافتراضي حين يغيب مفتاحه أو يكون مجهولاً */
const FALLBACK_BASE = BASE_TEMPLATES[0].key;

function toRow(row: typeof reportStyleTemplates.$inferSelect): StyleTemplateRow {
  return {
    id: row.id,
    name: row.name,
    baseKey: row.baseKey,
    baseLabel: baseTemplateByKey(row.baseKey)?.labelAr ?? row.baseKey,
    // التطهير عند القراءة: الصفّ المخزَّن ليس مصدر ثقة (سياسة v2.5.0)
    config: resolveStyleConfig(row.baseKey, row.config),
    archived: row.archivedAt !== null,
  };
}

export async function listStyleTemplates(opts?: { includeArchived?: boolean }): Promise<StyleTemplateRow[]> {
  const rows = await db
    .select()
    .from(reportStyleTemplates)
    .where(opts?.includeArchived ? undefined : isNull(reportStyleTemplates.archivedAt))
    .orderBy(asc(reportStyleTemplates.name));
  return rows.map(toRow);
}

export async function getStyleTemplate(id: string): Promise<StyleTemplateRow | null> {
  // مفتاح ليس UUID لا يصل إلى الاستعلام: تمريره كان يُلقي خطأ تحويل من القاعدة بدل أن
  // يسقط إلى القالب التالي — فيسقط عرض المسودة كله بسبب مفتاح قالب قديم أو ملفَّق.
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, id));
  return row ? toRow(row) : null;
}

function validateName(name: string): { error: string } | { name: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { error: "اسم القالب إلزامي" };
  if (trimmed.length > STYLE_NAME_MAX) return { error: `اسم القالب أطول من ${STYLE_NAME_MAX} حرفاً` };
  return { name: trimmed };
}

/** نسخة مخصصة من قالب أساسي — الأساس يبقى كما هو دائماً */
export async function createStyleTemplate(
  input: { name: string; baseKey: string; config?: unknown },
  viewer: Viewer,
): Promise<StyleResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  if (!isBaseTemplateKey(input.baseKey)) return { error: "القالب الأساسي غير معروف" };
  const checked = validateName(input.name);
  if ("error" in checked) return checked;

  // يُخزَّن الإعداد **بعد** الحلّ والتطهير، فلا يدخل الجدول مفتاح غريب ولا لون ملفَّق
  const config = resolveStyleConfig(input.baseKey, input.config);
  const [row] = await db
    .insert(reportStyleTemplates)
    .values({
      name: checked.name,
      baseKey: input.baseKey,
      config: config as unknown as Record<string, unknown>,
      createdBy: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await audit({
    actorId: viewer.id,
    action: "report_style_template.created",
    entityType: "report_style_template",
    entityId: row.id,
    summary: `إنشاء نسخة قالب «${checked.name}» من الأساسي «${baseTemplateByKey(input.baseKey)?.labelAr}»`,
    detail: { baseKey: input.baseKey },
  });
  return { success: `أُنشئت النسخة «${checked.name}»`, templateId: row.id };
}

export async function updateStyleTemplate(
  id: string,
  input: { name: string; config?: unknown },
  viewer: Viewer,
): Promise<StyleResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const [existing] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, id));
  if (!existing) return { error: "القالب غير موجود" };
  const checked = validateName(input.name);
  if ("error" in checked) return checked;

  const config = resolveStyleConfig(existing.baseKey, input.config);
  await db
    .update(reportStyleTemplates)
    .set({
      name: checked.name,
      config: config as unknown as Record<string, unknown>,
      updatedBy: viewer.id,
      updatedAt: new Date(),
    })
    .where(eq(reportStyleTemplates.id, id));

  await audit({
    actorId: viewer.id,
    action: "report_style_template.updated",
    entityType: "report_style_template",
    entityId: id,
    summary: `تعديل نسخة القالب «${checked.name}»`,
    detail: { before: { name: existing.name }, after: { name: checked.name } },
  });
  return { success: `حُدّثت النسخة «${checked.name}»` };
}

export async function archiveStyleTemplate(id: string, viewer: Viewer): Promise<StyleResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const [existing] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, id));
  if (!existing) return { error: "القالب غير موجود" };
  if (existing.archivedAt) return { error: "القالب مؤرشف فعلاً" };
  await db
    .update(reportStyleTemplates)
    .set({ archivedAt: new Date(), archivedBy: viewer.id, updatedBy: viewer.id, updatedAt: new Date() })
    .where(eq(reportStyleTemplates.id, id));
  await audit({
    actorId: viewer.id,
    action: "report_style_template.archived",
    entityType: "report_style_template",
    entityId: id,
    summary: `أرشفة نسخة القالب «${existing.name}» — التقارير المعتمدة تحمل إعدادها مجمّداً فلا تتأثر`,
  });
  return { success: `أُرشفت النسخة «${existing.name}»` };
}

export async function restoreStyleTemplate(id: string, viewer: Viewer): Promise<StyleResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const [existing] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, id));
  if (!existing) return { error: "القالب غير موجود" };
  if (!existing.archivedAt) return { error: "القالب غير مؤرشف" };
  await db
    .update(reportStyleTemplates)
    .set({ archivedAt: null, archivedBy: null, updatedBy: viewer.id, updatedAt: new Date() })
    .where(eq(reportStyleTemplates.id, id));
  await audit({
    actorId: viewer.id,
    action: "report_style_template.restored",
    entityType: "report_style_template",
    entityId: id,
    summary: `استعادة نسخة القالب «${existing.name}»`,
  });
  return { success: `استُعيدت النسخة «${existing.name}»` };
}

/* ─────────────────────── الاختيارات والافتراضي لكل نوع ─────────────────────── */

export type TemplateChoice = { key: string; label: string; isBase: boolean };

/** الخيارات المعروضة عند الإنشاء وتحرير المسودة: الأساسية + النسخ غير المؤرشفة */
export async function templateChoices(): Promise<TemplateChoice[]> {
  const custom = await listStyleTemplates();
  return [
    ...BASE_TEMPLATES.map((t) => ({ key: t.key, label: t.labelAr, isBase: true })),
    ...custom.map((c) => ({ key: c.id, label: `${c.name} (نسخة من ${c.baseLabel})`, isBase: false })),
  ];
}

const DEFAULTS_KEY = "reports.default_templates";

/** القالب الافتراضي لكل نوع تقرير — إعداد لا هجرة (جدول `settings` مفتاح/قيمة) */
export async function getDefaultTemplates(): Promise<Record<string, string>> {
  const stored = await getSetting<Record<string, string> | null>(DEFAULTS_KEY, null);
  if (!stored || typeof stored !== "object") return {};
  const out: Record<string, string> = {};
  for (const [typeKey, templateKey] of Object.entries(stored)) {
    if (typeof templateKey === "string" && instanceTypeByKey(typeKey)) out[typeKey] = templateKey;
  }
  return out;
}

export async function setDefaultTemplate(typeKey: string, templateKey: string, viewer: Viewer): Promise<StyleResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const type = instanceTypeByKey(typeKey);
  if (!type) return { error: "نوع تقرير غير معروف" };
  if (!isBaseTemplateKey(templateKey)) {
    const custom = await getStyleTemplate(templateKey);
    if (!custom || custom.archived) return { error: "القالب المختار غير موجود أو مؤرشف" };
  }
  const current = await getDefaultTemplates();
  await setSetting(DEFAULTS_KEY, { ...current, [typeKey]: templateKey }, viewer.id);
  await audit({
    actorId: viewer.id,
    action: "report_style_template.default_set",
    entityType: "report_style_template",
    entityId: templateKey,
    summary: `تعيين القالب الافتراضي لنوع «${type.labelAr}»`,
    detail: { typeKey, templateKey, previous: current[typeKey] ?? null },
  });
  return { success: `حُدّد القالب الافتراضي لنوع «${type.labelAr}»` };
}

/**
 * ترتيب حلّ القالب لتقرير ما (D-058):
 *   1. `options.templateKey` الصريح للتقرير،
 *   2. الافتراضي المحدَّد لنوعه في الإعدادات،
 *   3. القالب المعلَن في تعريف النوع.
 * أي مفتاح مجهول أو مؤرشف يسقط إلى ما بعده — فلا يفشل بناء تقرير بسبب قالب اختفى.
 */
export async function resolveTemplateKey(explicit: string | undefined, typeKey: string): Promise<string> {
  const typeDefault = instanceTypeByKey(typeKey)?.defaultTemplateKey ?? FALLBACK_BASE;
  const candidates = [explicit, (await getDefaultTemplates())[typeKey], typeDefault];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isBaseTemplateKey(candidate)) return candidate;
    const custom = await getStyleTemplate(candidate);
    if (custom && !custom.archived) return candidate;
  }
  return FALLBACK_BASE;
}

/** كل الأنواع مع قوالبها الافتراضية الفعلية — لشاشة الإعدادات */
export async function defaultsOverview(): Promise<{ typeKey: string; typeLabel: string; templateKey: string }[]> {
  const defaults = await getDefaultTemplates();
  return INSTANCE_TYPES.map((t) => ({
    typeKey: t.key,
    typeLabel: t.labelAr,
    templateKey: defaults[t.key] ?? t.defaultTemplateKey,
  }));
}

export { styleConfigSchema };

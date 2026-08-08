import "server-only";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { reportStyleTemplates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import {
  BASE_TEMPLATES,
  baseTemplateByKey,
  isBaseTemplateKey,
  resolveStyleConfig,
  type StyleConfig,
} from "./base-templates";
import { instanceTypeByKey, INSTANCE_TYPES } from "./types";

/**
 * دورة حياة النسخ المخصصة من قوالب الإخراج (v2.6 §E — D-058) — الطبقة الخادمية.
 *
 * ── الأساس محمي بالبناء، والنسخة تُؤرشف ولا تُحذف ─────────────────────────────
 * القوالب الأساسية الخمسة سجلّ نقي في الشيفرة (`base-templates`) فلا تُحذف ولا تُعدَّل
 * تدميرياً لأنها ليست صفوفاً. النسخة المخصصة صفّ في `report_style_templates` — ولا دالة
 * حذف هنا **عمداً**: الأرشفة تحويل حالة قابل للاستعادة، فتقرير معتمد جمّد قالبه في لقطته
 * لا يتأثر، ومسودة تشير إلى قالب مؤرشف تسقط إلى الافتراضي بدل أن تنكسر.
 *
 * ── التطهير عند الحدود ─────────────────────────────────────────────────────
 * ما يُحفظ في `config` هو ناتج `resolveStyleConfig` كاملاً بعد المخطط الصارم — لا فرق
 * حر. وما يُقرأ يمرّ بالحلّ نفسه مرة أخرى، فالصفّ المخزَّن ليس مصدر ثقة (سياسة v2.5.0).
 */

type Viewer = { id: string; permissions: Set<string> };

export type StyleTemplateResult = { error?: string; success?: string; templateId?: string };

export const STYLE_NAME_MAX = 80;

/** مفتاح إعداد القالب الافتراضي لكل نوع تقرير — `Record<typeKey, templateKey>` */
const DEFAULTS_KEY = "reports.default_templates";

/** شكل uuid — يمنع مقارنة نص حر بعمود uuid فتفشل القراءة كلها بدل أن يسقط المفتاح */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StyleTemplateRow = {
  id: string;
  name: string;
  baseKey: string;
  /** تسمية القالب الأساسي المنسوخ منه — للعرض */
  baseLabel: string;
  /** الإعداد الكامل محلولاً ومُطهَّراً — لا فرقاً خاماً */
  config: StyleConfig;
  archived: boolean;
  updatedAt: Date;
};

function toRow(row: typeof reportStyleTemplates.$inferSelect): StyleTemplateRow {
  return {
    id: row.id,
    name: row.name,
    baseKey: row.baseKey,
    baseLabel: baseTemplateByKey(row.baseKey)?.labelAr ?? row.baseKey,
    // إعادة التطهير عند القراءة — الصفّ المخزَّن ليس مصدر ثقة
    config: resolveStyleConfig(row.baseKey, row.config),
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt,
  };
}

/** كل النسخ المخصصة بتسميات أساسها — المؤرشف يُستبعد ما لم يُطلب صراحةً */
export async function listStyleTemplates(opts?: { includeArchived?: boolean }): Promise<StyleTemplateRow[]> {
  const rows = await db.select().from(reportStyleTemplates).orderBy(asc(reportStyleTemplates.name));
  return rows.filter((r) => (opts?.includeArchived ? true : r.archivedAt === null)).map(toRow);
}

export type StyleTemplateInput = { name: string; baseKey: string; config?: unknown };

/** تحقّق الاسم المشترك للإنشاء والتعديل — الرسالة العربية الأولى أو الاسم المشذَّب */
function validName(raw: string): { error: string } | { name: string } {
  const name = raw.trim();
  if (name.length === 0) return { error: "اسم القالب إلزامي" };
  if (name.length > STYLE_NAME_MAX) return { error: `اسم القالب أطول من ${STYLE_NAME_MAX} حرفاً` };
  return { name };
}

export async function createStyleTemplate(input: StyleTemplateInput, viewer: Viewer): Promise<StyleTemplateResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const checked = validName(input.name);
  if ("error" in checked) return checked;
  const base = baseTemplateByKey(input.baseKey);
  if (!base) return { error: "القالب الأساسي غير معروف — النسخ من القوالب الخمسة المعتمدة فقط" };

  // الفرق الملفَّق يسقط كله ويبقى الأساس — ما يُخزَّن هو الإعداد الكامل بعد المخطط الصارم
  const config = resolveStyleConfig(base.key, input.config);

  const [row] = await db
    .insert(reportStyleTemplates)
    .values({
      name: checked.name,
      baseKey: base.key,
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
    summary: `إنشاء نسخة مخصصة «${checked.name}» من القالب الأساسي «${base.labelAr}»`,
    detail: { baseKey: base.key },
  });
  return { success: `حُفظت النسخة المخصصة «${checked.name}»`, templateId: row.id };
}

export async function updateStyleTemplate(
  id: string,
  input: { name: string; config?: unknown },
  viewer: Viewer,
): Promise<StyleTemplateResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const [existing] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, id));
  if (!existing) return { error: "القالب غير موجود" };
  const checked = validName(input.name);
  if ("error" in checked) return checked;

  // التحقق نفسه على أساس الصفّ ذاته — الأساس لا يتبدّل بالتعديل
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
    summary: `تعديل النسخة المخصصة «${checked.name}»`,
    detail: { before: { name: existing.name }, after: { name: checked.name }, baseKey: existing.baseKey },
  });
  return { success: `حُدّثت النسخة المخصصة «${checked.name}»`, templateId: id };
}

/**
 * أرشفة نسخة مخصصة — **لا حذف في هذه الخدمة أصلاً** (D-058). المؤرشف يخرج من قوائم
 * الاختيار فقط: التقرير المعتمد جمّد قالبه في لقطته فلا يتأثر، والمسودة التي تشير إليه
 * تسقط إلى الافتراضي عند البناء (`snapshot.resolveTemplate`).
 */
export async function archiveStyleTemplate(id: string, viewer: Viewer): Promise<StyleTemplateResult> {
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
    summary: `أرشفة النسخة المخصصة «${existing.name}» — التقارير المعتمدة بها لا تتأثر`,
    detail: { baseKey: existing.baseKey },
  });
  return { success: `أُرشفت النسخة «${existing.name}» — تقارير اعتمدتها تبقى كما جُمّدت` };
}

export async function restoreStyleTemplate(id: string, viewer: Viewer): Promise<StyleTemplateResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const [existing] = await db.select().from(reportStyleTemplates).where(eq(reportStyleTemplates.id, id));
  if (!existing) return { error: "القالب غير موجود" };
  if (!existing.archivedAt) return { error: "القالب ليس مؤرشفاً" };

  await db
    .update(reportStyleTemplates)
    .set({ archivedAt: null, archivedBy: null, updatedBy: viewer.id, updatedAt: new Date() })
    .where(eq(reportStyleTemplates.id, id));

  await audit({
    actorId: viewer.id,
    action: "report_style_template.restored",
    entityType: "report_style_template",
    entityId: id,
    summary: `استعادة النسخة المخصصة «${existing.name}» من الأرشيف`,
  });
  return { success: `استُعيدت النسخة «${existing.name}»` };
}

/* ─────────────────── القالب الافتراضي لكل نوع تقرير ─────────────────── */

/**
 * قراءة الافتراضيات المخزَّنة مُطهَّرةً: مفتاح نوع غير معروف أو قيمة ليست نصاً يسقطان
 * وحدهما — صفّ إعدادات معطوب جزئياً لا يعطّل بقية الأنواع.
 */
export async function getDefaultTemplates(): Promise<Record<string, string>> {
  const stored = await getSetting<Record<string, unknown> | null>(DEFAULTS_KEY, null);
  if (!stored || typeof stored !== "object") return {};
  const out: Record<string, string> = {};
  for (const [typeKey, templateKey] of Object.entries(stored)) {
    if (!instanceTypeByKey(typeKey)) continue;
    if (typeof templateKey !== "string" || templateKey.length === 0) continue;
    out[typeKey] = templateKey;
  }
  return out;
}

/**
 * تعيين القالب الافتراضي لنوع تقرير: مفتاح أساسي أو معرّف نسخة مخصصة غير مؤرشفة.
 * القيمة الفارغة تمسح التعيين فيعود النوع إلى قالبه المعلَن في سجله.
 */
export async function setDefaultTemplate(typeKey: string, templateKey: string, viewer: Viewer): Promise<StyleTemplateResult> {
  if (!viewer.permissions.has("reports.builder")) return { error: "لا تملك صلاحية إدارة قوالب الإخراج" };
  const typeDef = instanceTypeByKey(typeKey);
  if (!typeDef) return { error: "نوع تقرير غير معروف" };

  const key = templateKey.trim();
  let label: string;
  if (key === "") {
    label = `افتراضي النوع (${baseTemplateByKey(typeDef.defaultTemplateKey)?.labelAr ?? typeDef.defaultTemplateKey})`;
  } else if (isBaseTemplateKey(key)) {
    label = baseTemplateByKey(key)!.labelAr;
  } else {
    if (!UUID_RE.test(key)) return { error: "القالب المختار غير معروف" };
    const [row] = await db
      .select()
      .from(reportStyleTemplates)
      .where(eq(reportStyleTemplates.id, key));
    if (!row) return { error: "القالب المختار غير موجود" };
    if (row.archivedAt) return { error: "القالب المختار مؤرشف — استعده أولاً أو اختر غيره" };
    label = row.name;
  }

  const current = await getDefaultTemplates();
  const next = { ...current };
  if (key === "") delete next[typeKey];
  else next[typeKey] = key;
  await setSetting(DEFAULTS_KEY, next, viewer.id);

  await audit({
    actorId: viewer.id,
    action: "report_style_template.default_set",
    entityType: "report_style_template",
    entityId: key || undefined,
    summary: `تعيين القالب الافتراضي لنوع «${typeDef.labelAr}»: ${label}`,
    detail: { typeKey, templateKey: key || null, previous: current[typeKey] ?? null },
  });
  return { success: `حُفظ القالب الافتراضي لنوع «${typeDef.labelAr}»` };
}

/* ─────────────────── قوائم الاختيار ─────────────────── */

export type TemplateChoice = { key: string; label: string; isBase: boolean };

/** خيارات القالب لقوائم الإنشاء والتحرير: الأساسيات الخمسة ثم النسخ غير المؤرشفة */
export async function templateChoices(): Promise<TemplateChoice[]> {
  const custom = await db
    .select()
    .from(reportStyleTemplates)
    .where(isNull(reportStyleTemplates.archivedAt))
    .orderBy(asc(reportStyleTemplates.name));
  return [
    ...BASE_TEMPLATES.map((t) => ({ key: t.key, label: t.labelAr, isBase: true })),
    ...custom.map((r) => ({ key: r.id, label: r.name, isBase: false })),
  ];
}

/** أنواع التقارير لواجهة الافتراضيات — المفتاح والتسمية وقالب السجل الافتراضي */
export function defaultTemplateTypes(): { key: string; labelAr: string; defaultTemplateKey: string }[] {
  return INSTANCE_TYPES.map((t) => ({ key: t.key, labelAr: t.labelAr, defaultTemplateKey: t.defaultTemplateKey }));
}

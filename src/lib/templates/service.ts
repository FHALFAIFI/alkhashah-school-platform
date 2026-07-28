import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { templateDefinitions, templateVersions, documents } from "@/db/schema";
import { DEFAULT_TEMPLATE_CONFIG, parseTemplateConfig, type TemplateConfig, type TemplateDocType } from "./schema";

/**
 * طبقة بيانات القوالب (v2.2 §E1/§E5).
 *
 * القاعدة المحورية: **نسخة منشورة لا تُعدَّل أبداً.** التحرير ينشئ نسخة جديدة، فتبقى كل
 * نسخة سابقة قابلة للقراءة كما نُشرت، وتبقى الوثائق الصادرة التي تشير إليها متّسقة مع
 * تاريخها.
 */

export type TemplateWithVersion = typeof templateDefinitions.$inferSelect & {
  currentVersion: (typeof templateVersions.$inferSelect) | null;
  versionCount: number;
  /** كم وثيقة صادرة تشير إلى نسخة من هذا القالب — يمنع الحذف */
  issuedDocumentCount: number;
};

/** إعداد نسخة بعد التحقق — الإعداد التالف في قاعدة البيانات يسقط إلى الافتراضي بدل الانهيار */
export function configOf(version: typeof templateVersions.$inferSelect | null | undefined): TemplateConfig {
  if (!version) return DEFAULT_TEMPLATE_CONFIG;
  const parsed = parseTemplateConfig(version.config);
  return parsed.ok ? parsed.config : DEFAULT_TEMPLATE_CONFIG;
}

/** كل القوالب مع نسختها الحالية وعدد نسخها ووثائقها الصادرة */
export async function listTemplates(opts?: { includeArchived?: boolean }): Promise<TemplateWithVersion[]> {
  const rows = await db
    .select()
    .from(templateDefinitions)
    .where(opts?.includeArchived ? undefined : isNull(templateDefinitions.archivedAt))
    .orderBy(asc(templateDefinitions.docType), asc(templateDefinitions.createdAt));
  if (rows.length === 0) return [];

  const [versions, counts, docCounts] = await Promise.all([
    db.select().from(templateVersions),
    db
      .select({ templateId: templateVersions.templateId, n: sql<number>`count(*)::int` })
      .from(templateVersions)
      .groupBy(templateVersions.templateId),
    db
      .select({ versionId: documents.templateVersionId, n: sql<number>`count(*)::int` })
      .from(documents)
      .groupBy(documents.templateVersionId),
  ]);

  const versionById = new Map(versions.map((v) => [v.id, v]));
  const countByTemplate = new Map(counts.map((c) => [c.templateId, c.n]));
  const versionsByTemplate = new Map<string, string[]>();
  for (const v of versions) {
    const list = versionsByTemplate.get(v.templateId) ?? [];
    list.push(v.id);
    versionsByTemplate.set(v.templateId, list);
  }
  const docCountByVersion = new Map(docCounts.filter((d) => d.versionId).map((d) => [d.versionId as string, d.n]));

  return rows.map((t) => ({
    ...t,
    currentVersion: t.currentVersionId ? versionById.get(t.currentVersionId) ?? null : null,
    versionCount: countByTemplate.get(t.id) ?? 0,
    issuedDocumentCount: (versionsByTemplate.get(t.id) ?? []).reduce((sum, vid) => sum + (docCountByVersion.get(vid) ?? 0), 0),
  }));
}

/** قالب واحد بكل نسخه — الأحدث أولاً */
export async function getTemplate(templateId: string) {
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return null;
  const versions = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.versionNumber));
  const current = versions.find((v) => v.id === template.currentVersionId) ?? null;
  return { template, versions, current };
}

/**
 * القالب المعتمد لنوع وثيقة عند الإصدار.
 *
 * يعيد النسخة **المنشورة** للقالب الافتراضي غير المؤرشف. غياب قالب ليس خطأ: تُستعمل
 * القيم الافتراضية، فلا يتوقّف إصدار الوثائق لأن المدير لم ينشئ قالباً بعد.
 */
export async function resolveTemplateForIssue(
  docType: TemplateDocType,
): Promise<{ versionId: string | null; config: TemplateConfig }> {
  const [template] = await db
    .select()
    .from(templateDefinitions)
    .where(
      and(eq(templateDefinitions.docType, docType), eq(templateDefinitions.isDefault, true), isNull(templateDefinitions.archivedAt)),
    );
  if (!template?.currentVersionId) return { versionId: null, config: DEFAULT_TEMPLATE_CONFIG };

  const [version] = await db
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.id, template.currentVersionId), eq(templateVersions.status, "منشورة")));
  if (!version) return { versionId: null, config: DEFAULT_TEMPLATE_CONFIG };

  return { versionId: version.id, config: configOf(version) };
}

/**
 * هل تشير وثيقة صادرة إلى هذه النسخة؟ حارس «التاريخ المجمَّد»: نسخة مستعملة لا تُحذف.
 */
export async function versionIsReferenced(versionId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(eq(documents.templateVersionId, versionId));
  return (row?.n ?? 0) > 0;
}

/** الرقم التالي للنسخة داخل قالب — لا يُعاد استعمال رقم سابق */
export async function nextVersionNumber(templateId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${templateVersions.versionNumber})` })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId));
  return (row?.max ?? 0) + 1;
}

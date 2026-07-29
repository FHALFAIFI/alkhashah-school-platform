"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { templateDefinitions, templateVersions } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";
import {
  DEFAULT_TEMPLATE_CONFIG,
  DOC_TYPE_LABELS,
  parseTemplateConfig,
  type TemplateConfig,
  type TemplateDocType,
} from "@/lib/templates/schema";
import { isTemplateDocType, validatePlaceholders } from "@/lib/templates/placeholders";
import { validateStructureKeys } from "@/lib/templates/structure";
import { recordSourceFor } from "@/lib/templates/records";
import { renderTemplate, sampleValues } from "@/lib/templates/render";
import { configOf, nextVersionNumber, versionIsReferenced } from "@/lib/templates/service";

/**
 * إجراءات إدارة القوالب (v2.2 §E1/§E5/§E6).
 *
 * **التفويض** (§10): العرض يتطلب `documents.read`، وكل تعديل أو نشر أو استعادة يتطلب
 * `admin.settings`. استُعملت صلاحيات قائمة عمداً بدل استحداث مفاتيح جديدة، لأن مفاتيح
 * الصلاحيات تُزرع عبر `seed.ts` الممنوع تشغيله على الإنتاج، وإدراجها في هجرة يعني كتابة
 * بيانات في الإنتاج. القرار موثّق في تقرير الهندسة.
 *
 * **التاريخ المجمَّد** (§E5): لا إجراء هنا يعدّل نسخة منشورة. التحرير ينشئ نسخة جديدة.
 */

export type ActionState = { error?: string; success?: string } | null;

/** صلاحية إدارة القوالب — نقطة واحدة فيتغيّر المفتاح من مكان واحد لو لزم */
const MANAGE = "admin.settings";

const definitionSchema = z.object({
  docType: z.string().refine(isTemplateDocType, "نوع الوثيقة غير معروف"),
  nameAr: z.string().trim().max(150, "الاسم طويل جداً").optional(),
  description: z.string().trim().max(500, "الوصف طويل جداً").optional(),
});

/** إنشاء قالب جديد لنوع وثيقة — يبدأ بنسخة مسودة تحمل الإعداد الافتراضي */
export async function createTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const parsed = definitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const docType = d.docType as TemplateDocType;

  const created = await db.transaction(async (tx) => {
    const [template] = await tx
      .insert(templateDefinitions)
      .values({
        docType,
        nameAr: d.nameAr || null,
        description: d.description || null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const [version] = await tx
      .insert(templateVersions)
      .values({
        templateId: template.id,
        versionNumber: 1,
        config: DEFAULT_TEMPLATE_CONFIG,
        status: "مسودة",
        createdBy: user.id,
        changeNote: "النسخة الأولى — الإعداد الافتراضي",
      })
      .returning();
    return { template, version };
  });

  await audit({
    actorId: user.id,
    action: "template.created",
    entityType: "template",
    entityId: created.template.id,
    summary: `إنشاء قالب «${orFallback(d.nameAr, DOC_TYPE_LABELS[docType])}» لنوع ${DOC_TYPE_LABELS[docType]}`,
  });
  revalidatePath("/admin/templates");
  return { success: "أُنشئ القالب كمسودة — حرّره ثم انشره" };
}

/**
 * حفظ تعديل على القالب (§E5).
 *
 * لا تُعدَّل نسخة منشورة أبداً: إن كانت أحدث نسخة منشورة يُنشأ صف جديد برقم أعلى، وإن كانت
 * مسودة غير منشورة يُحدَّث إعدادها في مكانه (المسودة لم تُصدِر وثيقة فلا تاريخ مجمَّد فيها).
 */
export async function saveTemplateConfigAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  if (template.archivedAt) return { error: "القالب مؤرشف — استعده قبل التعديل" };

  const raw = String(formData.get("config") ?? "");
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { error: "إعداد القالب ليس JSON صالحاً" };
  }

  const parsed = parseTemplateConfig(candidate);
  if (!parsed.ok) return { error: parsed.error };

  // مفاتيح الأقسام والأعمدة تُطابَق بسجل النوع المغلق — لا مفتاح مخترع ولا مكرَّر
  const structure = validateStructureKeys(parsed.config, template.docType as TemplateDocType);
  if (!structure.ok) return { error: structure.error };

  // كل نص حر قد يحوي عناصر نائبة — تُتحقَّق مقابل السجل المغلق لهذا النوع
  const placeholderError = validateAllPlaceholders(parsed.config, template.docType as TemplateDocType);
  if (placeholderError) return { error: placeholderError };

  const changeNote = String(formData.get("changeNote") ?? "").trim() || null;

  const latest = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(templateVersions.versionNumber);
  const newest = latest[latest.length - 1];

  if (newest && newest.status === "مسودة") {
    // مسودة لم تُنشر بعد — التعديل في مكانه لا ينشئ تاريخاً وهمياً
    await db
      .update(templateVersions)
      .set({ config: parsed.config, changeNote })
      .where(eq(templateVersions.id, newest.id));
    await db.update(templateDefinitions).set({ updatedBy: user.id, updatedAt: new Date() }).where(eq(templateDefinitions.id, templateId));
    await audit({
      actorId: user.id,
      action: "template.draft_updated",
      entityType: "template",
      entityId: templateId,
      summary: `تحديث مسودة القالب (نسخة ${newest.versionNumber})`,
    });
    revalidatePath("/admin/templates");
    return { success: "حُفظت المسودة" };
  }

  // النسخة الأحدث منشورة — يُنشأ صف جديد ولا تُمسّ المنشورة
  const versionNumber = await nextVersionNumber(templateId);
  const [version] = await db
    .insert(templateVersions)
    .values({ templateId, versionNumber, config: parsed.config, status: "مسودة", changeNote, createdBy: user.id })
    .returning();
  await db.update(templateDefinitions).set({ updatedBy: user.id, updatedAt: new Date() }).where(eq(templateDefinitions.id, templateId));
  await audit({
    actorId: user.id,
    action: "template.version_created",
    entityType: "template",
    entityId: templateId,
    summary: `إنشاء نسخة ${version.versionNumber} كمسودة — النسخة المنشورة لم تتغيّر`,
  });
  revalidatePath("/admin/templates");
  return { success: `أُنشئت النسخة ${version.versionNumber} كمسودة` };
}

/** نشر نسخة — تصبح المستعملة في الإصدار، والنسخ السابقة تبقى كما هي */
export async function publishVersionAction(versionId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [version] = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
  if (!version) return { error: "النسخة غير موجودة" };
  if (version.status === "منشورة") return { success: "النسخة منشورة مسبقاً" };

  await db.transaction(async (tx) => {
    await tx
      .update(templateVersions)
      .set({ status: "منشورة", publishedAt: new Date(), publishedBy: user.id })
      .where(eq(templateVersions.id, versionId));
    await tx
      .update(templateDefinitions)
      .set({ currentVersionId: versionId, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(templateDefinitions.id, version.templateId));
  });

  await audit({
    actorId: user.id,
    action: "template.published",
    entityType: "template",
    entityId: version.templateId,
    summary: `نشر النسخة ${version.versionNumber}`,
  });
  revalidatePath("/admin/templates");
  return { success: `نُشرت النسخة ${version.versionNumber}` };
}

/**
 * استعادة نسخة سابقة (§E5) — **لا تعدّل النسخة القديمة ولا تحذف اللاحقة**.
 * تُنسخ إعداداتها إلى نسخة جديدة، فيبقى التاريخ كاملاً وتُقرأ الاستعادة كحدث مستقل.
 */
export async function restoreVersionAction(versionId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [source] = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
  if (!source) return { error: "النسخة غير موجودة" };

  const versionNumber = await nextVersionNumber(source.templateId);
  const [copy] = await db
    .insert(templateVersions)
    .values({
      templateId: source.templateId,
      versionNumber,
      config: source.config,
      status: "مسودة",
      changeNote: `استعادة من النسخة ${source.versionNumber}`,
      createdBy: user.id,
    })
    .returning();

  await audit({
    actorId: user.id,
    action: "template.version_restored",
    entityType: "template",
    entityId: source.templateId,
    summary: `استعادة النسخة ${source.versionNumber} كنسخة ${copy.versionNumber} (مسودة)`,
  });
  revalidatePath("/admin/templates");
  return { success: `استُعيدت كنسخة ${copy.versionNumber} — راجعها ثم انشرها` };
}

/** إعادة الإعداد الافتراضي كنسخة جديدة (§E6) — لا يمسّ أي نسخة قائمة */
export async function resetToDefaultAction(templateId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };

  const versionNumber = await nextVersionNumber(templateId);
  const [version] = await db
    .insert(templateVersions)
    .values({
      templateId,
      versionNumber,
      config: DEFAULT_TEMPLATE_CONFIG,
      status: "مسودة",
      changeNote: "إعادة تعيين إلى الإعداد الافتراضي",
      createdBy: user.id,
    })
    .returning();

  await audit({
    actorId: user.id,
    action: "template.reset_to_default",
    entityType: "template",
    entityId: templateId,
    summary: `إعادة تعيين افتراضية كنسخة ${version.versionNumber}`,
  });
  revalidatePath("/admin/templates");
  return { success: `أُنشئت نسخة افتراضية ${version.versionNumber}` };
}

/** نسخ قالب كاملاً قبل التحرير (§E6) — القالب الأصلي لا يُمسّ */
export async function duplicateTemplateAction(templateId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  const current = template.currentVersionId
    ? (await db.select().from(templateVersions).where(eq(templateVersions.id, template.currentVersionId)))[0]
    : null;

  const [copy] = await db
    .insert(templateDefinitions)
    .values({
      docType: template.docType,
      nameAr: `${orFallback(template.nameAr, DOC_TYPE_LABELS[template.docType as TemplateDocType])} — نسخة`,
      description: template.description,
      // النسخة المكرّرة ليست افتراضية: الافتراضي واحد لكل نوع ويُختار صراحةً
      isDefault: false,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  await db.insert(templateVersions).values({
    templateId: copy.id,
    versionNumber: 1,
    config: configOf(current),
    status: "مسودة",
    changeNote: `نسخة من «${orFallback(template.nameAr, "قالب")}»`,
    createdBy: user.id,
  });

  await audit({
    actorId: user.id,
    action: "template.duplicated",
    entityType: "template",
    entityId: copy.id,
    summary: `تكرار قالب ${DOC_TYPE_LABELS[template.docType as TemplateDocType]}`,
  });
  revalidatePath("/admin/templates");
  return { success: "أُنشئت نسخة من القالب" };
}

/** تعيين قالب افتراضياً لنوعه — الفهرس الجزئي الفريد يضمن واحداً فقط */
export async function setDefaultTemplateAction(templateId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  if (template.archivedAt) return { error: "القالب مؤرشف — استعده أولاً" };
  if (!template.currentVersionId) return { error: "انشر نسخة من القالب قبل تعيينه افتراضياً" };

  await db.transaction(async (tx) => {
    // إزالة الافتراضي السابق أولاً — القيد الفريد يمنع وجود اثنين معاً
    await tx
      .update(templateDefinitions)
      .set({ isDefault: false })
      .where(and(eq(templateDefinitions.docType, template.docType), eq(templateDefinitions.isDefault, true), isNull(templateDefinitions.archivedAt)));
    await tx.update(templateDefinitions).set({ isDefault: true, updatedBy: user.id, updatedAt: new Date() }).where(eq(templateDefinitions.id, templateId));
  });

  await audit({
    actorId: user.id,
    action: "template.set_default",
    entityType: "template",
    entityId: templateId,
    summary: `تعيين القالب افتراضياً لنوع ${DOC_TYPE_LABELS[template.docType as TemplateDocType]}`,
  });
  revalidatePath("/admin/templates");
  return { success: "عُيّن القالب افتراضياً" };
}

/** أرشفة القالب — إخفاء غير مدمّر؛ النسخ والوثائق الصادرة تبقى سليمة. idempotent */
export async function archiveTemplateAction(templateId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  if (template.archivedAt) return { success: "القالب مؤرشف مسبقاً" };

  await db
    .update(templateDefinitions)
    .set({ archivedAt: new Date(), archivedBy: user.id, isDefault: false, updatedAt: new Date() })
    .where(and(eq(templateDefinitions.id, templateId), isNull(templateDefinitions.archivedAt)));
  await audit({
    actorId: user.id,
    action: "template.archived",
    entityType: "template",
    entityId: templateId,
    summary: "أرشفة القالب — النسخ والوثائق الصادرة محفوظة",
  });
  revalidatePath("/admin/templates");
  return { success: "أُرشف القالب" };
}

export async function restoreTemplateAction(templateId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  if (!template.archivedAt) return { success: "القالب غير مؤرشف" };

  await db
    .update(templateDefinitions)
    .set({ archivedAt: null, archivedBy: null, updatedAt: new Date() })
    .where(eq(templateDefinitions.id, templateId));
  await audit({ actorId: user.id, action: "template.restored", entityType: "template", entityId: templateId, summary: "استعادة القالب" });
  revalidatePath("/admin/templates");
  return { success: "استُعيد القالب" };
}

/**
 * التخلّص من نسخة مسودة — **أرشفة لا حذف**، و**ممنوعة** إن كانت منشورة أو صدرت بها وثيقة.
 *
 * لماذا الأرشفة لا الحذف: أرقام النسخ لا تُعاد أبداً. لو حُذف الصف لأصبح الرقم متاحاً
 * لنسخة تالية، فيظهر في سجل التدقيق حدثان عن «النسخة 2» يقصدان شيئين مختلفين. الأرشفة
 * تُبقي الرقم محجوزاً والتاريخ مقروءاً، وهي النمط المتبع في المنصة كلها (البرامج والشواهد
 * والبنود المالية والقوالب).
 */
export async function archiveDraftVersionAction(versionId: string): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [version] = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
  if (!version) return { error: "النسخة غير موجودة" };
  if (version.status === "منشورة") return { error: "لا تُؤرشف نسخة منشورة — أرشف القالب بدلاً من ذلك" };
  if (version.status === "مؤرشفة") return { success: "المسودة مؤرشفة مسبقاً" };
  if (await versionIsReferenced(versionId)) return { error: "لا تُؤرشف نسخة صدرت بها وثائق" };

  await db.update(templateVersions).set({ status: "مؤرشفة" }).where(eq(templateVersions.id, versionId));
  await audit({
    actorId: user.id,
    action: "template.draft_archived",
    entityType: "template",
    entityId: version.templateId,
    summary: `أرشفة مسودة النسخة ${version.versionNumber}`,
  });
  revalidatePath("/admin/templates");
  return { success: "أُرشفت المسودة" };
}

/**
 * استيراد إعداد قالب (§E6) — يمرّ بالتحقق الكامل نفسه.
 * يُرفض الإعداد غير المتوافق أو غير الآمن، ويُنشأ كمسودة لا كنسخة منشورة.
 */
export async function importTemplateConfigAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };

  const raw = String(formData.get("payload") ?? "").trim();
  if (!raw) return { error: "ألصق إعداد القالب أولاً" };
  if (raw.length > 100_000) return { error: "الإعداد أكبر من الحد المسموح" };

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { error: "الإعداد المستورد ليس JSON صالحاً" };
  }
  const parsed = parseTemplateConfig(candidate);
  if (!parsed.ok) return { error: `استيراد مرفوض — ${parsed.error}` };
  const structure = validateStructureKeys(parsed.config, template.docType as TemplateDocType);
  if (!structure.ok) return { error: `استيراد مرفوض — ${structure.error}` };
  const placeholderError = validateAllPlaceholders(parsed.config, template.docType as TemplateDocType);
  if (placeholderError) return { error: `استيراد مرفوض — ${placeholderError}` };

  const versionNumber = await nextVersionNumber(templateId);
  await db.insert(templateVersions).values({
    templateId,
    versionNumber,
    config: parsed.config,
    status: "مسودة",
    changeNote: "إعداد مستورد",
    createdBy: user.id,
  });
  await audit({
    actorId: user.id,
    action: "template.config_imported",
    entityType: "template",
    entityId: templateId,
    summary: `استيراد إعداد كنسخة ${versionNumber} (مسودة)`,
  });
  revalidatePath("/admin/templates");
  return { success: `استُورد الإعداد كنسخة ${versionNumber} — راجعها ثم انشرها` };
}

/**
 * معاينة القالب بسجل حقيقي (§E4).
 *
 * **التفويض** يُفحص هنا مرتين: صلاحية إدارة القوالب، **و** صلاحية قراءة نوع السجل نفسه.
 * ثم يُعاد اشتقاق السجل من مصدره المحدود، فمعرّف سجل خارج القائمة المتاحة — أو من نوع
 * آخر — لا يُقرأ إطلاقاً (حارس IDOR).
 *
 * **لا أثر جانبي**: قراءة فقط. لا تُصدر وثيقة ولا تُنشئ لقطة مجمّدة ولا تُعدّل السجل ولا
 * تُنشئ نسخة قالب. الناتج HTML مهرَّب يُعرض في إطار `sandbox=""`.
 */
export async function previewWithRecordAction(
  templateId: string,
  recordId: string,
  configJson: string,
): Promise<{ html: string; recordLabel: string } | { error: string }> {
  const user = await requirePermission(MANAGE);
  const [template] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  const docType = template.docType as TemplateDocType;

  if (!z.string().uuid().safeParse(recordId).success) return { error: "معرّف السجل غير صالح" };

  const source = recordSourceFor(docType);
  if (!source) return { error: "لا سجلات لهذا النوع — المعاينة ببيانات نموذجية فقط" };
  // صلاحية قراءة السجل لا تُستنتج من صلاحية إدارة القوالب
  if (!user.permissions.has(source.permission)) return { error: "لا تملك صلاحية قراءة هذا النوع من السجلات" };

  let candidate: unknown;
  try {
    candidate = JSON.parse(configJson);
  } catch {
    return { error: "إعداد القالب ليس JSON صالحاً" };
  }
  const parsed = parseTemplateConfig(candidate);
  if (!parsed.ok) return { error: parsed.error };
  const structure = validateStructureKeys(parsed.config, docType);
  if (!structure.ok) return { error: structure.error };
  const placeholderError = validateAllPlaceholders(parsed.config, docType);
  if (placeholderError) return { error: placeholderError };

  const record = await source.load(recordId);
  if (!record) return { error: "السجل غير متاح — اختر من القائمة" };

  const html = renderTemplate(parsed.config, {
    // القيم النموذجية أساس، والسجل الحقيقي يعلوها — فلا يظهر عنصر نائب بلا قيمة
    values: { ...sampleValues(), ...record.values },
    docType,
    table: record.table,
  });

  await audit({
    actorId: user.id,
    action: "template.record_preview",
    entityType: "template",
    entityId: templateId,
    summary: `معاينة قالب ${DOC_TYPE_LABELS[docType]} بسجل حقيقي — لم تصدر وثيقة`,
    detail: { recordId },
  });

  return { html, recordLabel: record.recordLabel };
}

/** التحقق من العناصر النائبة في كل نص حر داخل الإعداد */
function validateAllPlaceholders(config: TemplateConfig, docType: TemplateDocType): string | null {
  const texts: (string | undefined)[] = [
    ...Object.values(config.text ?? {}),
    ...Object.values(config.identity ?? {}).filter((v): v is string => typeof v === "string"),
    config.signature?.signatureLabel,
    config.signature?.approvalLabel,
    ...(config.columns ?? []).map((c) => c.label),
    ...(config.sections ?? []).map((s) => s.label),
  ];
  for (const text of texts) {
    if (typeof text !== "string" || text.length === 0) continue;
    const res = validatePlaceholders(text, docType);
    if (!res.ok) return res.error;
  }
  return null;
}

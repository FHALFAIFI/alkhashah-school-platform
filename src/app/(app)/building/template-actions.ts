"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { inspectionTemplates, inspections } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";
import {
  flattenItems,
  validateSections,
  nextTemplateCode,
  TEMPLATE_STATUS,
  type TemplateSection,
} from "@/lib/building/inspection-templates";

export type TemplateActionState = { error?: string; success?: string; newId?: string } | null;

const PERM_WRITE = "inspections.write";
const PERM_ACTIVATE = "building.publish";

function parseSections(raw: FormDataEntryValue | null): { sections?: TemplateSection[]; error?: string } {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    const err = validateSections(parsed);
    if (err) return { error: err };
    return { sections: parsed as TemplateSection[] };
  } catch {
    return { error: "بنية القالب غير صالحة" };
  }
}

function readMeta(fd: FormData) {
  return {
    nameAr: String(fd.get("nameAr") ?? "").trim(),
    roomType: String(fd.get("roomType") ?? "").trim() || null,
    purpose: String(fd.get("purpose") ?? "").trim() || null,
    instructions: String(fd.get("instructions") ?? "").trim() || null,
  };
}

/** إنشاء قالب جديد (مسودة، إصدار 1، عائلة جديدة). */
export async function createTemplateAction(_prev: TemplateActionState, formData: FormData): Promise<TemplateActionState> {
  const user = await requirePermission(PERM_WRITE);
  // اسم القالب أصبح اختيارياً (v2.1) — يُخزَّن "" عند تركه فارغاً؛ يبقى منع تفعيل القالب الفارغ بنيوياً.
  const meta = readMeta(formData);
  const { sections, error } = parseSections(formData.get("sectionsJson"));
  if (error) return { error };

  const code = await nextTemplateCode();
  const [created] = await db
    .insert(inspectionTemplates)
    .values({
      code,
      version: 1,
      nameAr: meta.nameAr,
      roomType: meta.roomType,
      purpose: meta.purpose,
      instructions: meta.instructions,
      items: flattenItems(sections!),
      sections: sections,
      status: TEMPLATE_STATUS.draft,
    })
    .returning();
  // rootId = self لأول إصدار
  await db.update(inspectionTemplates).set({ rootId: created.id }).where(eq(inspectionTemplates.id, created.id));
  await audit({ actorId: user.id, action: "inspection_template.created", entityType: "inspection_template", entityId: created.id, summary: `${code} — ${orFallback(meta.nameAr)}` });
  return { success: `أُنشئ القالب ${code} (مسودة)`, newId: created.id };
}

async function templateUsageCount(templateId: string): Promise<number> {
  const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(inspections).where(eq(inspections.templateId, templateId));
  return Number(c);
}

/**
 * تحرير القالب. إن كان مسودة يُحدَّث في مكانه. إن كان مُفعّلاً أو مستخدَماً يُنشأ إصدار جديد
 * (مسودة) في العائلة نفسها بدل تغيير المستخدَم — حفاظاً على التكامل التاريخي.
 */
export async function updateTemplateAction(templateId: string, _prev: TemplateActionState, formData: FormData): Promise<TemplateActionState> {
  const user = await requirePermission(PERM_WRITE);
  // اسم القالب اختياري (v2.1) — يُخزَّن "" عند تركه فارغاً.
  const meta = readMeta(formData);
  const { sections, error } = parseSections(formData.get("sectionsJson"));
  if (error) return { error };

  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };

  const used = (await templateUsageCount(templateId)) > 0;
  const isDraft = t.status === TEMPLATE_STATUS.draft;

  if (isDraft && !used) {
    await db
      .update(inspectionTemplates)
      .set({
        nameAr: meta.nameAr,
        roomType: meta.roomType,
        purpose: meta.purpose,
        instructions: meta.instructions,
        items: flattenItems(sections!),
        sections: sections,
        updatedAt: new Date(),
      })
      .where(eq(inspectionTemplates.id, templateId));
    await audit({ actorId: user.id, action: "inspection_template.updated", entityType: "inspection_template", entityId: templateId });
    return { success: "حُفظت المسودة" };
  }

  // إنشاء إصدار جديد (مسودة) في العائلة
  const rootId = t.rootId ?? t.id;
  const [{ maxV }] = await db
    .select({ maxV: sql<number>`max(${inspectionTemplates.version})::int` })
    .from(inspectionTemplates)
    .where(eq(inspectionTemplates.rootId, rootId));
  const [created] = await db
    .insert(inspectionTemplates)
    .values({
      code: t.code,
      rootId,
      version: Number(maxV ?? t.version) + 1,
      nameAr: meta.nameAr,
      roomType: meta.roomType,
      purpose: meta.purpose,
      instructions: meta.instructions,
      items: flattenItems(sections!),
      sections: sections,
      status: TEMPLATE_STATUS.draft,
    })
    .returning();
  await audit({ actorId: user.id, action: "inspection_template.new_version", entityType: "inspection_template", entityId: created.id, summary: `${t.code} إصدار ${created.version}` });
  return { success: `أُنشئ إصدار جديد ${created.version} (مسودة) — التعديل لا يغيّر الإصدار المستخدَم`, newId: created.id };
}

/** تفعيل الإصدار — يجعله «مُفعّل» ويعطّل الإصدارات المُفعّلة الأخرى في العائلة نفسها. */
export async function activateTemplateAction(templateId: string): Promise<TemplateActionState> {
  const user = await requirePermission(PERM_WRITE, PERM_ACTIVATE);
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };
  if (!t.sections && (!t.items || t.items.length === 0)) return { error: "لا يمكن تفعيل قالب فارغ" };
  const rootId = t.rootId ?? t.id;
  await db.transaction(async (tx) => {
    await tx
      .update(inspectionTemplates)
      .set({ status: TEMPLATE_STATUS.deactivated, updatedAt: new Date() })
      .where(and(eq(inspectionTemplates.rootId, rootId), eq(inspectionTemplates.status, TEMPLATE_STATUS.active), ne(inspectionTemplates.id, templateId)));
    await tx
      .update(inspectionTemplates)
      .set({ status: TEMPLATE_STATUS.active, approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(inspectionTemplates.id, templateId));
  });
  await audit({ actorId: user.id, action: "inspection_template.activated", entityType: "inspection_template", entityId: templateId });
  return { success: "فُعّل القالب" };
}

/** إلغاء تفعيل الإصدار — «معطّل». لا يُحذف (يحفظ التكامل التاريخي). */
export async function deactivateTemplateAction(templateId: string): Promise<TemplateActionState> {
  const user = await requirePermission(PERM_WRITE, PERM_ACTIVATE);
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };
  await db.update(inspectionTemplates).set({ status: TEMPLATE_STATUS.deactivated, updatedAt: new Date() }).where(eq(inspectionTemplates.id, templateId));
  await audit({ actorId: user.id, action: "inspection_template.deactivated", entityType: "inspection_template", entityId: templateId });
  return { success: "أُلغي تفعيل القالب" };
}

/** تكرار القالب — عائلة جديدة (رمز جديد، إصدار 1، مسودة). */
export async function duplicateTemplateAction(templateId: string): Promise<TemplateActionState> {
  const user = await requirePermission(PERM_WRITE);
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };
  const code = await nextTemplateCode();
  const [created] = await db
    .insert(inspectionTemplates)
    .values({
      code,
      version: 1,
      nameAr: `${t.nameAr} (نسخة)`,
      roomType: t.roomType,
      purpose: t.purpose,
      instructions: t.instructions,
      items: t.items,
      sections: t.sections,
      status: TEMPLATE_STATUS.draft,
      isSystem: false,
    })
    .returning();
  await db.update(inspectionTemplates).set({ rootId: created.id }).where(eq(inspectionTemplates.id, created.id));
  await audit({ actorId: user.id, action: "inspection_template.duplicated", entityType: "inspection_template", entityId: created.id, summary: `من ${t.code ?? t.id}` });
  return { success: `أُنشئت نسخة جديدة ${code} (مسودة)`, newId: created.id };
}

/** حذف مسودة غير مستخدَمة فقط. الإصدارات المستخدَمة لا تُحذف — تُعطَّل. */
export async function deleteTemplateDraftAction(templateId: string): Promise<TemplateActionState> {
  const user = await requirePermission(PERM_WRITE);
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };
  if (t.status !== TEMPLATE_STATUS.draft) return { error: "يُحذف فقط ما هو مسودة — عطّل القالب المُفعّل بدلاً من حذفه" };
  if ((await templateUsageCount(templateId)) > 0) return { error: "لا يمكن حذف قالب استُخدم في فحوصات — عطّله بدلاً من ذلك" };
  await db.delete(inspectionTemplates).where(eq(inspectionTemplates.id, templateId));
  await audit({ actorId: user.id, action: "inspection_template.deleted_draft", entityType: "inspection_template", entityId: templateId, summary: t.code ?? undefined });
  return { success: "حُذفت المسودة" };
}

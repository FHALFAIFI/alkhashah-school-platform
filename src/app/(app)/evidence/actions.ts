"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { evidenceItems, evidenceLinks } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { saveUploadedFile } from "@/lib/storage";
import { canDeleteEvidence, linkEvidence } from "@/lib/evidence";
import { audit } from "@/lib/audit";

export type ActionState = { error?: string; success?: string } | null;

const meta = z.object({
  title: z.string().min(2, "عنوان الشاهد مطلوب"),
  role: z.string().optional(),
  evidenceType: z.string().optional(),
  source: z.string().optional(),
  description: z.string().optional(),
  evidenceDate: z.string().optional(),
});

export async function createEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const parsed = meta.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const kind = String(formData.get("kind") ?? "file");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  /** ربط بمفتاح فرعي (مثل مؤشر أداء محدد) — سلسلة فارغة تعني بلا مفتاح */
  const subKey = String(formData.get("subKey") ?? "").trim();

  let fileId: string | null = null;
  let url: string | null = null;
  let textContent: string | null = null;

  try {
    if (kind === "file") {
      const file = formData.get("file") as File | null;
      if (!file || file.size === 0) return { error: "اختر ملفاً" };
      const stored = await saveUploadedFile({
        originalName: file.name,
        mime: file.type || "application/octet-stream",
        data: Buffer.from(await file.arrayBuffer()),
        scope: "attachments",
        uploadedBy: user.id,
      });
      fileId = stored.id;
    } else if (kind === "link") {
      const u = String(formData.get("url") ?? "").trim();
      const valid = z.string().url().safeParse(u);
      if (!valid.success) return { error: "رابط غير صالح" };
      url = u;
    } else {
      textContent = String(formData.get("textContent") ?? "").trim();
      if (!textContent) return { error: "أدخل نص الشاهد" };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذر حفظ الملف" };
  }

  const [item] = await db
    .insert(evidenceItems)
    .values({
      title: parsed.data.title,
      kind,
      fileId,
      url,
      textContent,
      description: parsed.data.description || null,
      role: parsed.data.role || null,
      evidenceType: parsed.data.evidenceType || null,
      source: parsed.data.source || null,
      evidenceDate: parsed.data.evidenceDate || null,
      createdBy: user.id,
    })
    .returning();

  if (entityType && entityId) {
    await linkEvidence({ evidenceId: item.id, entityType, entityId, subKey, linkedBy: user.id });
  }
  await audit({ actorId: user.id, action: "evidence.created", entityType: "evidence", entityId: item.id, summary: `إضافة شاهد «${item.title}»` });
  revalidatePath("/evidence");
  if (entityType === "program") revalidatePath(`/plan/${entityId}`);
  return { success: "أضيف الشاهد" };
}

export async function linkEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const subKey = String(formData.get("subKey") ?? "").trim();
  if (!evidenceId || !entityType || !entityId) return { error: "بيانات الربط ناقصة" };
  await linkEvidence({ evidenceId, entityType, entityId, subKey, linkedBy: user.id });
  await audit({ actorId: user.id, action: "evidence.linked", entityType, entityId, summary: "ربط شاهد" });
  revalidatePath("/evidence");
  return { success: "تم الربط" };
}

/** مراجعة الشاهد — مرحلة «المراجعة» في سير عمل الشواهد: مقبول أو مرفوض مع ملاحظة */
export async function reviewEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!evidenceId) return { error: "الشاهد غير محدد" };
  if (decision !== "مقبول" && decision !== "مرفوض") return { error: "قرار المراجعة يجب أن يكون «مقبول» أو «مرفوض»" };
  if (decision === "مرفوض" && note.length < 3) return { error: "اذكر سبب الرفض في الملاحظة" };
  const [item] = await db
    .update(evidenceItems)
    .set({ reviewStatus: decision, reviewNote: note || null })
    .where(eq(evidenceItems.id, evidenceId))
    .returning();
  if (!item) return { error: "الشاهد غير موجود" };
  await audit({
    actorId: user.id,
    action: "evidence.reviewed",
    entityType: "evidence",
    entityId: evidenceId,
    summary: `مراجعة شاهد «${item.title}»: ${decision}`,
  });
  revalidatePath("/evidence");
  return { success: `سجلت المراجعة: ${decision}` };
}

export async function deleteEvidenceAction(evidenceId: string): Promise<ActionState> {
  const user = await requirePermission("evidence.delete");
  const check = await canDeleteEvidence(evidenceId);
  if (!check.allowed) return { error: `لا يمكن الحذف: ${check.reason}` };
  await db.delete(evidenceLinks).where(eq(evidenceLinks.evidenceId, evidenceId));
  await db.delete(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  await audit({ actorId: user.id, action: "evidence.deleted", entityType: "evidence", entityId: evidenceId });
  revalidatePath("/evidence");
  return { success: "حذف الشاهد" };
}

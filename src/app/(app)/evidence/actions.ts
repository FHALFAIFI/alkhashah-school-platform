"use server";

import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { evidenceItems, evidenceLinks, evidenceVersions } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { saveUploadedFile, acceptStoredFile } from "@/lib/storage";
import { canDeleteEvidence, linkEvidence } from "@/lib/evidence";
import { entityLabelAr, isLinkableEntityKey, resolveEntities } from "@/lib/entity-registry";
import { audit } from "@/lib/audit";
import { userFacingError } from "@/lib/user-error";
import { optionalIsoDate } from "@/lib/dates-zod";

export type ActionState = { error?: string; success?: string } | null;

const meta = z.object({
  // اختياري (قاعدة v2.1: كل الحقول المُدخلة اختيارية) — يُخزَّن "" ويُعرض «بدون عنوان» بديلاً آمناً.
  title: z.string().optional(),
  role: z.string().optional(),
  evidenceType: z.string().optional(),
  source: z.string().optional(),
  description: z.string().optional(),
  evidenceDate: optionalIsoDate,
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
    return { error: userFacingError(e, "تعذر حفظ الملف") };
  }

  // The uploaded file (if any) is already persisted before this point: storage writes the
  // file first, then its stored_files row (file-before-DB ordering), so a DB failure here can
  // only strand a file, never leave a DB row pointing at a missing file. Insert the evidence
  // item and its entity link inside ONE transaction so a partial failure cannot persist an
  // evidence item without its intended link. Any DB error is surfaced as an Arabic message,
  // never a raw exception.
  let item: typeof evidenceItems.$inferSelect;
  try {
    item = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(evidenceItems)
        .values({
          title: parsed.data.title?.trim() ?? "",
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
        await tx
          .insert(evidenceLinks)
          .values({ evidenceId: created.id, entityType, entityId, subKey, linkedBy: user.id })
          .onConflictDoNothing();
      }
      return created;
    });
  } catch {
    return { error: "تعذّر حفظ الشاهد، حاول مرة أخرى" };
  }

  await audit({ actorId: user.id, action: "evidence.created", entityType: "evidence", entityId: item.id, summary: `إضافة شاهد «${item.title || "بدون عنوان"}»` });
  // D-053: لوحة الشواهد تُستدعى من صفحة البرنامج نفسها — التحديث من العميل بعد النتيجة
  return { success: "أضيف الشاهد" };
}

export type EvidenceCandidate = {
  id: string;
  title: string;
  kind: string;
  role: string | null;
  evidenceDate: string | null;
  /** عدد السجلات المرتبطة بالشاهد حالياً — يوضّح للمستخدم أنه شاهد مُعاد استخدامه */
  linkCount: number;
  /** مرتبط بالفعل بالسجل الحالي */
  alreadyLinked: boolean;
};

/**
 * البحث في مكتبة الشواهد لربط شاهد قائم بسجل جديد.
 * يستبعد المؤرشف، ويوضّح ما هو مرتبط أصلاً بالسجل الحالي حتى لا يُرفع الشاهد مرتين.
 */
export async function searchEvidenceLibraryAction(
  entityType: string,
  entityId: string,
  query: string,
): Promise<EvidenceCandidate[]> {
  await requirePermission("evidence.read");
  const q = query.trim();

  const rows = await db
    .select({
      id: evidenceItems.id,
      title: evidenceItems.title,
      kind: evidenceItems.kind,
      role: evidenceItems.role,
      evidenceDate: evidenceItems.evidenceDate,
    })
    .from(evidenceItems)
    .where(q ? and(isNull(evidenceItems.archivedAt), ilike(evidenceItems.title, `%${q}%`)) : isNull(evidenceItems.archivedAt))
    .orderBy(desc(evidenceItems.createdAt))
    .limit(25);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const links = await db
    .select({ evidenceId: evidenceLinks.evidenceId, entityType: evidenceLinks.entityType, entityId: evidenceLinks.entityId })
    .from(evidenceLinks)
    .where(inArray(evidenceLinks.evidenceId, ids));

  const counts = new Map<string, number>();
  const linkedHere = new Set<string>();
  for (const l of links) {
    counts.set(l.evidenceId, (counts.get(l.evidenceId) ?? 0) + 1);
    if (l.entityType === entityType && l.entityId === entityId) linkedHere.add(l.evidenceId);
  }

  return rows.map((r) => ({
    ...r,
    linkCount: counts.get(r.id) ?? 0,
    alreadyLinked: linkedHere.has(r.id),
  }));
}

/**
 * ربط شاهد قائم بسجل آخر — جوهر «إدخال المعلومة مرة واحدة».
 * النوع يجب أن يكون مسجَّلاً في `entity-registry` والسجل نفسه موجوداً، وإلا رُفض الربط
 * حتى لا تنشأ روابط معلّقة لا يستطيع حارس الحذف تفسيرها لاحقاً.
 */
export async function linkEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const subKey = String(formData.get("subKey") ?? "").trim();
  if (!evidenceId || !entityType || !entityId) return { error: "بيانات الربط ناقصة" };
  if (!isLinkableEntityKey(entityType)) return { error: "نوع سجل غير مدعوم للربط" };

  const [item] = await db.select({ id: evidenceItems.id, archivedAt: evidenceItems.archivedAt })
    .from(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  if (!item) return { error: "الشاهد غير موجود" };
  if (item.archivedAt) return { error: "الشاهد مؤرشف — استعده أولاً قبل ربطه بسجل جديد" };

  const [ref] = await resolveEntities(entityType, [entityId]);
  if (!ref) return { error: `السجل غير موجود (${entityLabelAr(entityType)})` };

  await linkEvidence({ evidenceId, entityType, entityId, subKey, linkedBy: user.id });
  await audit({
    actorId: user.id,
    action: "evidence.linked",
    entityType,
    entityId,
    summary: `ربط شاهد بـ${entityLabelAr(entityType)}: ${ref.labelAr}`,
    detail: { evidenceId, subKey },
  });
  return { success: `رُبط الشاهد بـ${entityLabelAr(entityType)}` };
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
  return { success: `سجلت المراجعة: ${decision}` };
}

/**
 * اعتماد المدير اليدوي لملف مرفوع «قيد الاعتماد» (D-032).
 * التحقق من الدور يجري داخل `acceptStoredFile` على الخادم من جدول الأدوار —
 * هنا مصادقة وتحديث مسار فقط.
 */
export async function acceptFileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.read");
  const fileId = String(formData.get("fileId") ?? "");
  if (!fileId) return { error: "الملف غير محدد" };
  const result = await acceptStoredFile({ fileId, actorId: user.id });
  return result;
}

/**
 * فك ربط شاهد عن سجل واحد دون المساس بالشاهد ولا ببقية روابطه.
 * هذا هو البديل الصحيح عن حذف الشاهد حين يكون الخطأ في الربط لا في الشاهد نفسه.
 */
export async function unlinkEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const subKey = String(formData.get("subKey") ?? "").trim();
  if (!evidenceId || !entityType || !entityId) return { error: "بيانات فك الربط ناقصة" };

  const refs = await resolveEntities(entityType, [entityId]);
  if (refs.some((r) => r.locked)) {
    return { error: `لا يمكن فك الربط: السجل المرتبط معتمد أو مقفل (${entityLabelAr(entityType)}).` };
  }

  const deleted = await db
    .delete(evidenceLinks)
    .where(
      and(
        eq(evidenceLinks.evidenceId, evidenceId),
        eq(evidenceLinks.entityType, entityType),
        eq(evidenceLinks.entityId, entityId),
        eq(evidenceLinks.subKey, subKey),
      ),
    )
    .returning();
  if (deleted.length === 0) return { error: "الرابط غير موجود" };

  await audit({
    actorId: user.id,
    action: "evidence.unlinked",
    entityType,
    entityId,
    summary: `فك ربط شاهد عن ${entityLabelAr(entityType)}`,
    detail: { evidenceId, subKey },
  });
  return { success: "فُك الربط — الشاهد وبقية روابطه سليمة" };
}

/**
 * استبدال ملف/محتوى الشاهد مع حفظ النسخة السابقة.
 * لا يُنشئ شاهداً جديداً ولا يمس أي رابط: كل السجلات المرتبطة تظل تشير إلى الشاهد نفسه
 * وترى المحتوى المحدَّث، والنسخة القديمة تبقى في `evidence_versions` للرجوع والتدقيق.
 */
export async function replaceEvidenceContentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!evidenceId) return { error: "الشاهد غير محدد" };
  if (reason.length < 3) return { error: "اذكر سبب الاستبدال" };

  const [current] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  if (!current) return { error: "الشاهد غير موجود" };
  if (current.archivedAt) return { error: "الشاهد مؤرشف — استعده أولاً قبل الاستبدال" };

  const kind = String(formData.get("kind") ?? current.kind);
  let fileId: string | null = null;
  let url: string | null = null;
  let textContent: string | null = null;

  try {
    if (kind === "file") {
      const file = formData.get("file") as File | null;
      if (!file || file.size === 0) return { error: "اختر الملف البديل" };
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
      if (!z.string().url().safeParse(u).success) return { error: "رابط غير صالح" };
      url = u;
    } else {
      textContent = String(formData.get("textContent") ?? "").trim();
      if (!textContent) return { error: "أدخل نص الشاهد البديل" };
    }
  } catch (e) {
    return { error: userFacingError(e, "تعذر حفظ الملف") };
  }

  // معاملة واحدة: لقطة النسخة الحالية ثم تحديث الشاهد ورفع رقم النسخة.
  const nextVersion = current.version + 1;
  await db.transaction(async (tx) => {
    await tx.insert(evidenceVersions).values({
      evidenceId,
      version: current.version,
      kind: current.kind,
      fileId: current.fileId,
      url: current.url,
      textContent: current.textContent,
      title: current.title,
      reason,
      replacedBy: user.id,
    });
    await tx
      .update(evidenceItems)
      .set({
        kind,
        fileId,
        url,
        textContent,
        version: nextVersion,
        // الاستبدال يعيد الشاهد إلى المراجعة — المحتوى تغيّر
        reviewStatus: "لم يراجع",
        reviewNote: null,
      })
      .where(eq(evidenceItems.id, evidenceId));
  });

  await audit({
    actorId: user.id,
    action: "evidence.replaced",
    entityType: "evidence",
    entityId: evidenceId,
    summary: `استبدال محتوى شاهد «${current.title}» — النسخة ${nextVersion}`,
    detail: { reason, fromVersion: current.version, toVersion: nextVersion },
  });
  return { success: `حُفظت النسخة ${nextVersion} — الروابط القائمة لم تتغير` };
}

/** أرشفة الشاهد — إخفاء غير مدمّر بسبب عربي إلزامي؛ لا يُحذف أي رابط. */
export async function archiveEvidenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!evidenceId) return { error: "الشاهد غير محدد" };
  if (reason.length < 3) return { error: "اذكر سبب الأرشفة" };

  const [item] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  if (!item) return { error: "الشاهد غير موجود" };
  if (item.archivedAt) return { error: "الشاهد مؤرشف بالفعل" };

  await db
    .update(evidenceItems)
    .set({ archivedAt: new Date(), archivedReason: reason, archivedBy: user.id })
    .where(eq(evidenceItems.id, evidenceId));
  await audit({
    actorId: user.id,
    action: "evidence.archived",
    entityType: "evidence",
    entityId: evidenceId,
    summary: `أرشفة شاهد «${item.title}»`,
    detail: { reason },
  });
  return { success: "أُرشف الشاهد — يمكن استعادته في أي وقت" };
}

/** استعادة شاهد مؤرشف — عكس كامل بلا فقد بيان. */
export async function restoreEvidenceAction(evidenceId: string): Promise<ActionState> {
  const user = await requirePermission("evidence.write");
  const [item] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  if (!item) return { error: "الشاهد غير موجود" };
  if (!item.archivedAt) return { error: "الشاهد غير مؤرشف" };

  await db
    .update(evidenceItems)
    .set({ archivedAt: null, archivedReason: null, archivedBy: null })
    .where(eq(evidenceItems.id, evidenceId));
  await audit({
    actorId: user.id,
    action: "evidence.restored",
    entityType: "evidence",
    entityId: evidenceId,
    summary: `استعادة شاهد «${item.title}»`,
  });
  return { success: "استُعيد الشاهد" };
}

/**
 * الحذف النهائي — متاح فقط لشاهد غير مستخدم في أي سجل.
 * عند وجود أي ارتباط يُمنع الحذف ويُشرح السبب بالعربية مع البديل (الأرشفة).
 * لا يُحذف أي رابط بالسلسلة.
 */
export async function deleteEvidenceAction(evidenceId: string): Promise<ActionState> {
  const user = await requirePermission("evidence.delete");
  const check = await canDeleteEvidence(evidenceId);
  if (!check.allowed) return { error: check.reason };

  const [item] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  if (!item) return { error: "الشاهد غير موجود" };

  // لا روابط بحكم الحارس أعلاه؛ تُحذف نسخ الشاهد معه (أثر داخلي، ليست سجل أعمال).
  await db.transaction(async (tx) => {
    await tx.delete(evidenceVersions).where(eq(evidenceVersions.evidenceId, evidenceId));
    await tx.delete(evidenceItems).where(eq(evidenceItems.id, evidenceId));
  });
  await audit({
    actorId: user.id,
    action: "evidence.deleted",
    entityType: "evidence",
    entityId: evidenceId,
    summary: `حذف نهائي لشاهد «${item.title}» بلا أي ارتباط`,
    detail: { snapshot: { title: item.title, kind: item.kind, role: item.role } },
  });
  return { success: "حُذف الشاهد نهائياً (بلا ارتباطات)" };
}

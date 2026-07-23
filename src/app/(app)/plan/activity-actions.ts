"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  programActivities,
  activityDeliverables,
  activityEvidenceRequirements,
  activityStateHistory,
  programs,
  people,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { assessDeletion } from "@/lib/safe-delete";
import { ACTIVITY_STATUS, WEIGHTING_MODE } from "@/lib/plan/activity-progress";
import { nextActivitySortOrder, recomputeProgramProgress } from "@/lib/plan/program-service";
import { computeReadiness } from "@/lib/plan/readiness";
import { getProgramOverview } from "@/lib/plan/program-service";

export type ActionState = { error?: string; success?: string } | null;

const EDITABLE_PROGRAM_STATES = new Set(["مسودة", "معتمد"]);

/** البرنامج المكتمل أو المؤرشف للقراءة فقط — إعادة الفتح تسبق أي تعديل. */
async function assertProgramEditable(programId: string): Promise<string | null> {
  const [p] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!p) return "البرنامج غير موجود";
  if (p.archivedAt) return "البرنامج مؤرشف — استعده قبل التعديل";
  if (p.completedAt) return "البرنامج مكتمل وللقراءة فقط — أعد فتحه بسبب موثّق قبل التعديل";
  if (!EDITABLE_PROGRAM_STATES.has(p.status)) return `لا يمكن التعديل وحالة البرنامج «${p.status}»`;
  return null;
}

async function recordHistory(entry: {
  activityId: string;
  event: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  fromProgress?: number | null;
  toProgress?: number | null;
  reason?: string | null;
  actorId?: string;
}) {
  await db.insert(activityStateHistory).values(entry);
}

const activitySchema = z.object({
  name: z.string().min(2, "اسم النشاط مطلوب"),
  description: z.string().optional(),
  ownerPersonId: z.string().uuid().optional().or(z.literal("")),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  weight: z.coerce.number().int().min(0).max(100).optional(),
  requiredForCompletion: z.string().optional(),
  notes: z.string().optional(),
});

export async function createActivityAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const blocked = await assertProgramEditable(programId);
  if (blocked) return { error: blocked };

  const parsed = activitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (d.ownerPersonId) {
    const [owner] = await db.select({ id: people.id, active: people.active }).from(people).where(eq(people.id, d.ownerPersonId));
    if (!owner) return { error: "المسؤول المختار غير موجود في سجل المنسوبين" };
    if (!owner.active) return { error: "المسؤول المختار موقوف — اختر منسوباً نشطاً" };
  }

  const [activity] = await db
    .insert(programActivities)
    .values({
      programId,
      name: d.name,
      description: d.description || null,
      ownerPersonId: d.ownerPersonId || null,
      plannedStart: d.plannedStart || null,
      plannedEnd: d.plannedEnd || null,
      weight: d.weight ?? null,
      requiredForCompletion: d.requiredForCompletion === "on",
      notes: d.notes || null,
      sortOrder: await nextActivitySortOrder(programId),
      createdBy: user.id,
    })
    .returning();

  await recordHistory({ activityId: activity.id, event: "created", toStatus: activity.status, toProgress: 0, actorId: user.id });
  await recomputeProgramProgress(programId);
  await audit({
    actorId: user.id,
    action: "activity.created",
    entityType: "activity",
    entityId: activity.id,
    summary: `إضافة نشاط «${activity.name}»`,
    detail: { programId },
  });
  revalidatePath(`/plan/${programId}`);
  return { success: "أُضيف النشاط" };
}

export async function updateActivityAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };

  const parsed = activitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (d.ownerPersonId) {
    const [owner] = await db.select({ id: people.id, active: people.active }).from(people).where(eq(people.id, d.ownerPersonId));
    if (!owner) return { error: "المسؤول المختار غير موجود في سجل المنسوبين" };
    if (!owner.active) return { error: "المسؤول المختار موقوف — اختر منسوباً نشطاً" };
  }

  await db
    .update(programActivities)
    .set({
      name: d.name,
      description: d.description || null,
      ownerPersonId: d.ownerPersonId || null,
      plannedStart: d.plannedStart || null,
      plannedEnd: d.plannedEnd || null,
      weight: d.weight ?? null,
      requiredForCompletion: d.requiredForCompletion === "on",
      notes: d.notes || null,
      updatedAt: new Date(),
    })
    .where(eq(programActivities.id, activityId));

  await recomputeProgramProgress(current.programId);
  await audit({
    actorId: user.id,
    action: "activity.updated",
    entityType: "activity",
    entityId: activityId,
    summary: `تعديل نشاط «${d.name}»`,
  });
  revalidatePath(`/plan/${current.programId}`);
  return { success: "حُفظت التعديلات" };
}

/**
 * تحديث نسبة الإنجاز. لا قيمة افتراضية مخترعة: «قيد التنفيذ» يتطلب رقماً صريحاً 1..99،
 * و100٪ تعني «مكتمل» فيمر عبر إجراء الاكتمال لا عبر تحريك الشريط.
 */
export async function updateActivityProgressAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };

  const value = Number(formData.get("progress"));
  if (!Number.isFinite(value) || value < 0 || value > 99) {
    return { error: "نسبة الإنجاز بين 0 و99 — استخدم «إكمال النشاط» لتسجيل 100٪" };
  }

  const toStatus = value > 0 ? ACTIVITY_STATUS.inProgress : current.status === ACTIVITY_STATUS.completed ? ACTIVITY_STATUS.reopened : current.status;
  await db
    .update(programActivities)
    .set({
      progress: Math.trunc(value),
      status: toStatus,
      actualStart: current.actualStart ?? (value > 0 ? new Date().toISOString().slice(0, 10) : null),
      updatedAt: new Date(),
    })
    .where(eq(programActivities.id, activityId));

  await recordHistory({
    activityId,
    event: "progress_changed",
    fromStatus: current.status,
    toStatus,
    fromProgress: current.progress,
    toProgress: Math.trunc(value),
    actorId: user.id,
  });
  await recomputeProgramProgress(current.programId);
  revalidatePath(`/plan/${current.programId}`);
  return { success: "حُدّثت نسبة الإنجاز" };
}

export async function completeActivityAction(activityId: string): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };
  if (current.status === ACTIVITY_STATUS.completed) return { error: "النشاط مكتمل بالفعل" };

  const now = new Date();
  await db
    .update(programActivities)
    .set({
      status: ACTIVITY_STATUS.completed,
      progress: 100,
      completedAt: now,
      completedBy: user.id,
      actualEnd: current.actualEnd ?? now.toISOString().slice(0, 10),
      updatedAt: now,
    })
    .where(eq(programActivities.id, activityId));

  await recordHistory({
    activityId,
    event: "completed",
    fromStatus: current.status,
    toStatus: ACTIVITY_STATUS.completed,
    fromProgress: current.progress,
    toProgress: 100,
    actorId: user.id,
  });
  await recomputeProgramProgress(current.programId);
  await audit({ actorId: user.id, action: "activity.completed", entityType: "activity", entityId: activityId, summary: `إكمال نشاط «${current.name}»` });
  revalidatePath(`/plan/${current.programId}`);
  return { success: "اكتمل النشاط" };
}

export async function reopenActivityAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "اذكر سبب إعادة الفتح" };

  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };
  if (current.status !== ACTIVITY_STATUS.completed) return { error: "النشاط ليس مكتملاً" };

  // تاريخ الاكتمال السابق يبقى في سجل الحالات — لا يُمحى
  await db
    .update(programActivities)
    .set({ status: ACTIVITY_STATUS.reopened, progress: 99, completedAt: null, completedBy: null, updatedAt: new Date() })
    .where(eq(programActivities.id, activityId));

  await recordHistory({
    activityId,
    event: "reopened",
    fromStatus: ACTIVITY_STATUS.completed,
    toStatus: ACTIVITY_STATUS.reopened,
    fromProgress: 100,
    toProgress: 99,
    reason,
    actorId: user.id,
  });
  await recomputeProgramProgress(current.programId);
  await audit({ actorId: user.id, action: "activity.reopened", entityType: "activity", entityId: activityId, summary: `إعادة فتح نشاط «${current.name}»`, detail: { reason } });
  revalidatePath(`/plan/${current.programId}`);
  return { success: "أُعيد فتح النشاط" };
}

/** الإلغاء يتطلب سبباً مدققاً ويخرج النشاط من الأوزان — تُعاد صحة الأوزان للتحقق. */
export async function cancelActivityAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "اذكر سبب الإلغاء" };

  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };

  await db
    .update(programActivities)
    .set({ status: ACTIVITY_STATUS.cancelled, cancelReason: reason, updatedAt: new Date() })
    .where(eq(programActivities.id, activityId));

  await recordHistory({ activityId, event: "cancelled", fromStatus: current.status, toStatus: ACTIVITY_STATUS.cancelled, reason, actorId: user.id });
  await recomputeProgramProgress(current.programId);
  await audit({ actorId: user.id, action: "activity.cancelled", entityType: "activity", entityId: activityId, summary: `إلغاء نشاط «${current.name}»`, detail: { reason } });

  // إعادة التحقق من الأوزان بعد خروج النشاط من الحساب
  const overview = await getProgramOverview(current.programId);
  const weightWarning = overview && !overview.progress.weights.valid
    ? ` — تنبيه: ${overview.progress.weights.problemsAr.join("، ")}`
    : "";
  revalidatePath(`/plan/${current.programId}`);
  return { success: `أُلغي النشاط${weightWarning}` };
}

export async function archiveActivityAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "اذكر سبب الأرشفة" };

  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  if (current.archivedAt) return { error: "النشاط مؤرشف بالفعل" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };

  await db
    .update(programActivities)
    .set({ archivedAt: new Date(), archivedBy: user.id, archivedReason: reason, updatedAt: new Date() })
    .where(eq(programActivities.id, activityId));

  await recordHistory({ activityId, event: "archived", fromStatus: current.status, toStatus: current.status, reason, actorId: user.id });
  await recomputeProgramProgress(current.programId);
  await audit({ actorId: user.id, action: "activity.archived", entityType: "activity", entityId: activityId, summary: `أرشفة نشاط «${current.name}»`, detail: { reason } });
  revalidatePath(`/plan/${current.programId}`);
  return { success: "أُرشف النشاط — يمكن استعادته" };
}

export async function restoreActivityAction(activityId: string): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  if (!current.archivedAt) return { error: "النشاط غير مؤرشف" };

  await db
    .update(programActivities)
    .set({ archivedAt: null, archivedBy: null, archivedReason: null, updatedAt: new Date() })
    .where(eq(programActivities.id, activityId));

  await recordHistory({ activityId, event: "restored", toStatus: current.status, actorId: user.id });
  await recomputeProgramProgress(current.programId);
  await audit({ actorId: user.id, action: "activity.restored", entityType: "activity", entityId: activityId, summary: `استعادة نشاط «${current.name}»` });
  revalidatePath(`/plan/${current.programId}`);
  return { success: "استُعيد النشاط" };
}

/** إعادة الترتيب — تبديل موضع النشاط مع جاره في الاتجاه المطلوب. */
export async function moveActivityAction(activityId: string, direction: "up" | "down"): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };

  const siblings = await db
    .select()
    .from(programActivities)
    .where(and(eq(programActivities.programId, current.programId), isNull(programActivities.archivedAt)))
    .orderBy(asc(programActivities.sortOrder), asc(programActivities.createdAt));

  const idx = siblings.findIndex((s) => s.id === activityId);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= siblings.length) return { error: "لا يمكن النقل أبعد من ذلك" };

  const a = siblings[idx];
  const b = siblings[swapWith];
  await db.transaction(async (tx) => {
    await tx.update(programActivities).set({ sortOrder: b.sortOrder }).where(eq(programActivities.id, a.id));
    await tx.update(programActivities).set({ sortOrder: a.sortOrder }).where(eq(programActivities.id, b.id));
  });

  revalidatePath(`/plan/${current.programId}`);
  return { success: "تغيّر الترتيب" };
}

/** نسخ نشاط بمخرجاته ومتطلبات شواهده — بلا شواهد مرتبطة وبلا تاريخ تنفيذ. */
export async function duplicateActivityAction(activityId: string): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [src] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!src) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(src.programId);
  if (blocked) return { error: blocked };

  const [dels, reqs, order] = await Promise.all([
    db.select().from(activityDeliverables).where(eq(activityDeliverables.activityId, activityId)),
    db.select().from(activityEvidenceRequirements).where(eq(activityEvidenceRequirements.activityId, activityId)),
    nextActivitySortOrder(src.programId),
  ]);

  const copyId = await db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(programActivities)
      .values({
        programId: src.programId,
        // النسخة لا ترث مرجع المعلم القديم — المرجع فريد ويخص السجل الأصلي وحده
        migratedFromMilestoneId: null,
        name: `${src.name} (نسخة)`,
        description: src.description,
        ownerPersonId: src.ownerPersonId,
        plannedStart: src.plannedStart,
        plannedEnd: src.plannedEnd,
        weight: src.weight,
        requiredForCompletion: src.requiredForCompletion,
        notes: src.notes,
        sortOrder: order,
        status: ACTIVITY_STATUS.notStarted,
        progress: 0,
        createdBy: user.id,
      })
      .returning();

    for (const d of dels) {
      await tx.insert(activityDeliverables).values({
        activityId: copy.id,
        name: d.name,
        description: d.description,
        required: d.required,
        sortOrder: d.sortOrder,
      });
    }
    for (const r of reqs) {
      await tx.insert(activityEvidenceRequirements).values({
        activityId: copy.id,
        label: r.label,
        requiredRole: r.requiredRole,
        minCount: r.minCount,
        required: r.required,
        sortOrder: r.sortOrder,
      });
    }
    return copy.id;
  });

  await recomputeProgramProgress(src.programId);
  await audit({ actorId: user.id, action: "activity.duplicated", entityType: "activity", entityId: copyId, summary: `نسخ نشاط «${src.name}»`, detail: { sourceId: activityId } });
  revalidatePath(`/plan/${src.programId}`);
  return { success: "نُسخ النشاط" };
}

/** الحذف النهائي — فقط لنشاط بلا أي أثر تنفيذي؛ وإلا الأرشفة. */
export async function deleteActivityAction(activityId: string): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [current] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!current) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(current.programId);
  if (blocked) return { error: blocked };

  if (current.migratedFromMilestoneId) {
    return { error: "هذا النشاط منقول من معلم قديم ويُحتفظ به للمطابقة — أرشفه بدل حذفه." };
  }

  const assessment = await assessDeletion("activity", activityId);
  if (assessment.blocked) return { error: assessment.messageAr };

  await db.delete(programActivities).where(eq(programActivities.id, activityId));
  await recomputeProgramProgress(current.programId);
  await audit({
    actorId: user.id,
    action: "activity.deleted",
    entityType: "activity",
    entityId: activityId,
    summary: `حذف نهائي لنشاط «${current.name}» بلا أثر تنفيذي`,
  });
  revalidatePath(`/plan/${current.programId}`);
  return { success: "حُذف النشاط نهائياً" };
}

// ————————————————————— مخرجات النشاط ومتطلبات شواهده —————————————————————

export async function addActivityDeliverableAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [act] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!act) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(act.programId);
  if (blocked) return { error: blocked };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "اسم المخرج مطلوب" };

  const existing = await db.select().from(activityDeliverables).where(eq(activityDeliverables.activityId, activityId));
  await db.insert(activityDeliverables).values({
    activityId,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    required: formData.get("required") === "on",
    sortOrder: existing.length,
  });
  await audit({ actorId: user.id, action: "activity.deliverable_added", entityType: "activity", entityId: activityId, summary: `إضافة مخرج «${name}»` });
  revalidatePath(`/plan/${act.programId}`);
  return { success: "أُضيف المخرج" };
}

export async function toggleActivityDeliverableAction(deliverableId: string): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [d] = await db.select().from(activityDeliverables).where(eq(activityDeliverables.id, deliverableId));
  if (!d) return { error: "المخرج غير موجود" };
  const [act] = await db.select().from(programActivities).where(eq(programActivities.id, d.activityId));
  if (!act) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(act.programId);
  if (blocked) return { error: blocked };

  const next = !d.completed;
  await db
    .update(activityDeliverables)
    .set({ completed: next, completedAt: next ? new Date() : null, completedBy: next ? user.id : null })
    .where(eq(activityDeliverables.id, deliverableId));
  await audit({
    actorId: user.id,
    action: next ? "activity.deliverable_completed" : "activity.deliverable_reopened",
    entityType: "activity",
    entityId: d.activityId,
    summary: `${next ? "إنجاز" : "إعادة فتح"} مخرج «${d.name}»`,
  });
  revalidatePath(`/plan/${act.programId}`);
  return { success: next ? "سُجّل إنجاز المخرج" : "أُعيد فتح المخرج" };
}

export async function addEvidenceRequirementAction(activityId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [act] = await db.select().from(programActivities).where(eq(programActivities.id, activityId));
  if (!act) return { error: "النشاط غير موجود" };
  const blocked = await assertProgramEditable(act.programId);
  if (blocked) return { error: blocked };

  const label = String(formData.get("label") ?? "").trim();
  if (label.length < 2) return { error: "وصف المتطلب مطلوب" };
  const minCount = Number(formData.get("minCount") ?? 1);
  if (!Number.isFinite(minCount) || minCount < 1) return { error: "الحد الأدنى للشواهد يجب أن يكون 1 فأكثر" };

  const existing = await db.select().from(activityEvidenceRequirements).where(eq(activityEvidenceRequirements.activityId, activityId));
  await db.insert(activityEvidenceRequirements).values({
    activityId,
    label,
    requiredRole: String(formData.get("requiredRole") ?? "").trim() || null,
    minCount: Math.trunc(minCount),
    required: formData.get("required") === "on",
    sortOrder: existing.length,
  });
  await audit({ actorId: user.id, action: "activity.evidence_requirement_added", entityType: "activity", entityId: activityId, summary: `إضافة متطلب شاهد «${label}»` });
  revalidatePath(`/plan/${act.programId}`);
  return { success: "أُضيف متطلب الشاهد" };
}

// ————————————————————————— وضع الوزن —————————————————————————

export async function setWeightingModeAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const blocked = await assertProgramEditable(programId);
  if (blocked) return { error: blocked };

  const mode = String(formData.get("weightingMode") ?? "");
  if (mode !== WEIGHTING_MODE.equal && mode !== WEIGHTING_MODE.custom) return { error: "وضع وزن غير معروف" };

  await db.update(programs).set({ weightingMode: mode, updatedAt: new Date() }).where(eq(programs.id, programId));
  await recomputeProgramProgress(programId);
  await audit({ actorId: user.id, action: "program.weighting_mode_changed", entityType: "program", entityId: programId, summary: `وضع الوزن: ${mode}` });

  // لا تطبيع صامت: المجموع المخالف يُعلن فوراً ويظهر في قائمة الجاهزية
  const overview = await getProgramOverview(programId);
  const invalid = overview && !overview.progress.weights.valid;
  revalidatePath(`/plan/${programId}`);
  return invalid
    ? { success: `تغيّر وضع الوزن إلى «${mode}» — تنبيه: ${overview!.progress.weights.problemsAr.join("، ")}` }
    : { success: `تغيّر وضع الوزن إلى «${mode}»` };
}

// ————————————————————— اكتمال البرنامج وإعادة فتحه —————————————————————

/** الاكتمال الطبيعي — مسموح فقط عند جاهزية 100٪. */
export async function completeProgramAction(programId: string): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const overview = await getProgramOverview(programId);
  if (!overview) return { error: "البرنامج غير موجود" };
  if (overview.program.completedAt) return { error: "البرنامج مكتمل بالفعل" };

  if (!overview.readiness.ready) {
    const list = overview.readiness.missing.map((m) => `• ${m.labelAr}`).join("\n");
    return {
      error: `لا يمكن الإقفال — الجاهزية ${overview.readiness.percent}٪ والنواقص:\n${list}\n\nيمكن للمدير الإقفال بتجاوز موثّق.`,
    };
  }

  await db
    .update(programs)
    .set({ completedAt: new Date(), completedBy: user.id, executionStatus: "مكتمل", updatedAt: new Date() })
    .where(eq(programs.id, programId));
  await audit({
    actorId: user.id,
    action: "program.completed",
    entityType: "program",
    entityId: programId,
    summary: `إقفال البرنامج «${overview.program.name}» بجاهزية 100٪`,
    detail: { readiness: 100, progress: overview.progress.display },
  });
  revalidatePath(`/plan/${programId}`);
  return { success: "أُقفل البرنامج" };
}

/**
 * الإقفال بتجاوز — للمدير حصراً، بمبرر إلزامي.
 * تُحفظ لقطة الجاهزية والنواقص وقت التجاوز، فلا تختفي من التقارير التاريخية.
 */
export async function overrideCompleteProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.approve", "plan.override");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 10) return { error: "المبرر مطلوب — اكتب سبباً واضحاً لا يقل عن 10 أحرف" };

  const overview = await getProgramOverview(programId);
  if (!overview) return { error: "البرنامج غير موجود" };
  if (overview.program.completedAt) return { error: "البرنامج مكتمل بالفعل" };
  if (overview.readiness.ready) return { error: "الجاهزية مكتملة — استخدم الإقفال الطبيعي بدل التجاوز" };

  const missing = overview.readiness.missing.map((m) => m.labelAr);
  const now = new Date();
  await db
    .update(programs)
    .set({
      completedAt: now,
      completedBy: user.id,
      completionOverride: true,
      overrideReason: reason,
      overrideBy: user.id,
      overrideAt: now,
      overrideReadiness: overview.readiness.percent,
      overrideMissing: missing,
      executionStatus: "مكتمل",
      updatedAt: now,
    })
    .where(eq(programs.id, programId));

  await audit({
    actorId: user.id,
    action: "program.completed_with_override",
    entityType: "program",
    entityId: programId,
    summary: `إقفال «${overview.program.name}» بتجاوز — الجاهزية ${overview.readiness.percent}٪`,
    detail: { reason, readiness: overview.readiness.percent, missing },
  });
  revalidatePath(`/plan/${programId}`);
  return { success: `أُقفل البرنامج بتجاوز موثّق — ${missing.length} متطلباً ناقصاً محفوظاً في السجل` };
}

export async function reopenProgramCompletionAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "اذكر سبب إعادة الفتح" };

  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (!program.completedAt) return { error: "البرنامج غير مكتمل" };

  // تاريخ الإقفال السابق (بما فيه التجاوز ونواقصه) يبقى في سجل التدقيق
  await db
    .update(programs)
    .set({ completedAt: null, completedBy: null, executionStatus: "قيد التنفيذ", updatedAt: new Date() })
    .where(eq(programs.id, programId));

  await audit({
    actorId: user.id,
    action: "program.completion_reopened",
    entityType: "program",
    entityId: programId,
    summary: `إعادة فتح البرنامج «${program.name}»`,
    detail: {
      reason,
      previousCompletion: {
        completedAt: program.completedAt,
        override: program.completionOverride,
        overrideReason: program.overrideReason,
        overrideReadiness: program.overrideReadiness,
        overrideMissing: program.overrideMissing,
      },
    },
  });
  revalidatePath(`/plan/${programId}`);
  return { success: "أُعيد فتح البرنامج — سجل الإقفال السابق محفوظ" };
}

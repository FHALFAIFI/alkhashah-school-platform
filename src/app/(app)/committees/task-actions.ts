"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  committees, committeeTemplates, committeeMembers, committeeTaskAssignments, committeeTaskTemplates, meetingTypes,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { seedCommitteeTaskTemplates, activeTaskTemplatesFor } from "@/lib/committees/task-templates";

export type ActionState = { error?: string; success?: string } | null;

async function committeeTemplateKey(committeeId: string): Promise<string | null> {
  const [c] = await db.select({ templateId: committees.templateId }).from(committees).where(eq(committees.id, committeeId));
  if (!c?.templateId) return null;
  const [t] = await db.select({ key: committeeTemplates.key }).from(committeeTemplates).where(eq(committeeTemplates.id, c.templateId));
  return t?.key ?? null;
}

async function nextAssignmentOrder(committeeId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(sort_order), -1)::int` })
    .from(committeeTaskAssignments)
    .where(eq(committeeTaskAssignments.committeeId, committeeId));
  return (row?.n ?? -1) + 1;
}

/** تحميل المهام المعرّفة مسبقاً لنوع اللجنة إلى توزيعها (بلا تكرار المحمّل سابقاً). */
export async function loadCommitteeTasksAction(committeeId: string): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status === "مقفلة") return { error: "اللجنة مقفلة — لا تعديل" };
  const key = await committeeTemplateKey(committeeId);
  if (!key) return { error: "لا نوع قالب لهذه اللجنة — أضف المهام يدوياً" };
  await seedCommitteeTaskTemplates();
  const templates = await activeTaskTemplatesFor(key);
  if (templates.length === 0) return { error: "لا مهام معرّفة مسبقاً لهذا النوع — أضفها من إدارة قوالب المهام أو يدوياً" };
  const existing = await db
    .select({ from: committeeTaskAssignments.fromTemplateId })
    .from(committeeTaskAssignments)
    .where(eq(committeeTaskAssignments.committeeId, committeeId));
  const loaded = new Set(existing.map((e) => e.from).filter((x): x is string => !!x));
  const toAdd = templates.filter((t) => !loaded.has(t.id));
  if (toAdd.length === 0) return { success: "المهام المعرّفة مسبقاً محمّلة بالفعل" };
  const base = await nextAssignmentOrder(committeeId);
  await db.insert(committeeTaskAssignments).values(
    toAdd.map((t, i) => ({ committeeId, title: t.title, sortOrder: base + i, fromTemplateId: t.id })),
  );
  await audit({ actorId: user.id, action: "committee.tasks_loaded", entityType: "committee", entityId: committeeId, summary: `تحميل ${toAdd.length} مهمة معرّفة مسبقاً` });
  revalidatePath(`/committees/${committeeId}`);
  return { success: `حُمّلت ${toAdd.length} مهمة معرّفة مسبقاً — راجعها ووزّعها على الأعضاء` };
}

const taskSchema = z.object({ title: z.string().trim().min(2, "نص المهمة مطلوب"), notes: z.string().optional() });

export async function addCommitteeTaskAction(committeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [c] = await db.select({ status: committees.status }).from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status === "مقفلة") return { error: "اللجنة مقفلة — لا تعديل" };
  await db.insert(committeeTaskAssignments).values({
    committeeId,
    title: parsed.data.title,
    notes: parsed.data.notes || null,
    sortOrder: await nextAssignmentOrder(committeeId),
  });
  await audit({ actorId: user.id, action: "committee.task_added", entityType: "committee", entityId: committeeId, summary: parsed.data.title });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "أُضيفت المهمة" };
}

async function taskCommitteeId(taskId: string): Promise<string | null> {
  const [t] = await db.select({ committeeId: committeeTaskAssignments.committeeId }).from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, taskId));
  return t?.committeeId ?? null;
}

export async function updateCommitteeTaskAction(taskId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const committeeId = await taskCommitteeId(taskId);
  if (!committeeId) return { error: "المهمة غير موجودة" };
  await db
    .update(committeeTaskAssignments)
    .set({ title: parsed.data.title, notes: parsed.data.notes || null, updatedAt: new Date() })
    .where(eq(committeeTaskAssignments.id, taskId));
  await audit({ actorId: user.id, action: "committee.task_updated", entityType: "committee", entityId: committeeId, summary: parsed.data.title });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "حُدّثت المهمة" };
}

/** إسناد مهمة لعضو (memberId فارغ = إلغاء الإسناد). */
export async function assignCommitteeTaskAction(taskId: string, memberId: string): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const committeeId = await taskCommitteeId(taskId);
  if (!committeeId) return { error: "المهمة غير موجودة" };
  let assigned: string | null = null;
  if (memberId) {
    const [m] = await db.select({ id: committeeMembers.id }).from(committeeMembers).where(and(eq(committeeMembers.id, memberId), eq(committeeMembers.committeeId, committeeId)));
    if (!m) return { error: "العضو غير موجود في هذه اللجنة" };
    assigned = m.id;
  }
  await db.update(committeeTaskAssignments).set({ assignedMemberId: assigned, updatedAt: new Date() }).where(eq(committeeTaskAssignments.id, taskId));
  await audit({ actorId: user.id, action: "committee.task_assigned", entityType: "committee", entityId: committeeId });
  revalidatePath(`/committees/${committeeId}`);
  return null;
}

export async function toggleCommitteeTaskExcludedAction(taskId: string, excluded: boolean): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const committeeId = await taskCommitteeId(taskId);
  if (!committeeId) return { error: "المهمة غير موجودة" };
  await db.update(committeeTaskAssignments).set({ excluded, updatedAt: new Date() }).where(eq(committeeTaskAssignments.id, taskId));
  await audit({ actorId: user.id, action: excluded ? "committee.task_excluded" : "committee.task_included", entityType: "committee", entityId: committeeId });
  revalidatePath(`/committees/${committeeId}`);
  return null;
}

export async function deleteCommitteeTaskAction(taskId: string): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const committeeId = await taskCommitteeId(taskId);
  if (!committeeId) return { error: "المهمة غير موجودة" };
  await db.delete(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, taskId));
  await audit({ actorId: user.id, action: "committee.task_deleted", entityType: "committee", entityId: committeeId });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "حُذفت المهمة" };
}

export async function moveCommitteeTaskAction(taskId: string, direction: "up" | "down"): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [task] = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, taskId));
  if (!task) return { error: "المهمة غير موجودة" };
  const siblings = await db
    .select()
    .from(committeeTaskAssignments)
    .where(eq(committeeTaskAssignments.committeeId, task.committeeId))
    .orderBy(asc(committeeTaskAssignments.sortOrder));
  const idx = siblings.findIndex((s) => s.id === taskId);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return null;
  const other = siblings[swapWith];
  await db.update(committeeTaskAssignments).set({ sortOrder: other.sortOrder }).where(eq(committeeTaskAssignments.id, task.id));
  await db.update(committeeTaskAssignments).set({ sortOrder: task.sortOrder }).where(eq(committeeTaskAssignments.id, other.id));
  await audit({ actorId: user.id, action: "committee.task_reordered", entityType: "committee", entityId: task.committeeId });
  revalidatePath(`/committees/${task.committeeId}`);
  return null;
}

// ————————————————————— إدارة قوالب المهام المركزية (D-027) —————————————————————

export async function seedTaskTemplatesAction(): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const { seeded } = await seedCommitteeTaskTemplates();
  await audit({ actorId: user.id, action: "committee_task_template.seeded", summary: `بذر ${seeded} قالب مهمة` });
  revalidatePath("/committees/task-templates");
  return { success: seeded > 0 ? `بُذرت ${seeded} مهمة معرّفة مسبقاً من مهام القوالب` : "قوالب المهام مبذورة بالفعل" };
}

const templateSchema = z.object({ templateKey: z.string().min(1), title: z.string().trim().min(2, "نص المهمة مطلوب") });

export async function addTaskTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(sort_order), -1)::int` })
    .from(committeeTaskTemplates)
    .where(eq(committeeTaskTemplates.templateKey, parsed.data.templateKey));
  await db.insert(committeeTaskTemplates).values({
    templateKey: parsed.data.templateKey,
    title: parsed.data.title,
    sortOrder: (row?.n ?? -1) + 1,
  });
  await audit({ actorId: user.id, action: "committee_task_template.added", summary: `${parsed.data.templateKey}: ${parsed.data.title}` });
  revalidatePath("/committees/task-templates");
  return { success: "أُضيف قالب المهمة" };
}

export async function updateTaskTemplateAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const title = String(formData.get("title") ?? "").trim();
  if (title.length < 2) return { error: "نص المهمة مطلوب" };
  const [t] = await db.select().from(committeeTaskTemplates).where(eq(committeeTaskTemplates.id, id));
  if (!t) return { error: "القالب غير موجود" };
  // تعديل القالب لا يعيد كتابة أي توزيع أو وثيقة صدرت سابقاً (نسخ مستقلة/لقطات ثابتة)
  await db.update(committeeTaskTemplates).set({ title, updatedAt: new Date() }).where(eq(committeeTaskTemplates.id, id));
  await audit({ actorId: user.id, action: "committee_task_template.updated", summary: title });
  revalidatePath("/committees/task-templates");
  return { success: "حُدّث قالب المهمة (لا يؤثر على التوزيعات الصادرة)" };
}

export async function toggleTaskTemplateAction(id: string, active: boolean): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [t] = await db.select().from(committeeTaskTemplates).where(eq(committeeTaskTemplates.id, id));
  if (!t) return { error: "القالب غير موجود" };
  await db.update(committeeTaskTemplates).set({ active, updatedAt: new Date() }).where(eq(committeeTaskTemplates.id, id));
  await audit({ actorId: user.id, action: active ? "committee_task_template.enabled" : "committee_task_template.disabled", summary: t.title });
  revalidatePath("/committees/task-templates");
  return null;
}

export async function moveTaskTemplateAction(id: string, direction: "up" | "down"): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [t] = await db.select().from(committeeTaskTemplates).where(eq(committeeTaskTemplates.id, id));
  if (!t) return { error: "القالب غير موجود" };
  const siblings = await db
    .select()
    .from(committeeTaskTemplates)
    .where(eq(committeeTaskTemplates.templateKey, t.templateKey))
    .orderBy(asc(committeeTaskTemplates.sortOrder));
  const idx = siblings.findIndex((s) => s.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= siblings.length) return null;
  const other = siblings[swapWith];
  await db.update(committeeTaskTemplates).set({ sortOrder: other.sortOrder }).where(eq(committeeTaskTemplates.id, t.id));
  await db.update(committeeTaskTemplates).set({ sortOrder: t.sortOrder }).where(eq(committeeTaskTemplates.id, other.id));
  revalidatePath("/committees/task-templates");
  return null;
}

export async function deleteTaskTemplateAction(id: string): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [t] = await db.select().from(committeeTaskTemplates).where(eq(committeeTaskTemplates.id, id));
  if (!t) return { error: "القالب غير موجود" };
  await db.delete(committeeTaskTemplates).where(eq(committeeTaskTemplates.id, id));
  await audit({ actorId: user.id, action: "committee_task_template.deleted", summary: t.title });
  revalidatePath("/committees/task-templates");
  return { success: "حُذف قالب المهمة (لا يؤثر على التوزيعات الصادرة)" };
}

/** ضبط اشتراط التوقيع لنوع اجتماع (D-027) — القاعدة العامة أُزيلت؛ التوقيع لكل نوع على حدة. */
export async function setMeetingTypeSignatureAction(typeId: string, requiresSignature: boolean): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [mt] = await db.select().from(meetingTypes).where(eq(meetingTypes.id, typeId));
  if (!mt) return { error: "نوع الاجتماع غير موجود" };
  await db.update(meetingTypes).set({ requiresSignature }).where(eq(meetingTypes.id, typeId));
  await audit({
    actorId: user.id,
    action: "meeting_type.signature_requirement_changed",
    entityType: "meeting_type",
    entityId: typeId,
    summary: `${mt.nameAr}: ${requiresSignature ? "يتطلب توقيعاً" : "لا يتطلب توقيعاً"}`,
  });
  revalidatePath("/committees/meeting-types");
  return { success: requiresSignature ? "أصبح هذا النوع يتطلب محضراً موقعاً لاكتماله" : "لم يعد هذا النوع يتطلب توقيعاً" };
}

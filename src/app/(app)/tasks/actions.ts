"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { actionTasks } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";

export type ActionState = { error?: string; success?: string } | null;

const taskSchema = z.object({
  // Optional per v2.1 global rule — empty title stored as "" (NOT-NULL column satisfied).
  title: z.string().optional(),
  description: z.string().optional(),
  ownerPersonId: z.string().optional(),
  ownerText: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(["عالية", "متوسطة", "منخفضة"]).default("متوسطة"),
});

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("tasks.write");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(actionTasks).values({
    title: parsed.data.title ?? "",
    description: parsed.data.description || null,
    ownerPersonId: parsed.data.ownerPersonId || null,
    ownerText: parsed.data.ownerText || null,
    dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    priority: parsed.data.priority,
    sourceType: "manual",
    createdBy: user.id,
  });
  await audit({ actorId: user.id, action: "task.created", summary: `مهمة جديدة: ${orFallback(parsed.data.title)}` });
  revalidatePath("/tasks");
  return { success: "أضيفت المهمة" };
}

export async function updateTaskStatusAction(taskId: string, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("tasks.write");
  const status = String(formData.get("status") ?? "جديدة");
  const progress = Math.max(0, Math.min(100, Number(formData.get("progress") ?? 0)));
  const [task] = await db.select().from(actionTasks).where(eq(actionTasks.id, taskId));
  if (!task) return { error: "المهمة غير موجودة" };
  if (task.mandatory && status === "ملغاة") {
    // الإجراء الإلزامي (الناتج عن قرار اجتماع) لا يلغى
    return { error: "لا يلغى إجراء إلزامي ناتج عن قرار — أنجزه أو حدث تقدمه" };
  }
  await db
    .update(actionTasks)
    .set({ status, progress: status === "مكتملة" ? 100 : progress, updatedAt: new Date() })
    .where(eq(actionTasks.id, taskId));
  await audit({ actorId: user.id, action: "task.updated", entityType: "task", entityId: taskId, summary: `تحديث مهمة إلى «${status}»` });
  revalidatePath("/tasks");
  return { success: "حدثت المهمة" };
}

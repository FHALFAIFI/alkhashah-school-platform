"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  programs, programMilestones, programChangeRequests, programDeliverables, planYears, programFollowups,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { assessDeletion } from "@/lib/safe-delete";
import { snapshotRecord } from "@/lib/versioning";
import { computeProgramProgress } from "@/lib/plan/progress";
import { FOLLOWUP_STATUSES, isoWeekKey } from "@/lib/plan/followup";
import { notifyAll, notifyUser } from "@/lib/notify";

export type ActionState = { error?: string; success?: string } | null;

async function recomputeProgress(programId: string) {
  const ms = await db.select().from(programMilestones).where(eq(programMilestones.programId, programId));
  const progress = computeProgramProgress(ms.map((m) => ({ weight: m.weight, progress: m.progress })));
  await db.update(programs).set({ progress, updatedAt: new Date() }).where(eq(programs.id, programId));
}

/** تحديث معلم — التقدم يحسب من المعالم الموزونة حصراً */
export async function updateMilestoneAction(milestoneId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("plan.write");
  const progress = Math.max(0, Math.min(100, Number(formData.get("progress") ?? 0)));
  const status = progress >= 100 ? "مكتمل" : progress > 0 ? "قيد التنفيذ" : "لم يبدأ";
  const [ms] = await db
    .update(programMilestones)
    .set({ progress, status, completedAt: progress >= 100 ? new Date() : null, notes: String(formData.get("notes") ?? "") || null })
    .where(eq(programMilestones.id, milestoneId))
    .returning();
  if (ms) {
    await recomputeProgress(ms.programId);
    await audit({ actorId: user.id, action: "program.milestone_updated", entityType: "program", entityId: ms.programId, summary: `تحديث معلم «${ms.title}» إلى ${progress}٪` });
    revalidatePath(`/plan/${ms.programId}`);
    revalidatePath("/plan");
  }
}

const milestoneSchema = z.object({
  title: z.string().min(2, "عنوان المعلم مطلوب"),
  weight: z.coerce.number().int().min(0).max(100),
  dueText: z.string().optional(),
});

export async function addMilestoneAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "مسودة") return { error: "البرنامج معتمد — استخدم طلب تغيير لتعديل المعالم" };
  const parsed = milestoneSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const existing = await db.select().from(programMilestones).where(eq(programMilestones.programId, programId));
  if (existing.some((m) => m.title.trim() === parsed.data.title.trim())) {
    return { error: "يوجد معلم بنفس العنوان في هذا البرنامج" };
  }
  await db.insert(programMilestones).values({
    programId,
    title: parsed.data.title,
    weight: parsed.data.weight,
    dueText: parsed.data.dueText || null,
    sortOrder: existing.length,
  });
  await recomputeProgress(programId);
  await audit({ actorId: user.id, action: "program.milestone_added", entityType: "program", entityId: programId });
  revalidatePath(`/plan/${programId}`);
  return { success: "أضيف المعلم" };
}

export async function updateMilestoneWeightAction(milestoneId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("plan.write");
  const weight = Math.max(0, Math.min(100, Number(formData.get("weight") ?? 0)));
  const title = String(formData.get("title") ?? "").trim();
  const [ms] = await db.select().from(programMilestones).where(eq(programMilestones.id, milestoneId));
  if (!ms) return;
  const [program] = await db.select().from(programs).where(eq(programs.id, ms.programId));
  if (!program || program.status !== "مسودة") return;
  await db
    .update(programMilestones)
    .set({ weight, ...(title ? { title } : {}) })
    .where(eq(programMilestones.id, milestoneId));
  await recomputeProgress(ms.programId);
  await audit({ actorId: user.id, action: "program.milestone_weight_updated", entityType: "program", entityId: ms.programId });
  revalidatePath(`/plan/${ms.programId}`);
}

/**
 * حذف معلم — يمر بطبقة الحذف الآمن ويشرح المنع بالعربية بدل الفشل الصامت.
 * الشروط: البرنامج ما زال مسودة، والمعلم لا يحمل شواهد أو وثائق مرتبطة.
 */
export async function deleteMilestoneAction(milestoneId: string): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const [ms] = await db.select().from(programMilestones).where(eq(programMilestones.id, milestoneId));
  if (!ms) return { error: "المعلم غير موجود" };
  const [program] = await db.select().from(programs).where(eq(programs.id, ms.programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "مسودة") {
    return { error: `لا يمكن حذف معلم من برنامج حالته «${program.status}» — أعد فتح البرنامج بطلب تغيير موثّق أولاً.` };
  }

  const assessment = await assessDeletion("milestone", milestoneId);
  if (assessment.blocked) return { error: assessment.messageAr };

  await db.delete(programMilestones).where(eq(programMilestones.id, milestoneId));
  await recomputeProgress(ms.programId);
  await audit({
    actorId: user.id,
    action: "program.milestone_deleted",
    entityType: "program",
    entityId: ms.programId,
    summary: `حذف معلم «${ms.title}» من برنامج مسودة`,
  });
  revalidatePath(`/plan/${ms.programId}`);
  return { success: "حُذف المعلم" };
}

/** اعتماد وإقفال حزمة البرنامج كاملة — المدير يعتمد الحزمة وليس كل مرفق على حدة */
export async function approveProgramAction(programId: string): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "مسودة") return { error: "البرنامج معتمد مسبقاً" };

  const ms = await db.select().from(programMilestones).where(eq(programMilestones.programId, programId));
  const totalWeight = ms.reduce((s, m) => s + m.weight, 0);
  if (ms.length > 0 && totalWeight !== 100) {
    return { error: `مجموع أوزان المعالم ${totalWeight}٪ ويجب أن يساوي 100٪ قبل الاعتماد` };
  }

  await snapshotRecord({
    entityType: "program",
    entityId: programId,
    action: "approved",
    snapshot: { program, milestones: ms },
    actorId: user.id,
  });
  await db
    .update(programs)
    .set({ status: "معتمد", approvedBy: user.id, approvedAt: new Date(), version: program.version + 1 })
    .where(eq(programs.id, programId));
  await audit({ actorId: user.id, action: "program.approved", entityType: "program", entityId: programId, summary: `اعتماد وإقفال برنامج «${program.name}»` });
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan");
  return { success: "تم الاعتماد والإقفال" };
}

/** إعادة فتح برنامج معتمد — سبب إلزامي وحفظ النسخة السابقة */
export async function reopenProgramAction(programId: string, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "سبب إعادة الفتح إلزامي (5 أحرف على الأقل)" };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program || program.status === "مسودة") return { error: "البرنامج غير معتمد" };
  const ms = await db.select().from(programMilestones).where(eq(programMilestones.programId, programId));
  await snapshotRecord({
    entityType: "program",
    entityId: programId,
    action: "reopened",
    snapshot: { program, milestones: ms },
    reason,
    actorId: user.id,
  });
  await db
    .update(programs)
    .set({ status: "مسودة", version: program.version + 1, updatedAt: new Date() })
    .where(eq(programs.id, programId));
  await audit({ actorId: user.id, action: "program.reopened", entityType: "program", entityId: programId, summary: `إعادة فتح «${program.name}» — السبب: ${reason}` });
  revalidatePath(`/plan/${programId}`);
  return { success: "أعيد فتح البرنامج" };
}

/** طلب تغيير على برنامج معتمد: قيمة قديمة/جديدة وسبب واعتماد */
const changeRequestSchema = z.object({
  field: z.string().min(1),
  fieldLabel: z.string().min(1),
  newValue: z.string().min(1, "القيمة الجديدة مطلوبة"),
  reason: z.string().min(5, "السبب إلزامي"),
});

const CHANGEABLE_FIELDS = new Set([
  "name", "generalGoal", "specificGoal", "rationale", "targetGroup", "mechanism",
  "periodText", "ownerPosition", "participants", "kpiText", "targetText",
  "deliverableText", "evidenceText", "followupText", "expectedImpact", "principalNotes",
]);

export async function createChangeRequestAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = changeRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!CHANGEABLE_FIELDS.has(parsed.data.field)) return { error: "حقل غير قابل للتغيير عبر الطلبات" };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status === "مقفل") return { error: "السنة مقفلة — لا تغييرات" };
  const [pending] = await db
    .select({ id: programChangeRequests.id })
    .from(programChangeRequests)
    .where(and(
      eq(programChangeRequests.programId, programId),
      eq(programChangeRequests.field, parsed.data.field),
      eq(programChangeRequests.status, "قيد الاعتماد"),
    ));
  if (pending) return { error: "يوجد طلب تعديل قائم لهذا الحقل" };
  const oldValue = (program as unknown as Record<string, unknown>)[parsed.data.field];
  await db.insert(programChangeRequests).values({
    programId,
    field: parsed.data.field,
    fieldLabel: parsed.data.fieldLabel,
    oldValue: oldValue === null || oldValue === undefined ? "" : String(oldValue),
    newValue: parsed.data.newValue,
    reason: parsed.data.reason,
    requestedBy: user.id,
  });
  await audit({ actorId: user.id, action: "program.change_requested", entityType: "program", entityId: programId, summary: `طلب تغيير ${parsed.data.fieldLabel}` });
  // لا يوجد إشعار حسب الصلاحية — في هذا النشر ثنائي المستخدمين يكفي إشعار الجميع
  await notifyAll({
    title: "طلب تعديل جديد على برنامج",
    body: `${program.name} — ${parsed.data.fieldLabel}`,
    link: `/plan/${programId}#change-requests`,
  });
  revalidatePath(`/plan/${programId}`);
  return { success: "سجل طلب التغيير — بانتظار اعتماد المدير" };
}

export async function decideChangeRequestAction(requestId: string, decision: "معتمد" | "مرفوض"): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const [req] = await db.select().from(programChangeRequests).where(eq(programChangeRequests.id, requestId));
  if (!req || req.status !== "قيد الاعتماد") return { error: "الطلب غير موجود أو محسوم" };
  const [program] = await db.select().from(programs).where(eq(programs.id, req.programId));
  if (!program) return { error: "البرنامج غير موجود" };

  if (decision === "معتمد") {
    await snapshotRecord({
      entityType: "program",
      entityId: program.id,
      action: "updated",
      snapshot: { program },
      reason: `تنفيذ طلب تغيير: ${req.fieldLabel} — ${req.reason}`,
      actorId: user.id,
    });
    await db
      .update(programs)
      .set({ [req.field]: req.newValue, version: program.version + 1, updatedAt: new Date() } as Record<string, unknown>)
      .where(eq(programs.id, program.id));
  }
  await db
    .update(programChangeRequests)
    .set({ status: decision, decidedBy: user.id, decidedAt: new Date() })
    .where(eq(programChangeRequests.id, requestId));
  await audit({ actorId: user.id, action: "program.change_decided", entityType: "program", entityId: program.id, summary: `${decision === "معتمد" ? "اعتماد" : "رفض"} طلب تغيير ${req.fieldLabel}` });
  if (req.requestedBy) {
    await notifyUser(req.requestedBy, {
      title: decision === "معتمد" ? "اعتمد طلب التعديل" : "رفض طلب التعديل",
      body: `${program.name} — ${req.fieldLabel}`,
      link: `/plan/${req.programId}#change-requests`,
    });
  }
  revalidatePath(`/plan/${req.programId}`);
  return null;
}

/** المتابعة الأسبوعية لبرنامج معتمد — سجل واحد لكل أسبوع ISO (إعادة الإرسال تحدث سجل الأسبوع نفسه) */
const followupSchema = z.object({
  note: z.string().trim().min(2, "نص المتابعة مطلوب"),
  executionStatus: z.enum(FOLLOWUP_STATUSES, { message: "حالة التنفيذ غير صحيحة" }),
});

export async function submitFollowupAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = followupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "معتمد") return { error: "المتابعة الأسبوعية للبرامج المعتمدة فقط" };

  const now = new Date();
  const weekKey = isoWeekKey(now);
  await db
    .insert(programFollowups)
    .values({
      programId,
      weekKey,
      note: parsed.data.note,
      executionStatus: parsed.data.executionStatus,
      progressSnapshot: program.progress,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: [programFollowups.programId, programFollowups.weekKey],
      set: {
        note: parsed.data.note,
        executionStatus: parsed.data.executionStatus,
        progressSnapshot: program.progress,
        createdBy: user.id,
        createdAt: now,
      },
    });
  await db
    .update(programs)
    .set({ lastReviewAt: now, executionStatus: parsed.data.executionStatus, updatedAt: now })
    .where(eq(programs.id, programId));
  await audit({
    actorId: user.id,
    action: "program.followup_recorded",
    entityType: "program",
    entityId: programId,
    summary: `متابعة أسبوعية ${weekKey} لبرنامج «${program.name}» — ${parsed.data.executionStatus}`,
  });
  revalidatePath("/plan/followup");
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan");
  return { success: "سجلت المتابعة الأسبوعية" };
}

/** اعتماد حزمة مخرجات البرنامج */
export async function approvePackageAction(deliverableId: string): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const [d] = await db.select().from(programDeliverables).where(eq(programDeliverables.id, deliverableId));
  if (!d) return { error: "الحزمة غير موجودة" };
  await db
    .update(programDeliverables)
    .set({ packageStatus: "معتمدة", packageDecision: "معتمد", approvedBy: user.id, approvedAt: new Date() })
    .where(eq(programDeliverables.id, deliverableId));
  await audit({ actorId: user.id, action: "package.approved", entityType: "program_deliverable", entityId: deliverableId, summary: `اعتماد حزمة ${d.packageNumber ?? ""}` });
  revalidatePath(`/plan/${d.programId}`);
  return { success: "اعتمدت الحزمة" };
}

/** إقفال السنة وأرشفتها للقراءة فقط */
export async function closePlanYearAction(yearId: string): Promise<ActionState> {
  const user = await requirePermission("plan.close_year");
  const [year] = await db.select().from(planYears).where(eq(planYears.id, yearId));
  if (!year || year.status === "مقفلة") return { error: "السنة غير موجودة أو مقفلة" };
  await db.update(planYears).set({ status: "مقفلة", closedAt: new Date(), closedBy: user.id }).where(eq(planYears.id, yearId));
  await db.update(programs).set({ status: "مقفل" }).where(and(eq(programs.planYearId, yearId), eq(programs.status, "معتمد")));
  await audit({ actorId: user.id, action: "plan_year.closed", entityType: "plan_year", entityId: yearId, summary: `إقفال ${year.nameAr}` });
  await notifyAll({ title: "أقفلت السنة التخطيطية", body: year.nameAr });
  revalidatePath("/plan");
  return { success: "أقفلت السنة وأرشفت" };
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  programs, programChangeRequests, programDeliverables, planYears, programFollowups,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { snapshotRecord } from "@/lib/versioning";
import { FOLLOWUP_STATUSES, isoWeekKey } from "@/lib/plan/followup";
import { notifyAll, notifyUser } from "@/lib/notify";

export type ActionState = { error?: string; success?: string } | null;

/**
 * البرنامج هو وحدة التنفيذ والمتابعة (D-024). التقدم والحالة يُدخلان مباشرةً على البرنامج
 * (`updateProgramExecutionAction` أدناه، والمتابعة الأسبوعية) ولا يُشتقّان من الأنشطة.
 * جداول `program_activities` و`program_milestones` محفوظة فيزيائياً **للقراءة والتدقيق فقط**
 * ولا يوجد في التطبيق أي مسار كتابة إليها، فلا وحدة تقدم موازية ولا احتساب مزدوج.
 */

/** تحديث تقدم البرنامج وحالة تنفيذه مباشرةً — يُحفظ على سجل البرنامج نفسه */
const executionSchema = z.object({
  progress: z.coerce.number().int().min(0, "النسبة بين 0 و100").max(100, "النسبة بين 0 و100"),
  executionStatus: z.enum(FOLLOWUP_STATUSES, { message: "حالة التنفيذ غير صحيحة" }),
});

export async function updateProgramExecutionAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = executionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status === "مقفل") return { error: "السنة مقفلة — لا تعديل على التقدم" };

  await db
    .update(programs)
    .set({ progress: parsed.data.progress, executionStatus: parsed.data.executionStatus, updatedAt: new Date() })
    .where(eq(programs.id, programId));
  await audit({
    actorId: user.id,
    action: "program.progress_updated",
    entityType: "program",
    entityId: programId,
    summary: `تحديث تقدم «${program.name}» إلى ${parsed.data.progress}٪ — ${parsed.data.executionStatus}`,
  });
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan");
  revalidatePath("/plan/followup");
  return { success: "حُدّث تقدم البرنامج وحالته" };
}

/** اعتماد وإقفال حزمة البرنامج كاملة — المدير يعتمد الحزمة وليس كل مرفق على حدة */
export async function approveProgramAction(programId: string): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "مسودة") return { error: "البرنامج معتمد مسبقاً" };

  await snapshotRecord({
    entityType: "program",
    entityId: programId,
    action: "approved",
    snapshot: { program },
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
  await snapshotRecord({
    entityType: "program",
    entityId: programId,
    action: "reopened",
    snapshot: { program },
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

/** المتابعة الأسبوعية لبرنامج معتمد — سجل واحد لكل أسبوع ISO (إعادة الإرسال تحدث سجل الأسبوع نفسه).
 *  التقدم يُدخل مباشرةً هنا (D-024) — لا يُشتقّ من الأنشطة. */
const followupSchema = z.object({
  note: z.string().trim().min(2, "نص المتابعة مطلوب"),
  executionStatus: z.enum(FOLLOWUP_STATUSES, { message: "حالة التنفيذ غير صحيحة" }),
  progress: z.coerce.number().int().min(0, "النسبة بين 0 و100").max(100, "النسبة بين 0 و100").optional(),
});

export async function submitFollowupAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = followupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "معتمد") return { error: "المتابعة الأسبوعية للبرامج المعتمدة فقط" };

  // التقدم المُدخل مباشرةً إن وُجد، وإلا يبقى تقدم البرنامج كما هو
  const progress = parsed.data.progress ?? program.progress;
  const now = new Date();
  const weekKey = isoWeekKey(now);
  await db
    .insert(programFollowups)
    .values({
      programId,
      weekKey,
      note: parsed.data.note,
      executionStatus: parsed.data.executionStatus,
      progressSnapshot: progress,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: [programFollowups.programId, programFollowups.weekKey],
      set: {
        note: parsed.data.note,
        executionStatus: parsed.data.executionStatus,
        progressSnapshot: progress,
        createdBy: user.id,
        createdAt: now,
      },
    });
  await db
    .update(programs)
    .set({ progress, lastReviewAt: now, executionStatus: parsed.data.executionStatus, updatedAt: now })
    .where(eq(programs.id, programId));
  await audit({
    actorId: user.id,
    action: "program.followup_recorded",
    entityType: "program",
    entityId: programId,
    summary: `متابعة أسبوعية ${weekKey} لبرنامج «${program.name}» — ${parsed.data.executionStatus} (${progress}٪)`,
  });
  revalidatePath("/plan/followup");
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan");
  return { success: "سجلت المتابعة الأسبوعية" };
}

/** اعتماد حزمة مخرجات البرنامج (اختياري — المخرجات معلوماتية، بلا بوابة جاهزية شواهد؛ D-025) */
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

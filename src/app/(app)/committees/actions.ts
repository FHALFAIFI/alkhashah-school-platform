"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  committees, committeeTemplates, committeeMembers, meetings, meetingOutcomes,
  actionTasks, planYears, people, meetingTypes, meetingAttachments,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { snapshotRecord } from "@/lib/versioning";
import { saveUploadedFile } from "@/lib/storage";
import { notifyAll } from "@/lib/notify";
import { committedEmployeeCount } from "@/lib/committees/prerequisites";
import { userFacingError } from "@/lib/user-error";
import { optionalIsoDate } from "@/lib/dates-zod";
import { isValidIsoDate, parseIsoDate } from "@/lib/dates";

export type ActionState = { error?: string; success?: string } | null;

/** رسالة المتطلَّب السابق: لا تشكيل قبل اعتماد بيانات المنسوبين (دفعة فارس) */
const NO_EMPLOYEES_ERROR =
  "لا يمكن تشكيل اللجان قبل اعتماد بيانات منسوبي المدرسة — اعتمد دفعة فارس من المعاينة أولاً، فالأعضاء من المنسوبين المعتمدين حصراً.";

/** تشكيل سنوي من قالب — بلا نسخ عضويات الأعوام السابقة */
export async function createCommitteeFromTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  // متطلَّب سابق (خادم): لا تشكيل بلا منسوبين معتمدين — يمنع تشكيل لجنة بلا أعضاء ممكنين
  if ((await committedEmployeeCount()) === 0) return { error: NO_EMPLOYEES_ERROR };
  const templateId = String(formData.get("templateId") ?? "");
  const [template] = await db.select().from(committeeTemplates).where(eq(committeeTemplates.id, templateId));
  if (!template) return { error: "القالب غير موجود" };
  const [year] = await db.select().from(planYears).where(eq(planYears.status, "نشطة"));
  if (!year) return { error: "لا توجد سنة تخطيطية نشطة — استورد الخطة التشغيلية أولاً" };

  const existing = await db
    .select()
    .from(committees)
    .where(and(eq(committees.templateId, templateId), eq(committees.planYearId, year.id)));
  // اللجنة المقفلة مؤرشفة — لا تمنع إعادة التشكيل (نفس منطق لوحة «قوالب لم تشكل لهذه السنة»)
  if (existing.some((c) => c.status !== "مقفلة")) return { error: "شكلت هذه اللجنة لهذه السنة مسبقاً" };

  const [c] = await db
    .insert(committees)
    .values({
      templateId,
      planYearId: year.id,
      nameAr: template.nameAr,
      kind: template.kind,
      goal: template.goal,
      duties: template.duties,
      recurrence: template.recurrence,
    })
    .returning();
  await audit({ actorId: user.id, action: "committee.formed", entityType: "committee", entityId: c.id, summary: `تشكيل ${c.nameAr} للسنة ${year.nameAr}` });
  revalidatePath("/committees");
  redirect(`/committees/${c.id}`);
}

/** مجتمع تعلم مهني — نموذج أخف. كل الحقول اختيارية (v2.1 §H) — لا يُمنع الحفظ على فراغ. */
const plcSchema = z.object({
  nameAr: z.string().optional(),
  objectives: z.string().optional(),
  outputs: z.string().optional(),
});

export async function createPlcAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  if ((await committedEmployeeCount()) === 0) return { error: NO_EMPLOYEES_ERROR };
  const parsed = plcSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [year] = await db.select().from(planYears).where(eq(planYears.status, "نشطة"));
  if (!year) return { error: "لا توجد سنة تخطيطية نشطة" };
  const [c] = await db
    .insert(committees)
    .values({
      planYearId: year.id,
      nameAr: (parsed.data.nameAr ?? "").trim(), // عمود NOT NULL — نخزّن "" عند الفراغ
      kind: "مجتمع تعلم",
      objectives: parsed.data.objectives || null,
      outputs: parsed.data.outputs || null,
      recurrence: "on_demand",
    })
    .returning();
  await audit({ actorId: user.id, action: "plc.created", entityType: "committee", entityId: c.id, summary: `مجتمع تعلم: ${c.nameAr}` });
  revalidatePath("/committees");
  redirect(`/committees/${c.id}`);
}

/** إضافة عضو — من منسوبي المدرسة فقط (سجل الأشخاص) */
export async function addMemberAction(committeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const personId = String(formData.get("personId") ?? "");
  const role = String(formData.get("role") ?? "عضو");
  const position = String(formData.get("position") ?? "");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status === "مقفلة") return { error: "اللجنة مقفلة" };
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) return { error: "اختر عضواً من سجل منسوبي المدرسة — لا أعضاء خارجيين" };
  if (!person.active) return { error: "الشخص موقوف — فعّله أولاً" };

  const members = await db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, committeeId));
  // العضويات المنتهية (effectiveTo) لا تمنع إعادة تكليف الشخص أو شغل الدور من جديد
  const active = members.filter((m) => !m.effectiveTo);
  if (active.some((m) => m.personId === personId)) return { error: "العضو مضاف مسبقاً" };
  if (role === "رئيس" && active.some((m) => m.role === "رئيس")) return { error: "للجنة رئيس واحد" };
  if (role === "مقرر" && active.some((m) => m.role === "مقرر")) return { error: "للجنة مقرر واحد" };

  await db.insert(committeeMembers).values({
    committeeId,
    personId,
    role,
    position: position || person.jobTitle,
    sortOrder: members.length,
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  await audit({ actorId: user.id, action: "committee.member_added", entityType: "committee", entityId: committeeId, summary: `إضافة ${person.fullName} (${role})` });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "أضيف العضو" };
}

/**
 * إنهاء أو إزالة عضوية.
 * قبل الاعتماد: العضو أُضيف بالخطأ ولا تاريخ له — يُحذف صفه.
 * بعد الاعتماد: العضوية جزء من تاريخ اللجنة — تُنهى بتأريخ (`effectiveTo` + سبب) بدل الحذف،
 * فلا يُعاد كتابة أي اجتماع سابق أو تقرير مولّد.
 */
export async function removeMemberAction(memberId: string, formData?: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [m] = await db.select().from(committeeMembers).where(eq(committeeMembers.id, memberId));
  if (!m) return { error: "العضو غير موجود" };
  const [c] = await db.select().from(committees).where(eq(committees.id, m.committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status === "مقفلة") return { error: "اللجنة مقفلة — لا تعديل على الأعضاء" };

  if (c.status === "مسودة") {
    // تشكيل غير معتمد بعد — لا تاريخ يُحفظ، الحذف آمن
    await db.delete(committeeMembers).where(eq(committeeMembers.id, memberId));
    await audit({ actorId: user.id, action: "committee.member_removed", entityType: "committee", entityId: m.committeeId });
    revalidatePath(`/committees/${m.committeeId}`);
    return { success: "أزيل العضو" };
  }

  // تشكيل معتمد — إنهاء مؤرّخ يحافظ على التاريخ
  if (m.effectiveTo) return { error: "عضوية هذا العضو منتهية بالفعل" };
  const effectiveTo = String(formData?.get("effectiveTo") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const reason = String(formData?.get("reason") ?? "").trim();
  await db
    .update(committeeMembers)
    .set({ effectiveTo, endReason: reason || null })
    .where(eq(committeeMembers.id, memberId));
  await audit({
    actorId: user.id,
    action: "committee.member_ended",
    entityType: "committee",
    entityId: m.committeeId,
    summary: `إنهاء عضوية بتاريخ ${effectiveTo}${reason ? ` — ${reason}` : ""}`,
    detail: { memberId, effectiveTo, reason },
  });
  revalidatePath(`/committees/${m.committeeId}`);
  return { success: "أُنهيت العضوية مع حفظ التاريخ — لم يُعد كتابة أي اجتماع أو تقرير سابق" };
}

/** توليد نموذج تكليف واحد على مستوى اللجنة (§5) — بعد اعتماد التشكيل. */
export async function generateAssignmentFormAction(committeeId: string): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status === "مسودة") return { error: "اعتمد التشكيل أولاً قبل توليد نموذج التكليف" };

  const { generateAssignmentForm } = await import("@/lib/reports/assignment-form");
  let result;
  try {
    result = await generateAssignmentForm({ committeeId, issuedBy: user.id });
  } catch (e) {
    // رسالة عربية واضحة بدل خطأ تقني (لا يُرمى استثناء على قائمة فارغة بعد الآن)
    return { error: userFacingError(e, "تعذّر توليد نموذج التكليف") };
  }
  await db.update(committees).set({ assignmentDocId: result.docId }).where(eq(committees.id, committeeId));
  await audit({
    actorId: user.id,
    action: "committee.assignment_form_generated",
    entityType: "committee",
    entityId: committeeId,
    summary: `توليد نموذج تكليف ${result.docNumber}`,
  });
  revalidatePath(`/committees/${committeeId}`);
  return { success: `صدر نموذج التكليف ${result.docNumber} — قائمتان: «أعضاء اللجنة» بعمود «التوقيع» و«مهام اللجنة»` };
}

/** رفع نموذج التكليف الموقّع. */
export async function uploadSignedAssignmentAction(committeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (!c.assignmentDocId) return { error: "ولّد نموذج التكليف أولاً" };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "ارفع نموذج التكليف الموقّع" };

  try {
    const stored = await saveUploadedFile({
      originalName: file.name,
      mime: file.type || "application/pdf",
      data: Buffer.from(await file.arrayBuffer()),
      scope: "attachments",
      sensitive: true,
      uploadedBy: user.id,
    });
    await db.update(committees).set({ signedAssignmentFileId: stored.id }).where(eq(committees.id, committeeId));
  } catch (e) {
    return { error: userFacingError(e, "تعذر الرفع") };
  }
  await audit({ actorId: user.id, action: "committee.signed_assignment_uploaded", entityType: "committee", entityId: committeeId });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "رُفع نموذج التكليف الموقّع" };
}

/** اعتماد التشكيل — المدير */
export async function approveCommitteeAction(committeeId: string): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status !== "مسودة") return { error: "التشكيل معتمد مسبقاً" };
  const members = await db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, committeeId));
  if (c.kind !== "مجتمع تعلم") {
    if (!members.some((m) => m.role === "رئيس")) return { error: "لا يعتمد التشكيل دون رئيس" };
    if (!members.some((m) => m.role === "مقرر")) return { error: "لا يعتمد التشكيل دون مقرر — المحضر يوقعه الرئيس والمقرر" };
  } else if (members.length === 0) {
    return { error: "أضف قائد المجتمع وأعضاءه أولاً" };
  }
  await snapshotRecord({ entityType: "committee", entityId: committeeId, action: "approved", snapshot: { committee: c, members }, actorId: user.id });
  await db
    .update(committees)
    .set({ status: "معتمدة", approvedBy: user.id, approvedAt: new Date(), version: c.version + 1 })
    .where(eq(committees.id, committeeId));
  await audit({ actorId: user.id, action: "committee.approved", entityType: "committee", entityId: committeeId, summary: `اعتماد تشكيل ${c.nameAr}` });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "اعتمد التشكيل" };
}

export async function reopenCommitteeAction(committeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "سبب إعادة الفتح إلزامي" };
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c || c.status !== "معتمدة") return { error: "التشكيل غير معتمد" };
  const members = await db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, committeeId));
  await snapshotRecord({ entityType: "committee", entityId: committeeId, action: "reopened", snapshot: { committee: c, members }, reason, actorId: user.id });
  await db.update(committees).set({ status: "مسودة", version: c.version + 1 }).where(eq(committees.id, committeeId));
  await audit({ actorId: user.id, action: "committee.reopened", entityType: "committee", entityId: committeeId, summary: `إعادة فتح التشكيل — ${reason}` });
  revalidatePath(`/committees/${committeeId}`);
  return { success: "أعيد فتح التشكيل — عدل الأعضاء ثم اعتمد من جديد" };
}

/** إنشاء اجتماع */
export async function createMeetingAction(committeeId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  if (c.status === "مسودة") return { error: "اعتمد التشكيل قبل عقد الاجتماعات" };
  if (c.status === "مقفلة") return { error: "اللجنة مقفلة" };
  const title = String(formData.get("title") ?? "").trim();
  const meetingDate = String(formData.get("meetingDate") ?? "");
  if (meetingDate && !isValidIsoDate(meetingDate)) return { error: "تاريخ الاجتماع غير صحيح — اختر التاريخ من الحقل" };
  const agendaText = String(formData.get("agenda") ?? "");
  const agenda = agendaText.split("\n").map((s) => s.trim()).filter(Boolean);
  // نوع الاجتماع اختياري (v2.1 §H) — لا يُمنع الحفظ على فراغ. عند تمريره يجب أن يكون نوعاً مفعَّلاً.
  // بلا نوع، لا ينطبق شرط التوقيع (requiresSignature) عند الاكتمال.
  const typeIdRaw = String(formData.get("typeId") ?? "");
  let typeId: string | null = null;
  if (typeIdRaw) {
    const [mt] = await db.select().from(meetingTypes).where(eq(meetingTypes.id, typeIdRaw));
    if (!mt || !mt.active) return { error: "نوع الاجتماع غير صالح أو غير مفعَّل" };
    typeId = mt.id;
  }
  const existing = await db.select().from(meetings).where(eq(meetings.committeeId, committeeId));
  const [m] = await db
    .insert(meetings)
    .values({
      committeeId,
      seq: existing.length + 1,
      title: title || `الاجتماع ${existing.length + 1}`,
      typeId,
      // تثبيت على منتصف اليوم UTC (parseIsoDate) كي لا ينزلق اليوم مع فرق التوقيت — D-033
      meetingDate: meetingDate ? parseIsoDate(meetingDate) : null,
      agenda,
    })
    .returning();
  await audit({ actorId: user.id, action: "meeting.created", entityType: "meeting", entityId: m.id, summary: `اجتماع جديد: ${c.nameAr}` });
  revalidatePath(`/committees/${committeeId}`);
  redirect(`/committees/${committeeId}/meetings/${m.id}`);
}

export async function updateMeetingAction(meetingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) return { error: "الاجتماع غير موجود" };
  if (m.status === "مكتمل") return { error: "الاجتماع مكتمل — لا تعديل" };
  const agendaText = String(formData.get("agenda") ?? "");
  // تغيير النوع اختياري في التحرير؛ عند تمريره يجب أن يكون مفعَّلاً
  const typeIdRaw = String(formData.get("typeId") ?? "");
  let typeId = m.typeId;
  if (typeIdRaw) {
    const [mt] = await db.select().from(meetingTypes).where(eq(meetingTypes.id, typeIdRaw));
    if (!mt || !mt.active) return { error: "نوع الاجتماع غير صالح أو غير مفعَّل" };
    typeId = typeIdRaw;
  }
  const newMeetingDate = String(formData.get("meetingDate") ?? "");
  if (newMeetingDate && !isValidIsoDate(newMeetingDate)) return { error: "تاريخ الاجتماع غير صحيح — اختر التاريخ من الحقل" };
  await db
    .update(meetings)
    .set({
      title: String(formData.get("title") ?? m.title ?? ""),
      typeId,
      meetingDate: newMeetingDate ? parseIsoDate(newMeetingDate) : m.meetingDate,
      location: String(formData.get("location") ?? "") || null,
      agenda: agendaText.split("\n").map((s) => s.trim()).filter(Boolean),
      discussion: String(formData.get("discussion") ?? "") || null,
    })
    .where(eq(meetings.id, meetingId));
  await audit({ actorId: user.id, action: "meeting.updated", entityType: "meeting", entityId: meetingId });
  revalidatePath(`/committees/${m.committeeId}/meetings/${meetingId}`);
  return { success: "حفظ" };
}

/**
 * نتيجة اجتماع: قرار → إجراء إلزامي (تلقائي)؛ توصية → إجراء اختياري حسب الاختيار؛ ملاحظة.
 */
const outcomeSchema = z.object({
  outcomeType: z.enum(["قرار", "توصية", "ملاحظة"]),
  // نص النتيجة اختياري (v2.1 §H) — لا يُمنع الحفظ على فراغ (يُخزَّن "")
  text: z.string().optional(),
  ownerPersonId: z.string().optional(),
  dueDate: optionalIsoDate,
  createTask: z.string().optional(),
});

export async function addOutcomeAction(meetingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) return { error: "الاجتماع غير موجود" };
  if (m.status === "مكتمل") return { error: "الاجتماع مكتمل" };
  const parsed = outcomeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const text = (parsed.data.text ?? "").trim();
  const existing = await db.select().from(meetingOutcomes).where(eq(meetingOutcomes.meetingId, meetingId));
  // منع التكرار للنصوص المكتوبة فقط — نص فارغ لا يُمنع (كل الحقول اختيارية)
  if (text.length > 0 && existing.some((o) => o.text.trim() === text)) {
    return { error: "هذه النتيجة مسجلة مسبقاً في هذا الاجتماع" };
  }

  let taskId: string | null = null;
  const isDecision = parsed.data.outcomeType === "قرار";
  const wantsTask = isDecision || parsed.data.createTask === "on";
  if (wantsTask) {
    const [task] = await db
      .insert(actionTasks)
      .values({
        title: text.slice(0, 200),
        description: `${parsed.data.outcomeType} من اجتماع`,
        ownerPersonId: parsed.data.ownerPersonId || null,
        dueDate: parsed.data.dueDate ? parseIsoDate(parsed.data.dueDate) : null,
        priority: isDecision ? "عالية" : "متوسطة",
        mandatory: isDecision, // القرار ينشئ إجراءً إلزامياً دائماً
        sourceType: "meeting_outcome",
        createdBy: user.id,
      })
      .returning();
    taskId = task.id;
  }

  const [outcome] = await db
    .insert(meetingOutcomes)
    .values({
      meetingId,
      outcomeType: parsed.data.outcomeType,
      text,
      taskId,
      sortOrder: existing.length,
    })
    .returning();
  if (taskId) {
    await db.update(actionTasks).set({ sourceId: outcome.id }).where(eq(actionTasks.id, taskId));
  }
  await audit({ actorId: user.id, action: "meeting.outcome_added", entityType: "meeting", entityId: meetingId, summary: `${parsed.data.outcomeType}: ${text.slice(0, 80)}` });
  revalidatePath(`/committees/${m.committeeId}/meetings/${meetingId}`);
  return { success: "سجلت النتيجة" };
}

/** رفع المحضر الموقع (الرئيس والمقرر فقط يوقعان) */
export async function uploadSignedMinutesAction(meetingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) return { error: "الاجتماع غير موجود" };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "ارفع ملف المحضر الموقع" };
  try {
    const stored = await saveUploadedFile({
      originalName: file.name,
      mime: file.type || "application/pdf",
      data: Buffer.from(await file.arrayBuffer()),
      scope: "attachments",
      uploadedBy: user.id,
    });
    await db
      .update(meetings)
      .set({ signedMinutesFileId: stored.id, status: m.status === "مسودة" ? "بانتظار التوقيع" : m.status })
      .where(eq(meetings.id, meetingId));
  } catch (e) {
    return { error: userFacingError(e, "تعذر رفع الملف") };
  }
  await audit({ actorId: user.id, action: "meeting.signed_minutes_uploaded", entityType: "meeting", entityId: meetingId });
  revalidatePath(`/committees/${m.committeeId}/meetings/${meetingId}`);
  return { success: "رفع المحضر الموقع" };
}

/** اكتمال الاجتماع — التوقيع يُشترط فقط إن كان نوع الاجتماع مُهيّأً لذلك (D-027) */
export async function completeMeetingAction(meetingId: string): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) return { error: "الاجتماع غير موجود" };
  if (m.status === "مكتمل") return { error: "الاجتماع مكتمل مسبقاً" };
  // لا قاعدة عامة تفرض التوقيع؛ يُشترط المحضر الموقّع فقط إذا كان نوع الاجتماع يتطلبه صراحةً
  let requiresSignature = false;
  if (m.typeId) {
    const [mt] = await db.select({ req: meetingTypes.requiresSignature }).from(meetingTypes).where(eq(meetingTypes.id, m.typeId));
    requiresSignature = mt?.req ?? false;
  }
  if (requiresSignature && !m.signedMinutesFileId) {
    return { error: "نوع هذا الاجتماع مُهيّأ ليتطلب محضراً موقعاً — ارفع المحضر الموقع قبل الاكتمال" };
  }
  await snapshotRecord({ entityType: "meeting", entityId: meetingId, action: "approved", snapshot: { meeting: m }, actorId: user.id });
  await db
    .update(meetings)
    .set({ status: "مكتمل", completedAt: new Date(), approvedBy: user.id, approvedAt: new Date() })
    .where(eq(meetings.id, meetingId));
  await audit({ actorId: user.id, action: "meeting.completed", entityType: "meeting", entityId: meetingId, summary: "اكتمال اجتماع بمحضر موقع" });
  revalidatePath(`/committees/${m.committeeId}/meetings/${meetingId}`);
  return { success: "اكتمل الاجتماع" };
}

/** إقفال اللجنة وأرشفتها لنهاية العام */
export async function closeCommitteeAction(committeeId: string): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) return { error: "اللجنة غير موجودة" };
  const ms = await db.select().from(meetings).where(eq(meetings.committeeId, committeeId));
  const drafts = ms.filter((m) => m.status === "مسودة").length;
  if (drafts > 0) return { error: `أكمل أو احذف ${drafts} اجتماعاً مسودة قبل الإقفال` };
  const awaitingSignature = ms.filter((m) => m.status === "بانتظار التوقيع").length;
  if (awaitingSignature > 0) {
    return { error: `لا يقفل — ${awaitingSignature} اجتماعاً بحالة «بانتظار التوقيع»: اعتمد اكتماله بالمحضر الموقع أولاً` };
  }
  // أُزيل شرط توثيق «النتائج والأثر» للإقفال (v2.1 §G3 — كل شيء اختياري): تُقفل اللجنة دون نتيجة/أثر.
  await db.update(committees).set({ status: "مقفلة", closedAt: new Date() }).where(eq(committees.id, committeeId));
  await audit({ actorId: user.id, action: "committee.closed", entityType: "committee", entityId: committeeId, summary: `إقفال ${c.nameAr} وأرشفتها` });
  await notifyAll({ title: "أقفلت لجنة", body: c.nameAr, link: `/committees/${committeeId}` });
  revalidatePath("/committees");
  return { success: "أقفلت اللجنة" };
}

/**
 * تفعيل/تعطيل قالب لجنة رسمي — القوالب لا تُحذف نهائياً (منقولة من قرار رسمي)، تُعطَّل فقط:
 * القالب المعطَّل لا يظهر في «قوالب لم تشكل» ولا يُشكَّل منه، لكنه يبقى في السجل ويمكن تفعيله.
 */
export async function toggleTemplateActiveAction(templateId: string, active: boolean): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [t] = await db.select().from(committeeTemplates).where(eq(committeeTemplates.id, templateId));
  if (!t) return { error: "القالب غير موجود" };
  await db.update(committeeTemplates).set({ active }).where(eq(committeeTemplates.id, templateId));
  await audit({
    actorId: user.id,
    action: active ? "committee_template.enabled" : "committee_template.disabled",
    entityType: "committee_template",
    entityId: templateId,
    summary: `${active ? "تفعيل" : "تعطيل"} قالب اللجنة «${t.nameAr}»`,
  });
  revalidatePath("/committees/templates");
  revalidatePath("/committees");
  return { success: active ? "فُعِّل القالب" : "عُطِّل القالب" };
}

// ————————————————————————— أنواع الاجتماعات —————————————————————————

/** إضافة نوع اجتماع جديد (المدير) */
export async function addMeetingTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  // اسم النوع اختياري (v2.1 §H) — لا يُمنع الحفظ على فراغ (يُخزَّن "")
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const all = await db.select().from(meetingTypes);
  // منع التكرار للأسماء المكتوبة فقط — اسم فارغ لا يُمنع
  if (nameAr.length > 0 && all.some((t) => t.nameAr === nameAr)) return { error: "النوع موجود مسبقاً" };
  const maxOrder = all.reduce((mx, t) => Math.max(mx, t.sortOrder), 0);
  const key = `mt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await db.insert(meetingTypes).values({ key, nameAr, sortOrder: maxOrder + 1 });
  await audit({ actorId: user.id, action: "meeting_type.added", entityType: "meeting_type", summary: `إضافة نوع اجتماع «${nameAr}»` });
  revalidatePath("/committees/meeting-types");
  return { success: "أُضيف النوع" };
}

/** تفعيل/تعطيل نوع اجتماع */
export async function toggleMeetingTypeActiveAction(typeId: string, active: boolean): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [t] = await db.select().from(meetingTypes).where(eq(meetingTypes.id, typeId));
  if (!t) return { error: "النوع غير موجود" };
  await db.update(meetingTypes).set({ active }).where(eq(meetingTypes.id, typeId));
  await audit({ actorId: user.id, action: active ? "meeting_type.enabled" : "meeting_type.disabled", entityType: "meeting_type", entityId: typeId, summary: `${active ? "تفعيل" : "تعطيل"} نوع «${t.nameAr}»` });
  revalidatePath("/committees/meeting-types");
  return { success: active ? "فُعِّل النوع" : "عُطِّل النوع" };
}

/** حذف نوع اجتماع — يُمنع إن كان مستخدماً في أي اجتماع (يُعطَّل فقط) */
export async function deleteMeetingTypeAction(typeId: string): Promise<ActionState> {
  const user = await requirePermission("committees.approve");
  const [t] = await db.select().from(meetingTypes).where(eq(meetingTypes.id, typeId));
  if (!t) return { error: "النوع غير موجود" };
  const used = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.typeId, typeId)).limit(1);
  if (used.length > 0) return { error: "النوع مستخدم في اجتماعات — لا يُحذف نهائياً، يمكن تعطيله فقط" };
  await db.delete(meetingTypes).where(eq(meetingTypes.id, typeId));
  await audit({ actorId: user.id, action: "meeting_type.deleted", entityType: "meeting_type", entityId: typeId, summary: `حذف نوع اجتماع غير مستخدم «${t.nameAr}»` });
  revalidatePath("/committees/meeting-types");
  return { success: "حُذف النوع" };
}

// ————————————————————————— مرفقات الاجتماع —————————————————————————

export async function addMeetingAttachmentAction(meetingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) return { error: "الاجتماع غير موجود" };
  if (m.status === "مكتمل") return { error: "الاجتماع مكتمل — لا تُضاف مرفقات" };
  // العنوان والفئة اختياريان (v2.1 §H) — لا يُمنع الحفظ على فراغ (يُخزَّن "").
  // يبقى الملف مطلوباً لأن المرفق بلا ملف لا معنى له (ليس حقلاً نصياً).
  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "ارفع ملف المرفق" };
  try {
    const stored = await saveUploadedFile({
      originalName: file.name,
      mime: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
      scope: "attachments",
      sensitive: true, // مرفقات خاصة — تُقدَّم فقط عبر مسار الملفات المصادق عليه
      uploadedBy: user.id,
    });
    await db.insert(meetingAttachments).values({
      meetingId,
      title,
      description: String(formData.get("description") ?? "") || null,
      category,
      fileId: stored.id,
      uploadedBy: user.id,
    });
  } catch (e) {
    return { error: userFacingError(e, "تعذر رفع المرفق") };
  }
  await audit({ actorId: user.id, action: "meeting.attachment_added", entityType: "meeting", entityId: meetingId, summary: `مرفق «${title}» (${category})` });
  revalidatePath(`/committees/${m.committeeId}/meetings/${meetingId}`);
  return { success: "أُضيف المرفق" };
}

export async function deleteMeetingAttachmentAction(attachmentId: string): Promise<ActionState> {
  const user = await requirePermission("committees.write");
  const [a] = await db.select().from(meetingAttachments).where(eq(meetingAttachments.id, attachmentId));
  if (!a) return { error: "المرفق غير موجود" };
  const [m] = await db.select().from(meetings).where(eq(meetings.id, a.meetingId));
  if (m?.status === "مكتمل") return { error: "الاجتماع مكتمل — لا يُحذف المرفق" };
  await db.delete(meetingAttachments).where(eq(meetingAttachments.id, attachmentId));
  await audit({ actorId: user.id, action: "meeting.attachment_deleted", entityType: "meeting", entityId: a.meetingId });
  if (m) revalidatePath(`/committees/${m.committeeId}/meetings/${a.meetingId}`);
  return { success: "حُذف المرفق" };
}

// ————————————————————————— النتيجة والأثر (أُزيلت من سير العمل — v2.1 §G3) —————————————————————————
// حذفت إجراءات addImpactAction / deleteImpactAction من طبقة التطبيق: «النتيجة والأثر» لم تعد جزءاً من
// سير عمل اللجان. جدول committee_impacts وصفوفه الحالية تبقى في قاعدة البيانات (لا هجرة ولا حذف بيانات)،
// لكنها لا تظهر ولا تُدار تشغيلياً بعد الآن.

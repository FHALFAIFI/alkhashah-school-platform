"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  perfModels, perfIndicators, perfCycles, perfSessions, perfRatings, perfSignedReportVersions, improvementPlans,
  people, calendars, calendarEvents,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { snapshotRecord } from "@/lib/versioning";
import { saveUploadedFile } from "@/lib/storage";
import { getSetting } from "@/lib/settings";
import { sessionResult, validRating } from "@/lib/performance/scoring";
import { snapshotAwaitingFaresCells } from "@/lib/performance/d014";
import { numOrNull } from "@/lib/format";
import { userFacingError } from "@/lib/user-error";
import { optionalIsoDate } from "@/lib/dates-zod";
import { isValidIsoDate } from "@/lib/dates";

export type ActionState = { error?: string; success?: string } | null;

// ————————————————— النماذج —————————————————

const modelSchema = z.object({
  // v2.1 (§H): user business field is optional — store "" when blank (column is NOT NULL).
  nameAr: z.string().default(""),
  audience: z.enum(["معلم", "موظف"]),
  official: z.string().optional(),
  description: z.string().optional(),
});

export async function createModelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.models.manage");
  const parsed = modelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const official = parsed.data.official === "on";
  const key = `model-${Date.now()}`;
  const [m] = await db
    .insert(perfModels)
    .values({
      key,
      nameAr: parsed.data.nameAr,
      audience: parsed.data.audience,
      official,
      description: parsed.data.description || null,
      status: "مسودة",
      createdBy: user.id,
    })
    .returning();
  await audit({ actorId: user.id, action: "perf_model.created", entityType: "perf_model", entityId: m.id, summary: `نموذج ${official ? "رسمي" : "داخلي"}: ${m.nameAr}` });
  revalidatePath("/performance/models");
  redirect(`/performance/models/${m.id}`);
}

const indicatorSchema = z.object({
  // v2.1 (§H): name optional (store "" when blank); weight stays validated — it drives the =100% gate.
  nameAr: z.string().default(""),
  weight: z.coerce.number().positive("الوزن يجب أن يكون موجباً").max(100),
  requiresEvidence: z.string().optional(),
});

export async function addIndicatorAction(modelId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.models.manage");
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, modelId));
  if (!model) return { error: "النموذج غير موجود" };
  if (model.status === "معتمد") return { error: "النموذج معتمد — أعد فتحه بسبب موثق أولاً" };
  const parsed = indicatorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const existing = await db.select().from(perfIndicators).where(eq(perfIndicators.modelId, modelId));
  await db.insert(perfIndicators).values({
    modelId,
    nameAr: parsed.data.nameAr,
    weight: String(parsed.data.weight),
    requiresEvidence: parsed.data.requiresEvidence === "on",
    sortOrder: existing.length,
  });
  revalidatePath(`/performance/models/${modelId}`);
  return { success: "أضيف المؤشر" };
}

export async function deleteIndicatorAction(indicatorId: string): Promise<void> {
  await requirePermission("performance.models.manage");
  const [ind] = await db.select().from(perfIndicators).where(eq(perfIndicators.id, indicatorId));
  if (!ind) return;
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, ind.modelId));
  if (!model || model.status === "معتمد") return;
  await db.delete(perfIndicators).where(eq(perfIndicators.id, indicatorId));
  revalidatePath(`/performance/models/${ind.modelId}`);
}

/** اعتماد نموذج — مجموع الأوزان يجب أن يساوي 100٪ تماماً */
export async function approveModelAction(modelId: string): Promise<ActionState> {
  const user = await requirePermission("performance.models.manage", "performance.approve");
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, modelId));
  if (!model) return { error: "النموذج غير موجود" };
  if (model.status === "معتمد") return { error: "النموذج معتمد مسبقاً" };
  const indicators = await db.select().from(perfIndicators).where(eq(perfIndicators.modelId, modelId));
  if (indicators.length === 0) return { error: "أضف مؤشرات أولاً" };
  const total = indicators.reduce((s, i) => s + Number(i.weight), 0);
  if (Math.abs(total - 100) > 0.001) {
    return { error: `مجموع الأوزان ${total}٪ — يجب أن يساوي 100٪ تماماً` };
  }
  await snapshotRecord({ entityType: "perf_model", entityId: modelId, action: "approved", snapshot: { model, indicators }, actorId: user.id });
  await db
    .update(perfModels)
    .set({ status: "معتمد", approvedBy: user.id, approvedAt: new Date(), version: model.version + 1 })
    .where(eq(perfModels.id, modelId));
  await audit({ actorId: user.id, action: "perf_model.approved", entityType: "perf_model", entityId: modelId, summary: `اعتماد نموذج ${model.nameAr}` });
  revalidatePath(`/performance/models/${modelId}`);
  return { success: "اعتمد النموذج" };
}

export async function reopenModelAction(modelId: string, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.models.manage");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "سبب إعادة الفتح إلزامي" };
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, modelId));
  if (!model || model.status !== "معتمد") return { error: "النموذج غير معتمد" };
  const indicators = await db.select().from(perfIndicators).where(eq(perfIndicators.modelId, modelId));
  await snapshotRecord({ entityType: "perf_model", entityId: modelId, action: "reopened", snapshot: { model, indicators }, reason, actorId: user.id });
  await db.update(perfModels).set({ status: "مسودة", version: model.version + 1 }).where(eq(perfModels.id, modelId));
  await audit({ actorId: user.id, action: "perf_model.reopened", entityType: "perf_model", entityId: modelId, summary: reason });
  revalidatePath(`/performance/models/${modelId}`);
  return null;
}

// ————————————————— الدورات —————————————————

const cycleSchema = z.object({
  personId: z.string().uuid("اختر الشخص"),
  modelId: z.string().uuid("اختر النموذج"),
  cycleType: z.enum(["معلم", "موظف"]),
  // v2.1 (§H): year key optional — store "" when blank (column is NOT NULL).
  yearKey: z.string().default(""),
  planningDeadline: optionalIsoDate,
  midDeadline: optionalIsoDate,
  finalDeadline: optionalIsoDate,
});

export async function createCycleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.write");
  const parsed = cycleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [person] = await db.select().from(people).where(eq(people.id, parsed.data.personId));
  if (!person || !person.active) return { error: "الشخص غير موجود أو موقوف" };
  // منع التقييم الذاتي للمدير
  if (user.personId && user.personId === person.id) {
    return { error: "لا يجوز إنشاء دورة تقييم ذاتي" };
  }
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, parsed.data.modelId));
  if (!model) return { error: "النموذج غير موجود" };
  if (model.status !== "معتمد") return { error: "النموذج غير معتمد — يعتمد المدير النموذج أولاً" };
  // D-014 (الاختيار اليدوي): عدم تطابق فئة النموذج مع فئة الدورة يسمح به فقط عندما
  // لا يوجد أي نموذج معتمد مطابق للفئة (مثال: كل النماذج الرسمية «معلم» والشخص «موظف»).
  // لا يخترع النظام نموذجاً — الاختيار اليدوي مسؤولية المدير ويوثق في سجل التدقيق.
  let audienceMismatch = false;
  if (model.audience !== parsed.data.cycleType) {
    const matching = await db
      .select({ id: perfModels.id })
      .from(perfModels)
      .where(and(eq(perfModels.audience, parsed.data.cycleType), eq(perfModels.status, "معتمد")));
    if (matching.length > 0) return { error: `النموذج مخصص لفئة «${model.audience}»` };
    audienceMismatch = true;
  }

  const indicators = await db
    .select()
    .from(perfIndicators)
    .where(eq(perfIndicators.modelId, model.id))
    .orderBy(asc(perfIndicators.sortOrder));

  // لقطة التقويم للدورة (دورة المعلم ترتكز على حدث عودة المعلمين)
  let calendarSnapshot: unknown = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (parsed.data.cycleType === "معلم") {
    const [cal] = await db.select().from(calendars).where(eq(calendars.calendarType, "academic"));
    if (cal) {
      const events = await db.select().from(calendarEvents).where(eq(calendarEvents.calendarId, cal.id));
      calendarSnapshot = { calendarKey: cal.key, events };
      const teacherReturn = events.find((e) => e.anchorKey === "teacher_return");
      const yearEnd = events.find((e) => e.anchorKey === "year_end");
      startDate = teacherReturn?.gregFrom ?? null;
      endDate = yearEnd?.gregFrom ?? null;
    }
  } else {
    // An empty/non-numeric year key yields no derived dates (never a year-0 range).
    const year = numOrNull(parsed.data.yearKey);
    if (year !== null) {
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }
  }

  const followupTarget = await getSetting("performance.followup_target", 5);

  try {
    const [cycle] = await db
      .insert(perfCycles)
      .values({
        personId: person.id,
        cycleType: parsed.data.cycleType,
        yearKey: parsed.data.yearKey,
        modelId: model.id,
        calendarSnapshot: calendarSnapshot as object,
        modelSnapshot: { model: { id: model.id, key: model.key, nameAr: model.nameAr, official: model.official, version: model.version }, indicators },
        startDate,
        endDate,
        planningDeadline: parsed.data.planningDeadline || null,
        midDeadline: parsed.data.midDeadline || null,
        finalDeadline: parsed.data.finalDeadline || null,
        followupTarget,
        createdBy: user.id,
      })
      .returning();
    await audit({
      actorId: user.id,
      action: "perf_cycle.created",
      entityType: "perf_cycle",
      entityId: cycle.id,
      summary: `دورة ${parsed.data.cycleType} — ${person.fullName} (${parsed.data.yearKey})${audienceMismatch ? ` — اختيار يدوي لنموذج فئة «${model.audience}» لعدم وجود نموذج معتمد للفئة (D-014)` : ""}`,
    });
    revalidatePath("/performance");
    redirect(`/performance/cycles/${cycle.id}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("cycles_person_year_unique")) {
      return { error: "توجد دورة لهذا الشخص في هذه السنة مسبقاً" };
    }
    throw e;
  }
}

// ————————————————— الجلسات —————————————————

const SESSION_TYPES = ["تخطيط", "منتصف", "نهائي", "زيارة", "متابعة"] as const;
const ONCE_ONLY = new Set(["تخطيط", "منتصف", "نهائي"]);

export async function createSessionAction(cycleId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.write");
  const sessionType = String(formData.get("sessionType") ?? "");
  const sessionDate = String(formData.get("sessionDate") ?? "") || null;
  if (sessionDate && !isValidIsoDate(sessionDate)) return { error: "تاريخ الجلسة غير صحيح — اختر التاريخ من الحقل" };
  if (!SESSION_TYPES.includes(sessionType as (typeof SESSION_TYPES)[number])) return { error: "نوع جلسة غير صحيح" };

  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, cycleId));
  if (!cycle) return { error: "الدورة غير موجودة" };
  if (cycle.status === "مقفلة") return { error: "الدورة مقفلة" };

  if (ONCE_ONLY.has(sessionType)) {
    const existing = await db
      .select()
      .from(perfSessions)
      .where(and(eq(perfSessions.cycleId, cycleId), eq(perfSessions.sessionType, sessionType)));
    if (existing.length > 0) return { error: `جلسة «${sessionType}» تعقد مرة واحدة في الدورة` };
  }

  // تنبيه (لا منع): زيارة صفية قبل بداية دراسة الطلاب
  const warningFlags: string[] = [];
  if (sessionType === "زيارة" && sessionDate && cycle.calendarSnapshot) {
    const snap = cycle.calendarSnapshot as { events?: { anchorKey?: string | null; gregFrom?: string | null }[] };
    const studentsStart = snap.events?.find((e) => e.anchorKey === "students_start")?.gregFrom;
    if (studentsStart && sessionDate < studentsStart) {
      warningFlags.push(`الزيارة قبل بداية دراسة الطلاب (${studentsStart}) — تنبيه فقط ولا يمنع الحفظ`);
    }
  }

  const snapshot = cycle.modelSnapshot as { indicators: { id: string }[] };
  const [session] = await db
    .insert(perfSessions)
    .values({ cycleId, sessionType, sessionDate, warningFlags })
    .returning();
  // كل مؤشرات النموذج حاضرة دائماً في الجلسة
  for (const ind of snapshot.indicators) {
    await db.insert(perfRatings).values({ sessionId: session.id, indicatorId: ind.id });
  }
  await audit({ actorId: user.id, action: "perf_session.created", entityType: "perf_session", entityId: session.id, summary: `جلسة ${sessionType}` });
  revalidatePath(`/performance/cycles/${cycleId}`);
  redirect(`/performance/cycles/${cycleId}/sessions/${session.id}`);
}

/**
 * حفظ تقديرات الجلسة — يقبل التقدير 1..5 فقط، والنتيجة تحسب في الخادم حصراً.
 * أي حقل نسبة مئوية يرسل من العميل يتجاهل (A4).
 */
export async function saveRatingsAction(sessionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.write", "performance.individual.read");
  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, sessionId));
  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.status === "مقفلة" || session.status === "مكتملة") return { error: "الجلسة مقفلة — أعد فتحها بسبب موثق" };

  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, session.cycleId));
  const snapshot = cycle.modelSnapshot as { indicators: { id: string; weight: string }[] };
  const weightById = new Map(snapshot.indicators.map((i) => [i.id, Number(i.weight)]));

  const ratings = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, sessionId));
  for (const r of ratings) {
    const raw = formData.get(`rating_${r.indicatorId}`);
    const note = formData.get(`note_${r.indicatorId}`);
    const rating = raw === null || raw === "" ? null : validRating(raw);
    if (raw !== null && raw !== "" && rating === null) {
      return { error: "التقدير يجب أن يكون عدداً صحيحاً من 1 إلى 5" };
    }
    await db
      .update(perfRatings)
      .set({ rating, note: note ? String(note) : r.note })
      .where(eq(perfRatings.id, r.id));
  }

  // الحقول النصية للجلسة
  await db
    .update(perfSessions)
    .set({
      notes: String(formData.get("notes") ?? "") || null,
      principalComment: String(formData.get("principalComment") ?? "") || null,
      employeeComment: String(formData.get("employeeComment") ?? "") || null,
      strengths: String(formData.get("strengths") ?? "") || null,
      improvementAreas: String(formData.get("improvementAreas") ?? "") || null,
      recommendations: String(formData.get("recommendations") ?? "") || null,
      actionsText: String(formData.get("actionsText") ?? "") || null,
      nextFollowupDate: String(formData.get("nextFollowupDate") ?? "") || null,
      sessionDate: String(formData.get("sessionDate") ?? "") || session.sessionDate,
      updatedAt: new Date(),
    })
    .where(eq(perfSessions.id, sessionId));

  // الحساب في الخادم حصراً — تجاهل أي قيمة نتيجة واردة من العميل
  const fresh = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, sessionId));
  const entries = fresh.map((r) => ({ indicatorId: r.indicatorId, weight: weightById.get(r.indicatorId) ?? 0, rating: r.rating }));
  const { result, coverage } = sessionResult(entries);
  await db
    .update(perfSessions)
    .set({ sessionResult: String(result), coverage: String(coverage) })
    .where(eq(perfSessions.id, sessionId));

  await audit({ actorId: user.id, action: "perf_session.ratings_saved", entityType: "perf_session", entityId: sessionId });
  revalidatePath(`/performance/cycles/${session.cycleId}/sessions/${sessionId}`);
  return { success: "حفظت التقديرات وحسبت النتيجة" };
}

/** رفع التقرير الموقع — شرط الاكتمال */
/**
 * رفع التقرير الموقع أو استبداله مع حفظ النسخة السابقة.
 * الاستبدال لا يفقد النسخة القديمة: تُنقل إلى `perf_signed_report_versions` قبل استبدالها،
 * فتبقى كل النسخ محفوظة ومدققة كما يتطلب النطاق.
 */
export async function uploadSignedReportAction(sessionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.write", "performance.individual.read");
  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, sessionId));
  if (!session) return { error: "الجلسة غير موجودة" };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "ارفع ملف التقرير الموقع" };
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const isReplacement = !!session.signedReportFileId;
  try {
    const stored = await saveUploadedFile({
      originalName: file.name,
      mime: file.type || "application/pdf",
      data: Buffer.from(await file.arrayBuffer()),
      scope: "attachments",
      sensitive: true,
      uploadedBy: user.id,
    });
    await db.transaction(async (tx) => {
      if (session.signedReportFileId) {
        // احفظ النسخة الحالية في السجل قبل استبدالها
        const [{ n }] = await tx
          .select({ n: sql<number>`coalesce(max(version), 0)::int` })
          .from(perfSignedReportVersions)
          .where(eq(perfSignedReportVersions.sessionId, sessionId));
        await tx.insert(perfSignedReportVersions).values({
          sessionId,
          version: (n ?? 0) + 1,
          fileId: session.signedReportFileId,
          reason,
          replacedBy: user.id,
        });
      }
      await tx.update(perfSessions).set({ signedReportFileId: stored.id }).where(eq(perfSessions.id, sessionId));
    });
  } catch (e) {
    return { error: userFacingError(e, "تعذر الرفع") };
  }
  await audit({
    actorId: user.id,
    action: isReplacement ? "perf_session.signed_report_replaced" : "perf_session.signed_report_uploaded",
    entityType: "perf_session",
    entityId: sessionId,
    summary: isReplacement ? `استبدال التقرير الموقع${reason ? ` — ${reason}` : ""}` : "رفع التقرير الموقع",
  });
  revalidatePath(`/performance/cycles/${session.cycleId}/sessions/${sessionId}`);
  return { success: isReplacement ? "استُبدل التقرير الموقع — النسخة السابقة محفوظة" : "رفع التقرير الموقع" };
}


/**
 * Complete / lock a session.
 * The single remaining "produce the output document" gate is that the session report must be
 * issued first. Per the principal's v2.1 corrections there is no signed-report requirement, no
 * all-indicators-rated gate, and no per-indicator required-evidence gate (evidence is informational).
 * A «نهائي» session still cannot be locked while the frozen model snapshot has a D-014 cell
 * awaiting «فارس» reconciliation.
 */
export async function completeSessionAction(sessionId: string): Promise<ActionState> {
  const user = await requirePermission("performance.approve", "performance.individual.read");
  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, sessionId));
  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.status === "مكتملة" || session.status === "مقفلة") return { error: "الجلسة مكتملة مسبقاً" };

  if (!session.reportDocId) return { error: "أصدر تقرير الجلسة أولاً — لكل جلسة مكتملة تقرير" };

  if (session.sessionType === "نهائي") {
    const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, session.cycleId));
    // بوابة D-014: لا إقفال نهائي على نموذج رسمي أصلي فيه خلية بانتظار مطابقة فارس
    const awaitingFares = snapshotAwaitingFaresCells(cycle.modelSnapshot);
    if (awaitingFares.length > 0) {
      return {
        error: `لا يُقفَل التقييم النهائي نهائياً حتى تُطابَق قيمة المؤشر مع نظام فارس (D-014) — طابِق القيمة ثم أصدر نسخة نموذج معتمدة جديدة. المؤشرات المعلّقة: ${awaitingFares.join("، ")}`,
      };
    }
  }

  await snapshotRecord({ entityType: "perf_session", entityId: sessionId, action: "approved", snapshot: { session }, actorId: user.id });
  const newStatus = session.sessionType === "نهائي" ? "مقفلة" : "مكتملة";
  await db
    .update(perfSessions)
    .set({ status: newStatus, lockedAt: new Date(), lockedBy: user.id, version: session.version + 1 })
    .where(eq(perfSessions.id, sessionId));
  await audit({ actorId: user.id, action: "perf_session.completed", entityType: "perf_session", entityId: sessionId, summary: newStatus === "مقفلة" ? "إقفال التقييم النهائي" : "اكتمال جلسة" });
  // إقفال التقييم النهائي يكمل الدورة — تعاد إلى «نشطة» عند إعادة فتح الجلسة النهائية
  if (session.sessionType === "نهائي") {
    await db.update(perfCycles).set({ status: "مكتملة" }).where(eq(perfCycles.id, session.cycleId));
    await audit({ actorId: user.id, action: "perf_cycle.completed", entityType: "perf_cycle", entityId: session.cycleId, summary: "اكتملت الدورة بإقفال التقييم النهائي" });
    revalidatePath(`/performance/cycles/${session.cycleId}`);
    revalidatePath("/performance");
  }
  revalidatePath(`/performance/cycles/${session.cycleId}/sessions/${sessionId}`);
  return { success: newStatus === "مقفلة" ? "أقفل التقييم النهائي واكتملت الدورة" : "اكتملت الجلسة" };
}

/** إعادة فتح جلسة مقفلة — سبب إلزامي وحفظ النسخة السابقة الكاملة */
export async function reopenSessionAction(sessionId: string, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.approve", "performance.individual.read");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "سبب إعادة الفتح إلزامي (5 أحرف على الأقل)" };
  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, sessionId));
  if (!session || (session.status !== "مكتملة" && session.status !== "مقفلة")) return { error: "الجلسة ليست مقفلة" };
  const ratings = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, sessionId));
  await snapshotRecord({
    entityType: "perf_session",
    entityId: sessionId,
    action: "reopened",
    snapshot: { session, ratings },
    reason,
    actorId: user.id,
  });
  await db
    .update(perfSessions)
    .set({ status: "مسودة", version: session.version + 1, updatedAt: new Date() })
    .where(eq(perfSessions.id, sessionId));
  await audit({ actorId: user.id, action: "perf_session.reopened", entityType: "perf_session", entityId: sessionId, summary: `إعادة فتح — ${reason}` });
  // إعادة فتح الجلسة النهائية تعيد الدورة من «مكتملة» إلى «نشطة»
  if (session.sessionType === "نهائي") {
    const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, session.cycleId));
    if (cycle && cycle.status === "مكتملة") {
      await db.update(perfCycles).set({ status: "نشطة" }).where(eq(perfCycles.id, session.cycleId));
      await audit({ actorId: user.id, action: "perf_cycle.reactivated", entityType: "perf_cycle", entityId: session.cycleId, summary: `أعيدت الدورة إلى «نشطة» بإعادة فتح التقييم النهائي — ${reason}` });
      revalidatePath(`/performance/cycles/${session.cycleId}`);
      revalidatePath("/performance");
    }
  }
  revalidatePath(`/performance/cycles/${session.cycleId}/sessions/${sessionId}`);
  return null;
}

// ————————————————— خطط التحسين —————————————————

const improvementSchema = z.object({
  // v2.1 (§H): plan title optional — store "" when blank (column is NOT NULL).
  title: z.string().default(""),
  goals: z.string().optional(),
  actions: z.string().optional(),
  duration: z.string().optional(),
});

export async function createImprovementPlanAction(cycleId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("performance.write", "performance.individual.read");
  const parsed = improvementSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const duplicate = await db
    .select({ id: improvementPlans.id })
    .from(improvementPlans)
    .where(and(eq(improvementPlans.cycleId, cycleId), eq(improvementPlans.title, parsed.data.title)));
  if (duplicate.length > 0) return { error: "توجد خطة تحسين بالعنوان نفسه في هذه الدورة" };
  await db.insert(improvementPlans).values({
    cycleId,
    title: parsed.data.title,
    goals: parsed.data.goals || null,
    actions: parsed.data.actions || null,
    duration: parsed.data.duration || null,
    suggested: formData.get("suggested") === "true",
    createdBy: user.id,
  });
  await audit({ actorId: user.id, action: "improvement_plan.created", entityType: "perf_cycle", entityId: cycleId });
  revalidatePath(`/performance/cycles/${cycleId}`);
  return { success: "أنشئت خطة التحسين" };
}

/** تسلسل حالة خطة التحسين: مسودة → قيد التنفيذ → مكتملة (قرار يدوي، والاقتراحات استشارية) */
const PLAN_NEXT_STATUS: Record<string, string> = { "مسودة": "قيد التنفيذ", "قيد التنفيذ": "مكتملة" };

export async function advanceImprovementPlanAction(planId: string): Promise<ActionState> {
  const user = await requirePermission("performance.write", "performance.individual.read");
  const [plan] = await db.select().from(improvementPlans).where(eq(improvementPlans.id, planId));
  if (!plan) return { error: "الخطة غير موجودة" };
  const next = PLAN_NEXT_STATUS[plan.status];
  if (!next) return { error: "الخطة مكتملة — لا حالة تالية" };
  await db.update(improvementPlans).set({ status: next }).where(eq(improvementPlans.id, planId));
  await audit({ actorId: user.id, action: "improvement_plan.status_advanced", entityType: "perf_cycle", entityId: plan.cycleId, summary: `خطة «${plan.title}»: ${plan.status} → ${next}` });
  revalidatePath(`/performance/cycles/${plan.cycleId}`);
  return { success: next === "مكتملة" ? "اكتملت الخطة" : "بدأ تنفيذ الخطة" };
}

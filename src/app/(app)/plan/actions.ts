"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  programs, programChangeRequests, programDeliverables, planYears, programFollowups,
  programClosureHistory, programEditHistory,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { orFallback } from "@/lib/format";
import { snapshotRecord } from "@/lib/versioning";
import { revalidateOtherPaths } from "@/lib/revalidate";
import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE } from "@/lib/finance/calc";
import { FOLLOWUP_STATUSES, isoWeekKey } from "@/lib/plan/followup";
import { PROGRAM_LIFECYCLE, LIFECYCLE_ACTIONS, programLifecycle } from "@/lib/plan/lifecycle";
import {
  EDITABLE_FIELD_KEYS,
  REASON_REQUIRED_MESSAGE,
  changesSummaryAr,
  detectChanges,
  reasonRequiredFor,
} from "@/lib/plan/program-edit";
import { notifyAll, notifyUser } from "@/lib/notify";
import { isUuid } from "@/lib/validation";

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
  reason: z.string().trim().optional(),
});

/**
 * v2.4.1 §1.6: حالة البرنامج لم تعد تمنع تحديث التنفيذ.
 *
 * كان البرنامج المكتمل أو المغلق يرفض التحديث فيضطر المدير إلى إعادة فتحه لتصحيح نسبة —
 * وإعادة الفتح تغيّر الحالة فعلياً، وهو تشويه للسجل أشدّ من التصحيح. الآن: التحديث
 * مسموح، والسبب إلزامي متى كان البرنامج مكتملاً أو مغلقاً (قيمته مستقرة تاريخياً)،
 * ويُقيَّد التغيير في `program_edit_history` كأي تعديل بعد الاعتماد. الحالة نفسها لا
 * تتغيّر إطلاقاً — لا اكتمال ولا إقفال ولا إعادة فتح ضمنية.
 */
export async function updateProgramExecutionAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = executionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };

  const lifecycle = programLifecycle(program);
  const settled = lifecycle !== PROGRAM_LIFECYCLE.active || program.status === "مقفل";
  const reason = (parsed.data.reason ?? "").trim();
  if (settled && reason.length < 3) {
    return { error: "اذكر سبب تعديل التنفيذ — إلزامي للبرنامج المكتمل أو المغلق أو ضمن سنة مقفلة" };
  }
  if (program.progress === parsed.data.progress && program.executionStatus === parsed.data.executionStatus) {
    return { success: "لا تغييرات لحفظها" };
  }

  const before = { progress: program.progress, executionStatus: program.executionStatus };
  await db.transaction(async (tx) => {
    await tx
      .update(programs)
      .set({ progress: parsed.data.progress, executionStatus: parsed.data.executionStatus, updatedAt: new Date() })
      .where(eq(programs.id, programId));
    // التعديل بعد الاعتماد يدخل سجل التغييرات نفسه الذي يقرأه المدير — لا سجلّان متوازيان
    if (program.status !== "مسودة" || settled) {
      const rows = [
        { field: "progress", fieldLabel: "نسبة الإنجاز", oldValue: String(before.progress), newValue: String(parsed.data.progress) },
        { field: "executionStatus", fieldLabel: "حالة التنفيذ", oldValue: before.executionStatus, newValue: parsed.data.executionStatus },
      ].filter((r) => r.oldValue !== r.newValue);
      if (rows.length > 0) {
        await tx.insert(programEditHistory).values(
          rows.map((r) => ({
            programId,
            ...r,
            approvalStatusAtEdit: program.status,
            lifecycleAtEdit: lifecycle,
            reason: reason || null,
            actorId: user.id,
          })),
        );
      }
    }
  });

  await audit({
    actorId: user.id,
    action: "program.progress_updated",
    entityType: "program",
    entityId: programId,
    summary: `تحديث تقدم «${program.name}» إلى ${parsed.data.progress}٪ — ${parsed.data.executionStatus}`,
    detail: { before, after: { progress: parsed.data.progress, executionStatus: parsed.data.executionStatus }, reason: reason || null },
  });
  // D-049: لا نُبطِل مسار الصفحة المفتوحة
  revalidateOtherPaths(["/plan", `/plan/${programId}`, "/plan/followup"], { except: `/plan/${programId}` });
  return { success: "حُدّث تقدم البرنامج وحالته" };
}

/* ── تصحيح تناقض حالات البرامج (v2.4.1 §5.3/§5.4) ──────────────────────────
 * سجلات قديمة تحمل «مكتمل» مع تقدم 0٪ وبلا تاريخ اكتمال. النظام **يكشف ولا يخمّن**:
 * القيم كلها من إدخال المدير الصريح، ولا شيء يُملأ تلقائياً، ولا تُمسّ حالة الاعتماد أو
 * الإقفال إلا باختيار صريح عبر إجراءاتها الخاصة.
 */

/** «مكتمل» غير مُنتقاة مسبقاً في الواجهة — والمخطط لا يفترض قيمة افتراضية أصلاً */
const correctionSchema = z.object({
  executionStatus: z.enum(FOLLOWUP_STATUSES, { message: "حالة التنفيذ غير صحيحة" }),
  progress: z.coerce.number().int().min(0, "النسبة بين 0 و100").max(100, "النسبة بين 0 و100"),
  /** «keep» يبقي التاريخ · «clear» يمسحه · تاريخ ISO يضبطه */
  completedAt: z.string().trim().optional(),
  note: z.string().trim().min(1, "اذكر سبب التصحيح — يُحفظ في سجل التدقيق").max(1000),
});

/**
 * تصحيح حالة برنامج واحد بقرار صريح من المدير.
 *
 * لا يغيّر `status` ولا `approvedAt` ولا `closedAt` إطلاقاً — الاعتماد والإقفال لهما
 * إجراءاتهما المدقَّقة. (v2.4.1 §1.6) الإقفال لم يعد مانعاً للتصحيح؛ السبب المكتوب
 * إلزامي وهو ما يوثّق المساس بسجل مقفل.
 */
export async function correctProgramConsistencyAction(
  programId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // معرّف مُلفَّق غير صالح يوقف الطلب برسالة عربية بدل «invalid input syntax for type uuid»
  if (!isUuid(programId)) return { error: "البرنامج غير موجود" };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  // v2.4.1 §1.6: الإقفال لم يعد مانعاً. `plan.override` لم يكن ممنوحاً لأي دور أصلاً،
  // فكان الشرط منعاً مطلقاً لا استثناءً مخوَّلاً. السبب المكتوب (`note`) إلزامي هنا
  // أصلاً وهو ما يوثّق المساس بسجل مقفل.

  const before = {
    executionStatus: program.executionStatus,
    progress: program.progress,
    completedAt: program.completedAt?.toISOString() ?? null,
  };

  // التاريخ: إبقاء / مسح / ضبط صريح — لا اشتقاق تلقائي من الحالة
  let completedAt = program.completedAt;
  if (d.completedAt === "clear") completedAt = null;
  else if (d.completedAt && d.completedAt !== "keep") {
    // صيغة YYYY-MM-DD حصراً + مدى واقعي: تاريخ اكتمال في سنة 9999 يفسد كل ترتيب وتقرير
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.completedAt)) return { error: "تاريخ الاكتمال غير صحيح" };
    const parsedDate = new Date(`${d.completedAt}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime())) return { error: "تاريخ الاكتمال غير صحيح" };
    const year = parsedDate.getUTCFullYear();
    if (year < 2000 || year > 2100) return { error: "تاريخ الاكتمال خارج المدى المقبول" };
    completedAt = parsedDate;
  }

  await snapshotRecord({
    entityType: "program",
    entityId: programId,
    action: "updated",
    snapshot: program,
    reason: `تصحيح تناقض حالة: ${d.note}`,
    actorId: user.id,
  });
  await db
    .update(programs)
    .set({
      executionStatus: d.executionStatus,
      progress: d.progress,
      completedAt,
      updatedAt: new Date(),
    })
    .where(eq(programs.id, programId));

  await audit({
    actorId: user.id,
    action: "program.consistency_corrected",
    entityType: "program",
    entityId: programId,
    summary: `تصحيح حالة «${orFallback(program.name)}» — ${before.executionStatus}/${before.progress}٪ ← ${d.executionStatus}/${d.progress}٪`,
    detail: {
      before,
      after: { executionStatus: d.executionStatus, progress: d.progress, completedAt: completedAt?.toISOString() ?? null },
      note: d.note,
    },
  });
  // D-049: لا نُبطِل مسار الصفحة المفتوحة — إبطالها يُجهض تدفّق استجابة الإجراء.
  //         تحديثها من العميل عبر router.refresh() بعد استقرار النتيجة (lib/revalidate.ts).
  revalidatePath("/plan/followup");
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan");
  return { success: "صُحّحت حالة البرنامج" };
}

/**
 * سقف الدفعة الواحدة في التصحيح الجماعي (v2.4.1 §5) — الشاشة تعرض عشرات البرامج لا آلافاً،
 * فالسقف يمنع دفعة مُلفَّقة ضخمة من تحويل «تصحيح مراجَع» إلى كتابة جماعية غير مقروءة.
 */
const BULK_MAX_PROGRAMS = 200;

/** العمليات الجماعية المسموحة — متجانسة وآمنة فقط، بلا «أصلح كل شيء» */
const BULK_OPERATIONS = {
  resetToNotStarted: "إعادة الحالة إلى «لم يبدأ»",
  clearCompletionDate: "مسح تاريخ الاكتمال",
} as const;
export type BulkOperation = keyof typeof BULK_OPERATIONS;

const bulkSchema = z.object({
  operation: z.enum(["resetToNotStarted", "clearCompletionDate"], { message: "العملية غير معروفة" }),
  programIds: z.string().min(1, "اختر برنامجاً واحداً على الأقل"),
  note: z.string().trim().min(1, "اذكر سبب التصحيح الجماعي").max(1000),
  confirm: z.string().optional(),
});

/**
 * تصحيح جماعي محدود (§5.4) — عمليتان متجانستان فقط، بمعاينة وعدد وتأكيد صريح وسجل تدقيق.
 * لا يوجد إجراء «أصلح كل التناقضات» بنقرة واحدة بالتصميم.
 */
export async function bulkCorrectProgramsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = bulkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.confirm !== "1") return { error: "أكّد العملية الجماعية قبل التنفيذ" };

  // معرّفات مُطهَّرة: UUID صالح فقط، بلا تكرار، وبسقف يمنع دفعة ضخمة مُلفَّقة (v2.4.1 §5)
  const ids = [...new Set(d.programIds.split(",").map((s) => s.trim()).filter((s) => isUuid(s)))];
  if (ids.length === 0) return { error: "اختر برنامجاً واحداً على الأقل" };
  if (ids.length > BULK_MAX_PROGRAMS) return { error: `التصحيح الجماعي محدود بـ ${BULK_MAX_PROGRAMS} برنامجاً في المرة الواحدة` };

  // نطاق العملية = ما تعرضه شاشة المراجعة نفسها: سجلات حيّة غير مؤرشفة. معرّف مُلفَّق
  // لبرنامج مؤرشف (لا يظهر في الشاشة ولا يقبل التصحيح) لا يمرّ لمجرد وروده في النموذج.
  const rows = await db
    .select()
    .from(programs)
    .where(and(inArray(programs.id, ids), isNull(programs.archivedAt)));
  if (rows.length === 0) return { error: "لم يُعثر على البرامج المختارة" };
  if (rows.length !== ids.length) {
    return { error: `${ids.length - rows.length} من البرامج المختارة غير موجود أو مؤرشف — حدّث الصفحة وأعد الاختيار` };
  }

  // v2.4.1 §1.6: التعديل الفردي متاح للبرنامج المقفل، أما **الدفعة** فتبقى مستبعِدة له
  // عمداً: عملية جماعية تمسّ سجلات أقفلها المدير بضغطة واحدة تناقض «تصحيح مراجَع».
  // البديل ظاهر ومباشر: افتح البرنامج المقفل وصحّحه فردياً بسببه المكتوب.
  const blocked = rows.filter((p) => p.closedAt || p.status === "مقفل");
  if (blocked.length > 0) {
    return { error: `${blocked.length} برنامج مقفل ضمن الاختيار — صحّح كل واحد منها من صفحته مباشرةً بسبب مكتوب` };
  }

  let changed = 0;
  for (const p of rows) {
    const patch =
      d.operation === "resetToNotStarted"
        ? { executionStatus: "لم يبدأ", progress: 0, completedAt: null }
        : { completedAt: null };
    await snapshotRecord({
      entityType: "program",
      entityId: p.id,
      action: "updated",
      snapshot: p,
      reason: `تصحيح جماعي (${BULK_OPERATIONS[d.operation]}): ${d.note}`,
      actorId: user.id,
    });
    await db.update(programs).set({ ...patch, updatedAt: new Date() }).where(eq(programs.id, p.id));
    changed += 1;
  }

  await audit({
    actorId: user.id,
    action: "program.consistency_bulk_corrected",
    entityType: "program",
    summary: `تصحيح جماعي: ${BULK_OPERATIONS[d.operation]} — ${changed} برنامج`,
    detail: { operation: d.operation, programIds: ids, count: changed, note: d.note },
  });
  // D-049: لا نُبطِل مسار الصفحة المفتوحة — إبطالها يُجهض تدفّق استجابة الإجراء.
  //         تحديثها من العميل عبر router.refresh() بعد استقرار النتيجة (lib/revalidate.ts).
  revalidatePath("/plan/followup");
  revalidatePath("/plan");
  return { success: `صُحِّح ${changed} برنامج` };
}

/** اعتماد حزمة البرنامج كاملة — المدير يعتمد الحزمة وليس كل مرفق على حدة (v2.3 §3: «اعتماد») */
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
  await audit({ actorId: user.id, action: "program.approved", entityType: "program", entityId: programId, summary: `اعتماد برنامج «${program.name}»` });
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan");
  // v2.4 §11: طابور الاعتماد على الصفحة الرئيسة يتحدث فور الاعتماد
  revalidatePath("/dashboard");
  return { success: "تم الاعتماد" };
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

/**
 * حذف البرنامج = أرشفة ناعمة (تصحيحات v2.1 §A1). يعيد استخدام أعمدة الأرشفة الخاملة
 * (`archivedAt`/`archivedBy`/`archivedReason`) — إخفاء غير مدمّر قابل للاستعادة:
 * يختفي البرنامج من القوائم التشغيلية والاختيار والتقارير والتصدير مع بقاء كل سجلاته
 * التاريخية (الأنشطة، الشواهد، الميزانية، المتابعات...) سليمة. لا يمس أي ملف أو شاهد،
 * ولا يمرّ بقيد RESTRICT للمفتاح الأجنبي لأنه لا يحذف أي صف. فعل idempotent: أرشفة
 * برنامج مؤرشف مسبقاً لا تفعل شيئاً وتعيد رسالة ودّية (تمنع الحذف المزدوج بالخطأ). */
export async function archiveProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const reason = String(formData.get("reason") ?? "").trim();
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.archivedAt) return { success: "البرنامج مؤرشف مسبقاً — لا حاجة لإجراء آخر" };

  await db
    .update(programs)
    .set({ archivedAt: new Date(), archivedBy: user.id, archivedReason: reason || null, updatedAt: new Date() })
    .where(eq(programs.id, programId));
  await audit({
    actorId: user.id,
    action: "program.archived",
    entityType: "program",
    entityId: programId,
    summary: `أرشفة برنامج «${program.name}»${reason ? ` — السبب: ${reason}` : ""}`,
  });
  revalidatePath("/plan");
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan/classifications");
  revalidatePath("/plan/followup");
  revalidatePath("/dashboard");
  return { success: "أُرشف البرنامج وأُخفي من الاستخدام — يمكن استرجاعه لاحقاً" };
}

/** استرجاع برنامج مؤرشف — يمسح حقول الأرشفة فيعود للاستخدام والقوائم التشغيلية */
export async function unarchiveProgramAction(programId: string): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (!program.archivedAt) return { success: "البرنامج غير مؤرشف" };

  await db
    .update(programs)
    .set({ archivedAt: null, archivedBy: null, archivedReason: null, updatedAt: new Date() })
    .where(eq(programs.id, programId));
  await audit({
    actorId: user.id,
    action: "program.unarchived",
    entityType: "program",
    entityId: programId,
    summary: `استرجاع برنامج «${program.name}» من الأرشيف`,
  });
  revalidatePath("/plan");
  revalidatePath(`/plan/${programId}`);
  revalidatePath("/plan/classifications");
  revalidatePath("/plan/followup");
  revalidatePath("/dashboard");
  return { success: "استُرجع البرنامج" };
}

/* ────────────────────────── إنشاء البرنامج وإقفاله النهائي (v2.2 §A) ────────────────────────── */

/** المسارات التي تعرض قوائم البرامج — تُحدَّث بعد كل إنشاء/إقفال/إعادة فتح */
function revalidateProgramLists(programId?: string) {
  revalidatePath("/plan");
  revalidatePath("/plan/classifications");
  revalidatePath("/plan/followup");
  revalidatePath("/dashboard");
  if (programId) revalidatePath(`/plan/${programId}`);
}

/**
 * إضافة برنامج جديد للخطة التشغيلية (v2.2 §A1).
 *
 * كل الحقول التي يُدخلها المستخدم اختيارية: يجوز حفظ برنامج بمعلومات ناقصة تماماً، ويُعرض
 * العنوان الفارغ لاحقاً بالبديل «بدون عنوان» عبر `orFallback` (لا تُخترع بيانات ولا تُملأ
 * قيم افتراضية وهمية). لا تُنشأ أنشطة ولا معالم تلقائياً (D-024).
 *
 * الحقول الداخلية فقط إلزامية ويولّدها النظام: المعرّف، السنة التخطيطية، الرقم التسلسلي،
 * الحالة الابتدائية، وبيانات التدقيق.
 */
const createProgramSchema = z.object({
  name: z.string().max(300, "اسم البرنامج طويل جداً").optional(),
  domain: z.string().max(200, "المجال طويل جداً").optional(),
  generalGoal: z.string().max(1000).optional(),
  specificGoal: z.string().max(1000).optional(),
  ownerPosition: z.string().max(200).optional(),
  periodText: z.string().max(200).optional(),
  principalNotes: z.string().max(2000).optional(),
});

/** نافذة منع الإنشاء المكرر من نقر متكرر على الزر نفسه (ثوانٍ) */
const DUPLICATE_WINDOW_MS = 20_000;

export async function createProgramAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = createProgramSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const name = (parsed.data.name ?? "").trim();
  const domain = (parsed.data.domain ?? "").trim();

  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];
  if (!activeYear) return { error: "لا توجد سنة تخطيطية — استورد الخطة التشغيلية أولاً" };
  if (activeYear.status === "مقفلة") return { error: "السنة التخطيطية مقفلة — لا يمكن إضافة برنامج" };

  // حارس الإرسال المزدوج على الخادم: نقرتان متتاليتان على «إضافة برنامج» تنتجان طلبين
  // متطابقين؛ نعيد نتيجة الأول بدل إنشاء سجل ثانٍ. (زر الإرسال يعطّل نفسه على العميل أيضاً،
  // لكن العميل وحده ليس ضماناً.)
  const recent = await db
    .select()
    .from(programs)
    .where(and(eq(programs.planYearId, activeYear.id), eq(programs.createdBy, user.id)))
    .orderBy(desc(programs.createdAt))
    .limit(1);
  const last = recent[0];
  if (
    last &&
    (last.name ?? "").trim() === name &&
    Date.now() - new Date(last.createdAt).getTime() < DUPLICATE_WINDOW_MS
  ) {
    return { success: "أُضيف البرنامج" };
  }

  // الرقم التسلسلي فريد داخل السنة (`programs_year_seq_unique`). نحسبه ونُدرج داخل معاملة
  // واحدة، ونعيد المحاولة عند تسابق إدراجين متزامنين بدل إظهار خطأ قاعدة بيانات خام.
  let createdId: string | null = null;
  for (let attempt = 0; attempt < 5 && !createdId; attempt++) {
    try {
      createdId = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ maxSeq: sql<number | null>`max(${programs.seq})` })
          .from(programs)
          .where(eq(programs.planYearId, activeYear.id));
        const nextSeq = (row?.maxSeq ?? 0) + 1;
        const [created] = await tx
          .insert(programs)
          .values({
            planYearId: activeYear.id,
            seq: nextSeq,
            // الأعمدة NOT NULL تاريخياً: يُخزَّن نص فارغ بدل قيمة مُختلقة، والعرض يتكفّل
            // بالبديل العربي «بدون عنوان» / «بدون تصنيف».
            name,
            domain,
            generalGoal: parsed.data.generalGoal?.trim() || null,
            specificGoal: parsed.data.specificGoal?.trim() || null,
            ownerPosition: parsed.data.ownerPosition?.trim() || null,
            periodText: parsed.data.periodText?.trim() || null,
            principalNotes: parsed.data.principalNotes?.trim() || null,
            status: "مسودة",
            createdBy: user.id,
          })
          .returning({ id: programs.id });
        return created.id;
      });
    } catch (err) {
      // 23505 = انتهاك قيد الفريد على (plan_year_id, seq) — سباق إدراج، نعيد المحاولة
      const code = (err as { code?: string })?.code;
      if (code !== "23505" || attempt === 4) throw err;
    }
  }
  if (!createdId) return { error: "تعذّر إنشاء البرنامج — حاول مرة أخرى" };

  await audit({
    actorId: user.id,
    action: "program.created",
    entityType: "program",
    entityId: createdId,
    summary: `إضافة برنامج «${name || "بدون عنوان"}» إلى ${activeYear.nameAr}`,
  });
  revalidateProgramLists(createdId);
  return { success: "أُضيف البرنامج" };
}

/**
 * «تعليم البرنامج كمكتمل» (التصحيح التشغيلي — سير العمل ثلاثي الحالات §A).
 *
 * قرار بشري مباشر: لا يشترط شاهداً ولا مالية ولا نشاطاً ولا معلماً ولا أي حقل —
 * ملاحظة الاكتمال اختيارية. البرنامج المكتمل يبقى قابلاً للتحرير وإضافة الشواهد
 * والوثائق، ومراجعه المالية متاحة، ويظهر في عروض وتقارير البرامج المكتملة.
 *
 * فعل idempotent: شرط `isNull(completedAt)` داخل التحديث نفسه يجعل الاكتمال ذرّياً —
 * النقر المتكرر أو طلبان متزامنان لا يضيفان صفَّي تاريخ.
 */
export async function completeProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const note = String(formData.get("note") ?? "").trim();
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.closedAt) return { error: "البرنامج مغلق نهائياً — أعد فتحه أولاً" };
  if (program.completedAt) return { success: "البرنامج مكتمل مسبقاً" };

  const completed = await db
    .update(programs)
    .set({
      completedAt: new Date(),
      completedBy: user.id,
      completionNote: note || null,
      // مواءمة حالة التنفيذ المعروضة مع الاكتمال (مفردة المتابعة الموجودة «مكتمل»)
      executionStatus: "مكتمل",
      updatedAt: new Date(),
    })
    .where(and(eq(programs.id, programId), isNull(programs.completedAt), isNull(programs.closedAt)))
    .returning({ id: programs.id });
  if (completed.length === 0) return { success: "البرنامج مكتمل مسبقاً" };

  await db.insert(programClosureHistory).values({
    programId,
    action: LIFECYCLE_ACTIONS.complete,
    fromStatus: PROGRAM_LIFECYCLE.active,
    toStatus: PROGRAM_LIFECYCLE.completed,
    note: note || null,
    actorId: user.id,
  });
  await audit({
    actorId: user.id,
    action: "program.completed",
    entityType: "program",
    entityId: programId,
    summary: `تعليم برنامج «${orFallback(program.name)}» كمكتمل${note ? ` — ${note}` : ""}`,
  });
  revalidateProgramLists(programId);
  return { success: "عُلّم البرنامج كمكتمل — يبقى قابلاً للتحرير وإضافة الشواهد حتى إقفاله نهائياً" };
}

/**
 * «إعادة البرنامج للتنفيذ» — من «مكتمل» إلى «قيد التنفيذ» (§C).
 * تاريخ الاكتمال السابق يبقى في سجل التحولات؛ تُمسح الحالة الراهنة فقط.
 */
export async function resumeProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const note = String(formData.get("note") ?? "").trim();
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.closedAt) return { error: "البرنامج مغلق نهائياً — أعد فتحه أولاً (يعود «مكتملاً» ثم أعده للتنفيذ)" };
  if (!program.completedAt) return { success: "البرنامج قيد التنفيذ أصلاً" };

  const resumed = await db
    .update(programs)
    .set({
      completedAt: null,
      completedBy: null,
      completionNote: null,
      // «مكتمل» المعروضة أثر الاكتمال — تعود «في المسار»؛ أي حالة أخرى أدخلها المستخدم تبقى
      executionStatus: program.executionStatus === "مكتمل" ? "في المسار" : program.executionStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(programs.id, programId), isNotNull(programs.completedAt), isNull(programs.closedAt)))
    .returning({ id: programs.id });
  if (resumed.length === 0) return { success: "البرنامج قيد التنفيذ أصلاً" };

  await db.insert(programClosureHistory).values({
    programId,
    action: LIFECYCLE_ACTIONS.resume,
    fromStatus: PROGRAM_LIFECYCLE.completed,
    toStatus: PROGRAM_LIFECYCLE.active,
    note: note || null,
    actorId: user.id,
  });
  await audit({
    actorId: user.id,
    action: "program.resumed",
    entityType: "program",
    entityId: programId,
    summary: `إعادة برنامج «${orFallback(program.name)}» للتنفيذ${note ? ` — ${note}` : ""}`,
  });
  revalidateProgramLists(programId);
  return { success: "أُعيد البرنامج للتنفيذ" };
}

/**
 * «إقفال البرنامج نهائياً» (v2.2 §A2 + التصحيح التشغيلي §B).
 *
 * لا يشترط شاهداً ولا نشاطاً ولا معلماً ولا نسبة جاهزية ولا اكتمال ميزانية ولا نتائج ولا أثراً
 * ولا أي حقل من إدخال المستخدم — ملاحظة الإقفال اختيارية. السجل كامل وتاريخه يبقيان سليمين:
 * لا يُحذف شيء ولا تُعدَّل شواهد أو وثائق أو مراجع مالية، ويبقى البرنامج في التقارير التاريخية.
 *
 * المسار الطبيعي يمر بالاكتمال أولاً: برنامج «قيد التنفيذ» لا يُقفل مباشرة — يوجَّه المستخدم
 * إلى «تعليم البرنامج كمكتمل» أولاً (§B: لا تحويل صامت من قيد التنفيذ إلى مغلق).
 *
 * فعل idempotent: إقفال برنامج مقفل مسبقاً لا يضيف صفاً جديداً للتاريخ ولا يكتب فوق `closedAt`
 * الأصلي — فالنقر المتكرر (أو طلبان متزامنان) لا ينتج إقفالاً مزدوجاً.
 */
export async function closeProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const note = String(formData.get("note") ?? "").trim();
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.closedAt) return { success: "البرنامج مغلق مسبقاً" };
  if (!program.completedAt) {
    return { error: "الإقفال النهائي متاح للبرامج المكتملة فقط — علّم البرنامج كمكتمل أولاً ثم أقفله" };
  }

  // شرط `isNull(closedAt)` (مع اشتراط الاكتمال) داخل التحديث نفسه يجعل الإقفال ذرّياً:
  // طلبان متزامنان ينجح أحدهما فقط في تغيير الصف، فلا يُسجَّل إقفالان في التاريخ.
  const closed = await db
    .update(programs)
    .set({ closedAt: new Date(), closedBy: user.id, closureNote: note || null, updatedAt: new Date() })
    .where(and(eq(programs.id, programId), isNull(programs.closedAt), isNotNull(programs.completedAt)))
    .returning({ id: programs.id });
  if (closed.length === 0) return { success: "البرنامج مغلق مسبقاً" };

  await db.insert(programClosureHistory).values({
    programId,
    action: LIFECYCLE_ACTIONS.close,
    fromStatus: PROGRAM_LIFECYCLE.completed,
    toStatus: PROGRAM_LIFECYCLE.closed,
    note: note || null,
    actorId: user.id,
  });
  await audit({
    actorId: user.id,
    action: "program.closed",
    entityType: "program",
    entityId: programId,
    summary: `إقفال برنامج «${orFallback(program.name)}» نهائياً${note ? ` — ${note}` : ""}`,
  });
  revalidateProgramLists(programId);
  return { success: "أُقفل البرنامج نهائياً — أصبح للقراءة فقط ويبقى في التقارير والعروض التاريخية" };
}

/**
 * «إعادة فتح البرنامج» — من «مغلق» إلى «مكتمل» (§C): لا يعود تلقائياً إلى «قيد التنفيذ».
 *
 * التاريخ السابق لا يُمسح: صفوف `program_closure_history` تبقى كما هي ويُضاف صف «إعادة فتح»،
 * فتُقرأ دورات الإقفال والفتح كاملة. البرامج المغلقة قبل هذا التصحيح (بلا `completedAt`)
 * تُستكمل حالتها الراهنة من لحظة إقفالها الأصلية — دون كتابة فوق أي قيمة موجودة.
 * idempotent كذلك: إعادة فتح برنامج مفتوح لا تفعل شيئاً.
 */
export async function reopenClosedProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.approve");
  const note = String(formData.get("note") ?? "").trim();
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (!program.closedAt) return { success: "البرنامج مفتوح أصلاً" };

  const reopened = await db
    .update(programs)
    .set({
      closedAt: null,
      closedBy: null,
      // ملاحظة الإقفال الأخيرة تبقى محفوظة في سجل التاريخ، وتُمسح من الحالة الراهنة فقط.
      closureNote: null,
      // العودة إلى «مكتمل»: برنامج أُقفل قبل وجود الاكتمال يأخذ لحظة إقفاله الأصلية
      // تاريخاً للاكتمال (COALESCE لا يكتب فوق قيمة موجودة).
      completedAt: sql`COALESCE(${programs.completedAt}, ${programs.closedAt})`,
      completedBy: sql`COALESCE(${programs.completedBy}, ${programs.closedBy})`,
      reopenedAt: new Date(),
      reopenedBy: user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(programs.id, programId), isNotNull(programs.closedAt)))
    .returning({ id: programs.id });
  if (reopened.length === 0) return { success: "البرنامج مفتوح أصلاً" };

  await db.insert(programClosureHistory).values({
    programId,
    action: LIFECYCLE_ACTIONS.reopen,
    fromStatus: PROGRAM_LIFECYCLE.closed,
    toStatus: PROGRAM_LIFECYCLE.completed,
    note: note || null,
    actorId: user.id,
  });
  await audit({
    actorId: user.id,
    action: "program.closure_reopened",
    entityType: "program",
    entityId: programId,
    summary: `إعادة فتح برنامج «${orFallback(program.name)}» — عاد بحالة «مكتمل»${note ? ` — ${note}` : ""}`,
  });
  revalidateProgramLists(programId);
  return { success: "أُعيد فتح البرنامج بحالة «مكتمل» — أعده للتنفيذ إن أردت استئناف العمل عليه" };
}

/* ── تعديل بيانات البرنامج في كل حالات دورة الحياة (v2.4.1 §1.6) ───────────
 * الحالة لم تعد تمنع التعديل. ما يحرس العملية: الصلاحية، والسبب الإلزامي بعد الاعتماد
 * أو الاكتمال أو الإقفال، وسجل تغييرات على مستوى الحقل، وحماية التعديل المتزامن.
 * لا يُمسّ `status` ولا `approvedAt` ولا `completedAt` ولا `closedAt` ولا `archivedAt`.
 */
export async function updateProgramAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  if (!isUuid(programId)) return { error: "البرنامج غير موجود" };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };

  const state = { approvalStatus: program.status, lifecycle: programLifecycle(program) };

  // حماية التعديل المتزامن: رمز الحداثة يأتي من الصفحة التي فُتحت. اختلافه يعني أن
  // السجل تغيّر بعد فتح النموذج — الحفظ يُرفض بدل الكتابة فوق تعديل شخص آخر.
  const submittedToken = String(formData.get("updatedToken") ?? "");
  if (!submittedToken) return { error: "أعد تحميل الصفحة قبل الحفظ" };
  if (submittedToken !== program.updatedAt.toISOString()) {
    return { error: "عُدّل البرنامج من مكان آخر بعد فتح هذا النموذج — أعد تحميل الصفحة وراجع القيم قبل الحفظ" };
  }

  // القيم المُرسلة فقط تُقارَن — الحقل الغائب عن النموذج لا يُمسح بصمت
  const submitted: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELD_KEYS) {
    if (formData.has(`field_${key}`)) submitted[key] = formData.get(`field_${key}`);
  }
  const changes = detectChanges(program as unknown as Record<string, unknown>, submitted);
  if (changes.length === 0) return { success: "لا تغييرات لحفظها" };

  const reason = String(formData.get("reason") ?? "").trim();
  if (reasonRequiredFor(state) && reason.length < 3) return { error: REASON_REQUIRED_MESSAGE };

  // حرس المبالغ: الميزانية رقم أو فراغ — لا نص حر يفسد كل مجموع مالي لاحق
  const budgetChange = changes.find((c) => c.field === "budget");
  if (budgetChange && budgetChange.newValue !== null) {
    const n = Number(budgetChange.newValue);
    if (!Number.isFinite(n) || n < 0) return { error: "الميزانية يجب أن تكون رقماً موجباً أو فارغة" };
    if (n > MAX_MONEY_AMOUNT) return { error: MAX_MONEY_MESSAGE };
  }

  const patch: Record<string, string | null> = {};
  for (const c of changes) patch[c.field] = c.newValue;

  // شرط `updated_at` داخل التحديث نفسه يجعل فحص التزامن ذرّياً لا فحصاً مسبقاً فحسب:
  // طلبان متزامنان لا ينجح منهما إلا الأول، والثاني يعود برسالة «عُدّل من مكان آخر».
  //
  // `date_trunc` ليست تجميلاً: عمود `timestamptz` يحفظ بدقة الميكروثانية بينما `Date`
  // في JS بدقة الملّي، فالمقارنة المباشرة لا تطابق أبداً وكانت سترفض كل تعديل بوصفه
  // «قديماً». التقريب إلى الملّي على الطرفين يجعل الرمز المُرسل مطابقاً لما في العمود.
  const applied = await db.transaction(async (tx) => {
    const updated = await tx
      .update(programs)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(programs.id, programId),
          sql`date_trunc('milliseconds', ${programs.updatedAt}) = date_trunc('milliseconds', ${program.updatedAt}::timestamptz)`,
        ),
      )
      .returning({ id: programs.id });
    if (updated.length === 0) return false;

    await tx.insert(programEditHistory).values(
      changes.map((c) => ({
        programId,
        field: c.field,
        fieldLabel: c.fieldLabel,
        oldValue: c.oldValue,
        newValue: c.newValue,
        approvalStatusAtEdit: state.approvalStatus,
        lifecycleAtEdit: state.lifecycle,
        reason: reason || null,
        actorId: user.id,
      })),
    );
    return true;
  });
  if (!applied) {
    return { error: "عُدّل البرنامج من مكان آخر بعد فتح هذا النموذج — أعد تحميل الصفحة وراجع القيم قبل الحفظ" };
  }

  await audit({
    actorId: user.id,
    action: "program.edited",
    entityType: "program",
    entityId: programId,
    summary: `تعديل «${orFallback(program.name)}» (${state.approvalStatus} · ${state.lifecycle}) — ${changesSummaryAr(changes)}`,
    detail: {
      approvalStatusAtEdit: state.approvalStatus,
      lifecycleAtEdit: state.lifecycle,
      reason: reason || null,
      changes: changes.map((c) => ({ field: c.field, label: c.fieldLabel, from: c.oldValue, to: c.newValue })),
    },
  });

  // D-049: لا نُبطِل مسار الصفحة المفتوحة — العميل يحدّثها بعد استقرار النتيجة
  revalidateOtherPaths(["/plan", `/plan/${programId}`, "/plan/consistency", "/reports"], {
    except: `/plan/${programId}`,
  });
  return { success: `حُفظ التعديل — ${changes.length} حقلاً: ${changesSummaryAr(changes)}` };
}

/** طلب تغيير على برنامج معتمد: قيمة قديمة/جديدة وسبب واعتماد */
const changeRequestSchema = z.object({
  // الحقول التجارية اختيارية (تصحيحات v2.1 §H): القيمة الجديدة قد تكون فارغة (مسح الحقل).
  // بوابة الأمان تبقى: `field` يُقيَّد بقائمة الحقول المسموحة أدناه، والسبب المدقق إلزامي.
  field: z.string(),
  fieldLabel: z.string(),
  newValue: z.string(),
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
  if (program.closedAt) return { error: "البرنامج مغلق نهائياً — أعد فتحه أولاً قبل طلب تغيير" };
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
  revalidatePath("/dashboard");
  return null;
}

/** المتابعة الأسبوعية لبرنامج معتمد — سجل واحد لكل أسبوع ISO (إعادة الإرسال تحدث سجل الأسبوع نفسه).
 *  التقدم يُدخل مباشرةً هنا (D-024) — لا يُشتقّ من الأنشطة. */
const followupSchema = z.object({
  // نص المتابعة اختياري (تصحيحات v2.1 §H) — يُخزَّن "" عند الفراغ (العمود NOT NULL).
  note: z.string().trim().optional(),
  executionStatus: z.enum(FOLLOWUP_STATUSES, { message: "حالة التنفيذ غير صحيحة" }),
  // v2.4: الحقل الفارغ يعني «أبق التقدم كما هو» — z.coerce وحدها تحول "" إلى 0 فتصفر التقدم بصمت
  progress: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(0, "النسبة بين 0 و100").max(100, "النسبة بين 0 و100").optional(),
  ),
});

export async function submitFollowupAction(programId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const parsed = followupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program) return { error: "البرنامج غير موجود" };
  if (program.status !== "معتمد") return { error: "المتابعة الأسبوعية للبرامج المعتمدة فقط" };
  if (program.closedAt) return { error: "البرنامج مغلق نهائياً — أعد فتحه أولاً قبل تسجيل متابعة" };

  // التقدم المُدخل مباشرةً إن وُجد، وإلا يبقى تقدم البرنامج كما هو
  const progress = parsed.data.progress ?? program.progress;
  // نص المتابعة اختياري (v2.1 §H) — "" يفي بقيد NOT NULL على العمود
  const note = parsed.data.note ?? "";
  const now = new Date();
  const weekKey = isoWeekKey(now);
  await db
    .insert(programFollowups)
    .values({
      programId,
      weekKey,
      note,
      executionStatus: parsed.data.executionStatus,
      progressSnapshot: progress,
      createdBy: user.id,
    })
    .onConflictDoUpdate({
      target: [programFollowups.programId, programFollowups.weekKey],
      // v2.4: لا يُعاد ضبط createdAt عند تعديل سجل الأسبوع — إعادة ضبطه كانت تجعل أسبوعاً
      // قديماً معدلاً يتقدم على الأسبوع الحالي في الترتيب الزمني
      set: {
        note,
        executionStatus: parsed.data.executionStatus,
        progressSnapshot: progress,
        createdBy: user.id,
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

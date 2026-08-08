import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { reportInstances, reportJobs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { ensureStoredOutput, rebuildZip, isOutputFormat, type OutputFormat } from "./outputs";
import { INSTANCE_DRAFT } from "./types";

/**
 * مهام توليد المخرجات في الخلفية (v2.6 §I — D-059).
 *
 * الجدول هو الحقيقة و`after()` هو المنفّذ: إجراء الخادم يُدرج صف المهمة ويعود فوراً،
 * ثم يجدول `after(() => runJob(id))` فيجري التوليد بعد اكتمال بثّ الاستجابة — بنيوياً
 * لا يمكن أن يقطع التوليد استجابةً ما زالت تُبث (فئة D-049/D-053 مستحيلة هنا).
 *
 * الاعتمادية (§I):
 *  - مهمة نشطة واحدة لكل تقرير — الفهرس الجزئي الفريد يجعل التزامن يفشل مبكراً بصوت.
 *  - التوليد متكرّر التنفيذ بأمان: الصيغة المحفوظة تُتخطى، فالإعادة تكمل الناقص فقط.
 *  - المهمة العالقة تُعرف من نبضها القديم وتُغلق «انقطع التوليد» ثم تُنشأ محاولة جديدة
 *    برقم محاولة أعلى — تاريخ المهمة الميتة لا يُحرَّر.
 *  - الفشل يحفظ سبباً عربياً ويُبقي التقرير كما هو؛ «إعادة المحاولة» زر لا طقس.
 */

export const JOB_PENDING = "قيد الانتظار";
export const JOB_RUNNING = "قيد التنفيذ";
export const JOB_DONE = "مكتمل";
export const JOB_FAILED = "فشل";

/** بعد هذه المدة بلا نبض تُعد المهمة «قيد التنفيذ» منقطعة ويجوز إغلاقها وإعادة المحاولة */
export const STALE_AFTER_MS = 5 * 60 * 1000;

type Viewer = { id: string; permissions: Set<string> };

export type JobResult = { error?: string; success?: string; jobId?: string };

/** أحدث مهمة لهذا التقرير — لعرض الحالة والتقدم في الواجهة */
export async function latestJob(instanceId: string) {
  const [job] = await db
    .select()
    .from(reportJobs)
    .where(eq(reportJobs.instanceId, instanceId))
    .orderBy(desc(reportJobs.createdAt))
    .limit(1);
  return job ?? null;
}

/** المهمة النشطة منقطعة إن قدُم نبضها — دالة خالصة للاختبار */
export function isStale(job: { status: string; heartbeatAt: Date | null; startedAt: Date | null; createdAt: Date }, now = new Date()): boolean {
  if (job.status !== JOB_RUNNING && job.status !== JOB_PENDING) return false;
  const last = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
  return now.getTime() - last.getTime() > STALE_AFTER_MS;
}

/**
 * طلب توليد المخرجات لتقرير معتمد. يعيد معرّف المهمة الجديدة؛ على المستدعي جدولة
 * `after(() => runJob(jobId))`. المهمة النشطة القائمة: إن كانت حيّة رُفض الطلب بوضوح،
 * وإن كانت منقطعة أُغلقت بسبب صريح وأُنشئت محاولة جديدة.
 */
export async function requestGeneration(
  instanceId: string,
  formats: string[],
  viewer: Viewer,
): Promise<JobResult> {
  if (!viewer.permissions.has("reports.generate")) return { error: "لا تملك صلاحية توليد التقارير" };
  const [row] = await db.select().from(reportInstances).where(eq(reportInstances.id, instanceId));
  if (!row) return { error: "التقرير غير موجود" };
  if (row.sensitive && !viewer.permissions.has("performance.individual.read")) return { error: "التقرير غير موجود" };
  if (row.status === INSTANCE_DRAFT) return { error: "اعتمد التقرير أولاً — مخرجات المسودة تُنزَّل مباشرة ولا تُحفظ" };

  const wanted = [...new Set(formats.filter(isOutputFormat))];
  if (wanted.length === 0) return { error: "اختر صيغة واحدة على الأقل" };

  const [active] = await db
    .select()
    .from(reportJobs)
    .where(and(eq(reportJobs.instanceId, instanceId), inArray(reportJobs.status, [JOB_PENDING, JOB_RUNNING])));

  let attempt = 1;
  if (active) {
    if (!isStale(active)) return { error: "توليد هذا التقرير جارٍ فعلاً — انتظر اكتماله" };
    // إغلاق المهمة المنقطعة بسبب صريح؛ لا تُحرَّر محاولتها، تُنشأ محاولة جديدة فوقها
    await db
      .update(reportJobs)
      .set({ status: JOB_FAILED, error: "انقطع التوليد قبل اكتماله — أُنشئت محاولة جديدة", finishedAt: new Date() })
      .where(eq(reportJobs.id, active.id));
    attempt = active.attempt + 1;
  }

  try {
    const [job] = await db
      .insert(reportJobs)
      .values({ instanceId, formats: wanted, attempt, requestedBy: viewer.id })
      .returning();
    return { success: "بدأ توليد المخرجات في الخلفية", jobId: job.id };
  } catch (e) {
    // سباق على الفهرس الجزئي الفريد: طلبان متزامنان — الثاني يخسر بوضوح لا بصمت
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "23505") {
      return { error: "توليد هذا التقرير جارٍ فعلاً — انتظر اكتماله" };
    }
    throw e;
  }
}

/**
 * تنفيذ مهمة — يُستدعى من `after()` أو من الاختبارات مباشرة. كل صيغة تُولَّد وتُحفظ ثم
 * يُحدَّث النبض؛ وبعدها تُجمَّع الحزمة. الفشل يسجّل سبباً عربياً ولا يمسّ ما اكتمل.
 */
export async function runJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(reportJobs).where(eq(reportJobs.id, jobId));
  if (!job || job.status === JOB_DONE || job.status === JOB_FAILED) return;

  const beat = () => db.update(reportJobs).set({ heartbeatAt: new Date() }).where(eq(reportJobs.id, jobId));
  await db
    .update(reportJobs)
    .set({ status: JOB_RUNNING, startedAt: new Date(), heartbeatAt: new Date() })
    .where(eq(reportJobs.id, jobId));

  try {
    const [row] = await db.select().from(reportInstances).where(eq(reportInstances.id, job.instanceId));
    if (!row) throw new Error("التقرير لم يعد موجوداً");

    for (const format of (job.formats ?? []).filter(isOutputFormat)) {
      await ensureStoredOutput(row, format as OutputFormat, job.requestedBy ?? row.finalizedBy ?? "");
      await beat();
    }
    await rebuildZip(row, job.requestedBy ?? row.finalizedBy ?? "");

    await db
      .update(reportJobs)
      .set({ status: JOB_DONE, finishedAt: new Date(), error: null })
      .where(eq(reportJobs.id, jobId));
    await audit({
      actorId: job.requestedBy ?? undefined,
      action: "report_instance.outputs_generated",
      entityType: "report_instance",
      entityId: job.instanceId,
      summary: `اكتمل توليد مخرجات التقرير (${(job.formats ?? []).join("، ")}) والمحاولة ${job.attempt}`,
    });
  } catch (e) {
    // سبب عربي مفهوم للواجهة — رسائل النظام الداخلية لا تُكشف (§H)
    const reason =
      e instanceof Error && /^[؀-ۿ]/.test(e.message) ? e.message : "تعذر توليد المخرجات — أعد المحاولة";
    await db
      .update(reportJobs)
      .set({ status: JOB_FAILED, error: reason, finishedAt: new Date() })
      .where(eq(reportJobs.id, jobId));
    await audit({
      actorId: job.requestedBy ?? undefined,
      action: "report_instance.outputs_failed",
      entityType: "report_instance",
      entityId: job.instanceId,
      summary: `فشل توليد مخرجات التقرير — ${reason}`,
      detail: { attempt: job.attempt },
    });
  }
}

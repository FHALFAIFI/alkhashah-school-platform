"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, getCurrentUser } from "@/lib/auth/session";
import { saveUploadedFile } from "@/lib/storage";
import { createBatch, commitBatch, rollbackBatch, applyRowDecision, undoLastRowDecision, getBatchWithRows, findLiveBatchesForFile, cancelBatch } from "@/lib/imports/framework";
import { parsePeopleWorkbook, commitPeopleRows, rollbackPeopleBatch } from "@/lib/imports/people";
import { parsePlanWorkbook, commitPlanRows, rollbackPlanBatch, parseSwotWorkbook, commitSwotRows, rollbackSwotBatch } from "@/lib/imports/plan";
import { notifyAll } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { db } from "@/db";
import { planYears } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { userFacingError } from "@/lib/user-error";

export type ImportActionState =
  | {
      error?: string;
      /** نتيجة نوعية للتنفيذ: انتهاء الجلسة، رفض الصلاحية، أو دفعة نُفّذت مسبقاً */
      code?: "SESSION_EXPIRED" | "PERMISSION_DENIED" | "ALREADY_EXECUTED";
      /** رابط تسجيل دخول مع returnTo مُتحقَّق منه للدفعة نفسها (عند انتهاء الجلسة) */
      loginHref?: string;
    }
  | null;

export async function uploadImportAction(_prev: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const user = await requirePermission("imports.read", "people.import");
  const importType = String(formData.get("importType") ?? "");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "اختر ملف Excel أولاً" };
  if (!["people", "operational_plan", "plan_swot"].includes(importType)) return { error: "نوع استيراد غير معروف" };

  // منع التكرار: دفعة حية (معاينة/منفذة) لنفس الملف والنوع توقف الرفع مع توجيه صريح
  const existing = await findLiveBatchesForFile(importType, file.name);
  if (existing.length > 0) {
    const b = existing[0];
    const where = b.status === "منفذة" ? "منفذة مسبقاً" : "قيد المعاينة";
    return {
      error: `يوجد استيراد لنفس الملف «${file.name}» (${where}). افتح الدفعة القائمة من صفحة الاستيراد، أو ألغِها إن كانت في المعاينة، قبل رفع نسخة جديدة — لتفادي التكرار.`,
    };
  }

  const data = Buffer.from(await file.arrayBuffer());
  let batchId: string;
  try {
    const stored = await saveUploadedFile({
      originalName: file.name,
      mime: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data,
      scope: "imports",
      uploadedBy: user.id,
    });

    if (importType === "people") {
      const { rows, columnMapping, detectedColumns } = await parsePeopleWorkbook(data);
      const batch = await createBatch({
        importType,
        sourceFileName: file.name,
        sourceFileId: stored.id,
        columnMapping: { columnMapping, detectedColumns },
        rows,
        summary: { "إجمالي الصفوف": rows.length },
        createdBy: user.id,
      });
      batchId = batch.id;
    } else {
      // مسار «التحليل الرباعي فقط» يقرأ ورقة واحدة ولا يُنشئ صفوفاً لأي كيان آخر (D-030)
      const { rows, summary } =
        importType === "plan_swot" ? await parseSwotWorkbook(data) : await parsePlanWorkbook(data);
      const batch = await createBatch({
        importType,
        sourceFileName: file.name,
        sourceFileId: stored.id,
        rows,
        summary,
        createdBy: user.id,
      });
      batchId = batch.id;
    }
  } catch (e) {
    return { error: userFacingError(e, "تعذر تحليل الملف") };
  }
  redirect(`/imports/${batchId}`);
}

export async function correctRowAction(rowId: string, batchId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("imports.read");
  const corrections: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("f_")) corrections[key.slice(2)] = String(value);
  }
  await applyRowDecision({ rowId, action: "تصحيح", corrections, actorId: user.id, actorName: user.displayName });
  revalidatePath(`/imports/${batchId}`);
}

export async function excludeRowAction(rowId: string, batchId: string): Promise<void> {
  const user = await requirePermission("imports.read");
  await applyRowDecision({ rowId, action: "استبعاد", actorId: user.id, actorName: user.displayName });
  revalidatePath(`/imports/${batchId}`);
}

export async function markRowReadyAction(rowId: string, batchId: string): Promise<void> {
  const user = await requirePermission("imports.read");
  await applyRowDecision({ rowId, action: "تأكيد كجاهز", actorId: user.id, actorName: user.displayName });
  revalidatePath(`/imports/${batchId}`);
}

export async function deferRowAction(rowId: string, batchId: string): Promise<void> {
  const user = await requirePermission("imports.read");
  await applyRowDecision({ rowId, action: "تأجيل", actorId: user.id, actorName: user.displayName });
  revalidatePath(`/imports/${batchId}`);
}

export async function returnRowToReviewAction(rowId: string, batchId: string): Promise<void> {
  const user = await requirePermission("imports.read");
  await applyRowDecision({ rowId, action: "إعادة إلى المراجعة", actorId: user.id, actorName: user.displayName });
  revalidatePath(`/imports/${batchId}`);
}

export async function undoRowDecisionAction(rowId: string, batchId: string): Promise<void> {
  const user = await requirePermission("imports.read");
  await undoLastRowDecision({ rowId, actorId: user.id, actorName: user.displayName });
  revalidatePath(`/imports/${batchId}`);
}

export async function cancelBatchAction(batchId: string): Promise<ImportActionState> {
  const user = await requirePermission("imports.read");
  try {
    await cancelBatch(batchId, user.id);
  } catch (e) {
    return { error: userFacingError(e, "تعذر إلغاء الدفعة") };
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  return null;
}

export async function commitBatchAction(batchId: string): Promise<ImportActionState> {
  // مصادقة غير رامية: فعلٌ يُستدعى عبر startTransition يجب ألا يُطلق NEXT_REDIRECT
  // (يُبتلع بصمت فيبقى المؤشر يدور بلا أثر). نُعيد نتيجة نوعية بدل التوجيه.
  const user = await getCurrentUser();
  if (!user) {
    return {
      code: "SESSION_EXPIRED",
      loginHref: `/login?returnTo=${encodeURIComponent(`/imports/${batchId}`)}`,
    };
  }
  if (!user.permissions.has("imports.commit")) {
    return { code: "PERMISSION_DENIED", error: "لا تملك صلاحية تنفيذ الاستيراد. لم يتم تنفيذ الاستيراد." };
  }

  const data = await getBatchWithRows(batchId);
  if (!data) return { error: "الدفعة غير موجودة" };
  // دفعة نُفّذت مسبقاً (محاولة سابقة نجحت/نافذة أخرى): حالة راهنة ناجحة — لا خطأ مُفزع
  if (data.batch.status === "منفذة") return { code: "ALREADY_EXECUTED" };

  // معرّف ارتباط لتتبّع كل محاولة مُصرَّح بها تصل الخادم عبر أحداث التدقيق (بدء/نجاح/فشل)
  const correlationId = randomUUID();
  const ref = correlationId.slice(0, 8);
  // حدث «بدء التنفيذ» — يُسجَّل لأي طلب مُصرَّح يصل الخادم، فيبقى أثر حتى لو فشل التنفيذ لاحقاً
  await audit({
    actorId: user.id,
    action: "import.batch_commit_started",
    entityType: "import_batch",
    entityId: batchId,
    summary: "بدء تنفيذ دفعة استيراد",
    detail: { correlationId, importType: data.batch.importType },
  });

  try {
    if (data.batch.importType === "people") {
      await commitBatch(batchId, user.id, (tx, rows) => commitPeopleRows(tx, rows, batchId, user.id), { correlationId });
    } else if (data.batch.importType === "operational_plan") {
      // السنة التخطيطية النشطة هي الوجهة — لا سنة مثبتة في الشيفرة
      const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة")).limit(1);
      await commitBatch(
        batchId,
        user.id,
        (tx, rows) =>
          commitPlanRows(tx, rows, batchId, {
            planYearKey: activeYear?.key ?? "1448-1449",
            planYearName: activeYear?.nameAr ?? "العام الدراسي 1448/1449هـ",
            createdBy: user.id,
          }),
        { correlationId },
      );
    } else if (data.batch.importType === "plan_swot") {
      await commitBatch(batchId, user.id, (tx, rows) => commitSwotRows(tx, rows, batchId), { correlationId });
    } else {
      return { error: "نوع استيراد غير مدعوم" };
    }
  } catch (e) {
    // سباق: نُفِّذت الدفعة أثناء محاولتنا (نافذة/نقرة متزامنة) → حالة راهنة ناجحة لا فشل
    const fresh = await getBatchWithRows(batchId);
    if (fresh?.batch.status === "منفذة") {
      return { code: "ALREADY_EXECUTED" };
    }
    // التفاصيل الفنية تبقى في سجل التدقيق على الخادم فقط. المستخدم يرى رسالة عربية عامة
    // ومعرّفاً مرجعياً يربط شكواه بالسجل — فلا يتسرّب مسار ملف ولا اسم جدول ولا نص خطأ
    // إنجليزي خام إلى الواجهة (كان يُعاد `e.message` كما هو رغم أن التعليق يقول عكس ذلك).
    const technical = e instanceof Error ? e.message : "فشل التنفيذ";
    await audit({
      actorId: user.id,
      action: "import.batch_commit_failed",
      entityType: "import_batch",
      entityId: batchId,
      summary: "فشل تنفيذ دفعة استيراد",
      detail: { correlationId, error: technical.slice(0, 300) },
    });
    return { error: `تعذّر تنفيذ الدفعة ولم تُحفظ أي بيانات. (مرجع الخطأ: ${ref})` };
  }

  // آثار جانبية بعد نجاح المعاملة — يجب ألا يُفشل إخفاقُها نتيجةَ تنفيذٍ نجح فعلاً
  try {
    const notifyLink = data.batch.importType === "people" ? `/people?دفعة=${batchId}` : `/imports/${batchId}`;
    await notifyAll({ title: "تم تنفيذ دفعة استيراد", body: `نفذت دفعة ${data.batch.sourceFileName} بنجاح`, link: notifyLink });
  } catch {
    // التنفيذ نجح والدفعة «منفذة» — تجاهل فشل الإشعار (غير حرج)
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  revalidatePath("/people");
  return null;
}

export async function rollbackBatchAction(batchId: string): Promise<ImportActionState> {
  const user = await requirePermission("imports.rollback");
  const data = await getBatchWithRows(batchId);
  if (!data) return { error: "الدفعة غير موجودة" };
  try {
    if (data.batch.importType === "people") {
      await rollbackBatch(batchId, user.id, (tx) => rollbackPeopleBatch(tx, batchId));
    } else if (data.batch.importType === "operational_plan") {
      await rollbackBatch(batchId, user.id, (tx) => rollbackPlanBatch(tx, batchId));
    } else if (data.batch.importType === "plan_swot") {
      await rollbackBatch(batchId, user.id, (tx) => rollbackSwotBatch(tx, batchId));
    }
  } catch (e) {
    return { error: userFacingError(e, "فشل التراجع") };
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  return null;
}

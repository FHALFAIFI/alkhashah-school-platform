"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { saveUploadedFile } from "@/lib/storage";
import { createBatch, commitBatch, rollbackBatch, applyRowDecision, undoLastRowDecision, getBatchWithRows } from "@/lib/imports/framework";
import { parsePeopleWorkbook, commitPeopleRows, rollbackPeopleBatch } from "@/lib/imports/people";
import { parsePlanWorkbook, commitPlanRows, rollbackPlanBatch } from "@/lib/imports/plan";
import { notifyAll } from "@/lib/notify";
import { db } from "@/db";
import { planYears } from "@/db/schema";
import { eq } from "drizzle-orm";

export type ImportActionState = { error?: string } | null;

export async function uploadImportAction(_prev: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const user = await requirePermission("imports.read", "people.import");
  const importType = String(formData.get("importType") ?? "");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "اختر ملف Excel أولاً" };
  if (!["people", "operational_plan"].includes(importType)) return { error: "نوع استيراد غير معروف" };

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
      const { rows, summary } = await parsePlanWorkbook(data);
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
    return { error: e instanceof Error ? e.message : "تعذر تحليل الملف" };
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

export async function commitBatchAction(batchId: string): Promise<ImportActionState> {
  const user = await requirePermission("imports.commit");
  const data = await getBatchWithRows(batchId);
  if (!data) return { error: "الدفعة غير موجودة" };
  try {
    if (data.batch.importType === "people") {
      await commitBatch(batchId, user.id, (tx, rows) => commitPeopleRows(tx, rows, batchId, user.id));
    } else if (data.batch.importType === "operational_plan") {
      // السنة التخطيطية النشطة هي الوجهة — لا سنة مثبتة في الشيفرة
      const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة")).limit(1);
      await commitBatch(batchId, user.id, (tx, rows) =>
        commitPlanRows(tx, rows, batchId, {
          planYearKey: activeYear?.key ?? "1448-1449",
          planYearName: activeYear?.nameAr ?? "العام الدراسي 1448/1449هـ",
          createdBy: user.id,
        }),
      );
    } else {
      return { error: "نوع استيراد غير مدعوم" };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل التنفيذ" };
  }
  // استيراد الأشخاص يوجه إلى سجل الموظفين مصفى بالدفعة؛ باقي الأنواع تبقى على صفحة الدفعة
  const notifyLink = data.batch.importType === "people" ? `/people?دفعة=${batchId}` : `/imports/${batchId}`;
  await notifyAll({ title: "تم تنفيذ دفعة استيراد", body: `نفذت دفعة ${data.batch.sourceFileName} بنجاح`, link: notifyLink });
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
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل التراجع" };
  }
  revalidatePath(`/imports/${batchId}`);
  revalidatePath("/imports");
  return null;
}

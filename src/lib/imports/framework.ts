import "server-only";
import { eq, asc, and } from "drizzle-orm";
import { db } from "@/db";
import { importBatches, importRows } from "@/db/schema";
import { audit } from "@/lib/audit";

/**
 * إطار الاستيراد الآمن (DECISIONS D-011):
 * رفع → تحليل دون كتابة سجلات عمل → معاينة → تحقق → تصحيح → موافقة صريحة →
 * تنفيذ بمعاملة واحدة → حفظ الملخص وسجل الأخطاء → تراجع كامل عند الأمان.
 */

export type ParsedRow = {
  rowIndex: number;
  raw: Record<string, unknown>;
  mapped: Record<string, unknown>;
  validation: { errors: string[]; warnings: string[] };
  status: "جاهز" | "يحتاج مراجعة" | "مستبعد";
};

export async function createBatch(opts: {
  importType: string;
  sourceFileName: string;
  sourceFileId?: string;
  columnMapping?: unknown;
  options?: unknown;
  rows: ParsedRow[];
  summary?: unknown;
  createdBy: string;
}) {
  const [batch] = await db
    .insert(importBatches)
    .values({
      importType: opts.importType,
      sourceFileName: opts.sourceFileName,
      sourceFileId: opts.sourceFileId,
      columnMapping: opts.columnMapping as object,
      options: opts.options as object,
      summary: opts.summary as object,
      createdBy: opts.createdBy,
    })
    .returning();
  for (const r of opts.rows) {
    await db.insert(importRows).values({
      batchId: batch.id,
      rowIndex: r.rowIndex,
      raw: r.raw,
      mapped: r.mapped,
      validation: r.validation,
      status: r.status,
    });
  }
  await audit({
    actorId: opts.createdBy,
    action: "import.batch_created",
    entityType: "import_batch",
    entityId: batch.id,
    summary: `دفعة استيراد ${opts.importType} — ${opts.rows.length} صفاً من ${opts.sourceFileName}`,
  });
  return batch;
}

export async function getBatchWithRows(batchId: string) {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch) return null;
  const rows = await db
    .select()
    .from(importRows)
    .where(eq(importRows.batchId, batchId))
    .orderBy(asc(importRows.rowIndex));
  return { batch, rows };
}

export async function updateRowCorrection(rowId: string, corrections: Record<string, unknown>, newStatus?: string) {
  const [row] = await db.select().from(importRows).where(eq(importRows.id, rowId));
  if (!row) throw new Error("الصف غير موجود");
  const mapped = { ...(row.mapped as Record<string, unknown>), ...corrections };
  await db
    .update(importRows)
    .set({ mapped, corrections, status: (newStatus as string) ?? row.status })
    .where(eq(importRows.id, rowId));
}

/**
 * قرارات المدير على صفوف المعاينة — كل قرار يحفظ لقطة الحالة السابقة كاملة
 * (الحالة + القيم + التصحيحات) في سجل الصف، فيصبح «تراجع عن آخر قرار» استعادة تامة.
 */
export type RowDecisionEntry = {
  at: string;
  action: string; // «تأكيد كجاهز» | «تصحيح» | «استبعاد» | «تأجيل» | «إعادة إلى المراجعة»
  by: string;
  from: { status: string; mapped: unknown; corrections: unknown };
  to: { status: string };
  /** التحذيرات التي كانت نشطة لحظة القرار — تبقى هنا للسجل بعد اختفائها من العرض */
  resolvedWarnings?: string[];
};

const DECISION_STATUS: Record<string, string> = {
  "تأكيد كجاهز": "جاهز",
  "تصحيح": "جاهز",
  "استبعاد": "مستبعد",
  "تأجيل": "مؤجل",
  "إعادة إلى المراجعة": "يحتاج مراجعة",
};

export async function applyRowDecision(opts: {
  rowId: string;
  action: string;
  corrections?: Record<string, unknown>;
  actorId: string;
  actorName: string;
}) {
  const newStatus = DECISION_STATUS[opts.action];
  if (!newStatus) throw new Error("قرار غير معروف");
  const [row] = await db.select().from(importRows).where(eq(importRows.id, opts.rowId));
  if (!row) throw new Error("الصف غير موجود");
  if (row.status === "منفذ") throw new Error("لا يمكن تعديل صف منفذ");
  if (row.status === newStatus && !opts.corrections) return row;

  const warnings = (row.validation as { warnings?: string[] } | null)?.warnings ?? [];
  const entry: RowDecisionEntry = {
    at: new Date().toISOString(),
    action: opts.action,
    by: opts.actorName,
    from: { status: row.status, mapped: row.mapped, corrections: row.corrections },
    to: { status: newStatus },
    ...(row.status === "يحتاج مراجعة" && warnings.length > 0 ? { resolvedWarnings: warnings } : {}),
  };
  const history = [...((row.decisionHistory as RowDecisionEntry[] | null) ?? []), entry];
  const mapped = opts.corrections
    ? { ...(row.mapped as Record<string, unknown>), ...opts.corrections }
    : row.mapped;

  const [updated] = await db
    .update(importRows)
    .set({
      mapped,
      corrections: opts.corrections ?? row.corrections,
      status: newStatus,
      decisionHistory: history,
    })
    .where(eq(importRows.id, opts.rowId))
    .returning();
  await audit({
    actorId: opts.actorId,
    action: "import.row_decision",
    entityType: "import_row",
    entityId: opts.rowId,
    summary: `قرار «${opts.action}» على الصف ${row.rowIndex} — ${row.status} ← ${newStatus}`,
    // قبل/بعد كاملة في السجل غير القابل للتعديل — التراجع لاحقاً لا يمس هذا القيد
    detail: {
      decision: opts.action,
      rowIndex: row.rowIndex,
      before: { status: row.status, mapped: row.mapped, corrections: row.corrections },
      after: { status: newStatus, mapped, corrections: opts.corrections ?? row.corrections },
      ...(entry.resolvedWarnings ? { resolvedWarnings: entry.resolvedWarnings } : {}),
    },
  });
  return updated;
}

/** يتراجع عن آخر قرار مسجل: يستعيد الحالة والقيم والتصحيحات السابقة ويزيل القيد من سجل الصف. */
export async function undoLastRowDecision(opts: { rowId: string; actorId: string; actorName: string }) {
  const [row] = await db.select().from(importRows).where(eq(importRows.id, opts.rowId));
  if (!row) throw new Error("الصف غير موجود");
  if (row.status === "منفذ") throw new Error("لا يمكن تعديل صف منفذ");
  const history = ((row.decisionHistory as RowDecisionEntry[] | null) ?? []).slice();
  const last = history.pop();
  if (!last) throw new Error("لا يوجد قرار مسجل للتراجع عنه");

  const [updated] = await db
    .update(importRows)
    .set({
      status: last.from.status,
      mapped: last.from.mapped as object,
      corrections: last.from.corrections as object,
      decisionHistory: history,
    })
    .where(eq(importRows.id, opts.rowId))
    .returning();
  await audit({
    actorId: opts.actorId,
    action: "import.row_decision_undone",
    entityType: "import_row",
    entityId: opts.rowId,
    summary: `تراجع عن قرار «${last.action}» على الصف ${row.rowIndex} — عادت الحالة إلى «${last.from.status}»`,
    // التراجع حدث جديد يُلحق بالسجل ولا يحذف أحداثه — قبل/بعد كاملة هنا أيضاً
    detail: {
      undoneDecision: last.action,
      rowIndex: row.rowIndex,
      before: { status: row.status, mapped: row.mapped, corrections: row.corrections },
      after: { status: last.from.status, mapped: last.from.mapped, corrections: last.from.corrections },
    },
  });
  return updated;
}

/**
 * منفذو الاستيراد حسب النوع — يسجلون داخل معاملة واحدة ويعيدون ما أنشئ.
 * tx: drizzle transaction. rows: الصفوف الجاهزة فقط.
 */
export type CommitResult = { createdSummary: Record<string, number> };

export async function commitBatch(
  batchId: string,
  actorId: string,
  committer: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], rows: { id: string; mapped: Record<string, unknown> }[]) => Promise<CommitResult>,
) {
  // فحوص مسبقة لرسائل ودية فقط — الادعاء الذري داخل المعاملة هو الحكم النهائي
  const data = await getBatchWithRows(batchId);
  if (!data) throw new Error("الدفعة غير موجودة");
  if (data.batch.status === "منفذة") throw new Error("الدفعة منفذة مسبقاً");
  if (data.batch.status === "متراجع عنها" || data.batch.status === "ملغاة") {
    throw new Error("لا يمكن تنفيذ دفعة ملغاة أو متراجع عنها");
  }
  const ready = data.rows.filter((r) => r.status === "جاهز");
  if (ready.length === 0) throw new Error("لا توجد صفوف جاهزة للتنفيذ");
  const pendingReview = data.rows.filter((r) => r.status === "يحتاج مراجعة");
  if (pendingReview.length > 0) {
    throw new Error(`لا يمكن التنفيذ: ${pendingReview.length} صفاً ما زال يحتاج مراجعة — صحح الصفوف أو استبعدها أولاً`);
  }
  const deferred = data.rows.filter((r) => r.status === "مؤجل");
  if (deferred.length > 0) {
    throw new Error(`لا يمكن التنفيذ: ${deferred.length} صفاً مؤجل — احسم الصفوف المؤجلة (تأكيد/تصحيح/استبعاد) أولاً`);
  }

  const result = await db.transaction(async (tx) => {
    // ادعاء ذري للدفعة أولاً: يمنع التنفيذ المزدوج من نافذتين متزامنتين (TOCTOU)
    const claimed = await tx
      .update(importBatches)
      .set({ status: "منفذة", committedAt: new Date(), committedBy: actorId })
      .where(and(eq(importBatches.id, batchId), eq(importBatches.status, "معاينة")))
      .returning();
    if (claimed.length === 0) {
      throw new Error("الدفعة ليست في حالة معاينة — ربما نفذت من نافذة أخرى");
    }
    const res = await committer(
      tx,
      ready.map((r) => ({ id: r.id, mapped: r.mapped as Record<string, unknown> })),
    );
    // الملخص النهائي يكتب في نهاية المعاملة بعد اكتمال التنفيذ
    await tx
      .update(importBatches)
      .set({ summary: res.createdSummary })
      .where(eq(importBatches.id, batchId));
    return res;
  });

  await audit({
    actorId,
    action: "import.batch_committed",
    entityType: "import_batch",
    entityId: batchId,
    summary: `تنفيذ دفعة الاستيراد`,
    detail: result.createdSummary,
  });
  return result;
}

/**
 * تراجع كامل عن دفعة — يتحقق المنفذ من الأمان (عدم وجود سجلات مرتبطة) ثم يحذف داخل معاملة.
 */
export async function rollbackBatch(
  batchId: string,
  actorId: string,
  rollbacker: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
) {
  // فحص مسبق لرسالة ودية فقط — الادعاء الذري داخل المعاملة هو الحكم النهائي
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch) throw new Error("الدفعة غير موجودة");
  if (batch.status !== "منفذة") throw new Error("التراجع ممكن فقط عن دفعة منفذة");

  await db.transaction(async (tx) => {
    // ادعاء ذري: يمنع التراجع المزدوج من نافذتين متزامنتين
    const claimed = await tx
      .update(importBatches)
      .set({ status: "متراجع عنها", rolledBackAt: new Date() })
      .where(and(eq(importBatches.id, batchId), eq(importBatches.status, "منفذة")))
      .returning();
    if (claimed.length === 0) {
      throw new Error("الدفعة ليست في حالة منفذة — ربما تُرجع عنها من نافذة أخرى");
    }
    await rollbacker(tx);
  });

  await audit({
    actorId,
    action: "import.batch_rolled_back",
    entityType: "import_batch",
    entityId: batchId,
    summary: "تراجع كامل عن دفعة استيراد",
  });
}

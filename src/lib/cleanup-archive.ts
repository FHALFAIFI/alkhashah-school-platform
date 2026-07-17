import "server-only";
import { inArray, eq, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  archiveBatches,
  archivedRecords,
  auditLog,
  people,
  programs,
  planYears,
  programMilestones,
  programDeliverables,
  programKpis,
  programRisks,
  planBudgetItems,
  programRoadmapCells,
  programFollowups,
  programChangeRequests,
  committees,
  meetings,
  meetingOutcomes,
  perfCycles,
  perfSessions,
  actionTasks,
  documents,
  evidenceItems,
  maintenanceIssues,
} from "@/db/schema";
import {
  classifySynthetic,
  SYNTHETIC_ENTITY_ORDER,
  type SyntheticCandidate,
  type SyntheticClassification,
  type SyntheticEntityType,
} from "./synthetic";

/**
 * سير عمل تنظيف آمن للسجلات الاصطناعية: معاينة → تأكيد عربي صريح → أرشفة معاملاتية →
 * حدث تدقيق غير قابل للتعديل → تراجع/استرجاع كامل. الأرشفة **غير متلفة**: لا يُحذف أي صف؛
 * تُلتقط لقطة كاملة لكل سجل مؤرشف ويُخفى عبر المرشّح المركزي (getExcludedIdSets). الاسترجاع
 * يعيد الإظهار فوراً بلا فقد بيان. السجلات المشتبَه بها بالاسم وحده لا تؤرشَف إلا باختيار يدوي.
 */

/** النص الذي يجب أن يكتبه المدير حرفياً قبل تنفيذ الأرشفة */
export const ARCHIVE_CONFIRMATION_PHRASE = "أرشفة السجلات التجريبية";

/** جدول ومعرّف كل نوع كيان — أساس التقاط اللقطات */
type SnapEntry = { type: SyntheticEntityType; table: PgTable; idCol: AnyColumn };
const SNAP: SnapEntry[] = [
  { type: "plan_year", table: planYears, idCol: planYears.id },
  { type: "program", table: programs, idCol: programs.id },
  { type: "milestone", table: programMilestones, idCol: programMilestones.id },
  { type: "deliverable", table: programDeliverables, idCol: programDeliverables.id },
  { type: "kpi", table: programKpis, idCol: programKpis.id },
  { type: "risk", table: programRisks, idCol: programRisks.id },
  { type: "budget", table: planBudgetItems, idCol: planBudgetItems.id },
  { type: "roadmap_cell", table: programRoadmapCells, idCol: programRoadmapCells.id },
  { type: "followup", table: programFollowups, idCol: programFollowups.id },
  { type: "change_request", table: programChangeRequests, idCol: programChangeRequests.id },
  { type: "person", table: people, idCol: people.id },
  { type: "committee", table: committees, idCol: committees.id },
  { type: "meeting", table: meetings, idCol: meetings.id },
  { type: "outcome", table: meetingOutcomes, idCol: meetingOutcomes.id },
  { type: "perf_cycle", table: perfCycles, idCol: perfCycles.id },
  { type: "perf_session", table: perfSessions, idCol: perfSessions.id },
  { type: "task", table: actionTasks, idCol: actionTasks.id },
  { type: "document", table: documents, idCol: documents.id },
  { type: "evidence", table: evidenceItems, idCol: evidenceItems.id },
  { type: "maintenance", table: maintenanceIssues, idCol: maintenanceIssues.id },
];
const SNAP_BY_TYPE = new Map(SNAP.map((s) => [s.type, s]));

export type CleanupPreview = {
  candidates: SyntheticCandidate[];
  counts: Record<SyntheticEntityType, number>;
  nameOnlySuspects: SyntheticCandidate[];
  totalCandidates: number;
};

/** معاينة للقراءة فقط — تصنيف بنيوي دون أي تعديل */
export async function previewCleanup(): Promise<CleanupPreview> {
  const c = await classifySynthetic();
  return {
    candidates: c.candidates,
    counts: c.counts,
    nameOnlySuspects: c.nameOnlySuspects,
    totalCandidates: c.candidates.length,
  };
}

export type ArchiveResult = {
  batchId: string;
  counts: Record<string, number>;
  totalArchived: number;
};

/** مرجع لسجل مختار يدوياً (من دلو «الاسم وحده») لإضافته صراحةً للأرشفة */
export type ManualSelection = { entityType: SyntheticEntityType; id: string };

/**
 * ينفّذ الأرشفة داخل معاملة واحدة: التقاط لقطات + دفعة أرشفة + حدث تدقيق. غير متلف.
 * يرفض التنفيذ إن لم يطابق نص التأكيد العبارة المطلوبة. لا يشمل السجلات المشتبَه بها
 * بالاسم وحده إلا ما اختاره المدير يدوياً عبر manualSelections.
 */
export async function archiveSynthetic(opts: {
  actorId: string;
  reason: string;
  confirmationText: string;
  manualSelections?: ManualSelection[];
  ip?: string | null;
}): Promise<ArchiveResult> {
  if (opts.confirmationText.trim() !== ARCHIVE_CONFIRMATION_PHRASE) {
    throw new Error("نص التأكيد غير مطابق — الأرشفة مرفوضة");
  }
  if (!opts.reason || opts.reason.trim().length < 3) {
    throw new Error("سبب الأرشفة إلزامي");
  }

  const c = await classifySynthetic();

  // مرشحون بنيويون + اختيار يدوي من دلو الاسم-وحده (بعد التحقق أنه فعلاً ضمن المشتبَه بهم)
  const selected: SyntheticCandidate[] = [...c.candidates];
  if (opts.manualSelections?.length) {
    const suspectKey = new Set(c.nameOnlySuspects.map((s) => `${s.entityType}:${s.id}`));
    for (const m of opts.manualSelections) {
      const key = `${m.entityType}:${m.id}`;
      if (!suspectKey.has(key)) throw new Error("اختيار يدوي غير صالح — ليس ضمن قائمة الاسم-وحده");
      const suspect = c.nameOnlySuspects.find((s) => s.entityType === m.entityType && s.id === m.id)!;
      selected.push(suspect);
    }
  }

  if (selected.length === 0) {
    throw new Error("لا سجلات مرشّحة للأرشفة");
  }

  // تجميع المعرفات والأسباب حسب النوع
  const idsByType = new Map<SyntheticEntityType, string[]>();
  const reasonById = new Map<string, string>();
  for (const cand of selected) {
    const arr = idsByType.get(cand.entityType) ?? [];
    arr.push(cand.id);
    idsByType.set(cand.entityType, arr);
    reasonById.set(`${cand.entityType}:${cand.id}`, cand.reason);
  }

  const counts: Record<string, number> = {};
  for (const [type, ids] of idsByType) counts[type] = ids.length;
  const totalArchived = selected.length;

  const batchId = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(archiveBatches)
      .values({
        reason: opts.reason.trim(),
        confirmationText: opts.confirmationText.trim(),
        status: "مؤرشف",
        counts,
        actorId: opts.actorId,
      })
      .returning({ id: archiveBatches.id });

    // التقاط لقطة كاملة لكل سجل بالترتيب المعتمد
    for (const type of SYNTHETIC_ENTITY_ORDER) {
      const ids = idsByType.get(type);
      if (!ids || ids.length === 0) continue;
      const snap = SNAP_BY_TYPE.get(type);
      if (!snap) continue;
      const rows = await tx.select().from(snap.table).where(inArray(snap.idCol, ids));
      if (rows.length === 0) continue;
      await tx.insert(archivedRecords).values(
        rows.map((r) => ({
          batchId: batch.id,
          entityType: type,
          entityId: (r as { id: string }).id,
          reason: reasonById.get(`${type}:${(r as { id: string }).id}`) ?? null,
          snapshot: r as object,
        })),
      );
    }

    // حدث تدقيق ضمن المعاملة نفسها (append-only)
    await tx.insert(auditLog).values({
      actorId: opts.actorId,
      action: "cleanup.archive",
      entityType: "archive_batch",
      entityId: batch.id,
      summary: `أرشفة ${totalArchived} سجلاً اصطناعياً`,
      detail: { counts, reason: opts.reason.trim() },
      ip: opts.ip ?? undefined,
    });

    return batch.id;
  });

  return { batchId, counts, totalArchived };
}

/**
 * استرجاع (تراجع) دفعة أرشفة كاملة داخل معاملة: يعيد الحالة إلى «مُسترجع» فتعود السجلات
 * للظهور فوراً (لم تُحذف أصلاً)، مع حدث تدقيق. لا يفقد أي بيان.
 */
export async function unarchiveBatch(opts: {
  batchId: string;
  actorId: string;
  ip?: string | null;
}): Promise<{ restored: number }> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(archiveBatches).where(eq(archiveBatches.id, opts.batchId));
    if (!batch) throw new Error("دفعة الأرشفة غير موجودة");
    if (batch.status !== "مؤرشف") throw new Error("الدفعة ليست في حالة «مؤرشف»");

    const recs = await tx
      .select({ id: archivedRecords.id })
      .from(archivedRecords)
      .where(eq(archivedRecords.batchId, opts.batchId));
    const n = recs.length;

    await tx
      .update(archiveBatches)
      .set({ status: "مُسترجع", unarchivedAt: new Date(), unarchivedBy: opts.actorId })
      .where(eq(archiveBatches.id, opts.batchId));

    await tx.insert(auditLog).values({
      actorId: opts.actorId,
      action: "cleanup.unarchive",
      entityType: "archive_batch",
      entityId: opts.batchId,
      summary: `استرجاع دفعة أرشفة (${n} سجلاً)`,
      detail: { counts: batch.counts },
      ip: opts.ip ?? undefined,
    });

    return { restored: n };
  });
}

/** قائمة دفعات الأرشفة السابقة (للعرض) */
export async function listArchiveBatches() {
  return db.select().from(archiveBatches).orderBy(archiveBatches.createdAt);
}

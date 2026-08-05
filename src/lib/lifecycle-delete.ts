import "server-only";
import { and, count, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  people,
  users,
  userRoles,
  roles,
  rolePermissions,
  permissions as permissionsTable,
  sessions as authSessions,
  personStages,
  perfCycles,
  perfModels,
  perfIndicators,
  perfSessions,
  perfRatings,
  perfSignedReportVersions,
  improvementPlans,
  committeeMembers,
  programs,
  programActivities,
  actionTasks,
  maintenanceIssues,
  inspectionFindings,
  budgetExpenses,
  documents,
  evidenceItems,
  evidenceLinks,
  evidenceVersions,
  storedFiles,
  recordVersions,
  auditLog,
  deletionTombstones,
  notifications,
  meetingAttachments,
  meetings,
  committees,
  committeeImpacts,
  floorBackgrounds,
  importBatches,
  feedback,
  inspections,
} from "@/db/schema";
import { storage } from "@/lib/storage";
import { orFallback } from "@/lib/format";

/**
 * الحذف النهائي لدورة الحياة (v2.4.1 §1.3).
 *
 * ── لماذا وحدة مستقلة عن `safe-delete` ──────────────────────────────────────
 * `lib/safe-delete.ts` يجيب سؤالاً واحداً: «هل هذا السجل غير مستخدم فيجوز حذفه؟» وهو
 * الحارس الصحيح للحذف العابر. المطلوب هنا مختلف تماماً: حذف **مقصود** لسجل مستخدَم مع
 * كامل دورة حياته، بقرار صريح من صاحب صلاحية، مع الحفاظ على كل سجل مؤسسي مشترك.
 * خلط السلوكين في وحدة واحدة يجعل حارس الحذف العابر قابلاً للتحايل، فبقيا منفصلين.
 *
 * ── خريطة القرار (مبنية على مفاتيح القاعدة الفعلية لا على التخمين) ───────────
 * مملوك للموظف → يُحذف:
 *   perf_cycles ← perf_sessions ← perf_ratings / perf_signed_report_versions
 *   improvement_plans · person_stages
 *   documents الصادرة عن دوراته وجلساته وعنه هو
 *   record_versions لتلك الجلسات والدورات
 *   evidence_links لتلك السجلات، و evidence_items التي لم يبق لها أي رابط آخر
 *   stored_files التي لم يبق لها أي مرجع في القاعدة كلها (12 عموداً + مصفوفتا صور)
 *
 * مؤسسي مشترك → يبقى وتُفكّ الصلة فقط:
 *   committees (يُحذف صف العضوية وحده؛ committee_task_assignments.assigned_member_id
 *               يصير NULL بحكم المفتاح الأجنبي فتبقى المهمة قائمة بلا مكلَّف)
 *   programs.owner_person_id · program_activities.owner_person_id
 *   action_tasks.owner_person_id · maintenance_issues.owner_person_id
 *   inspection_findings.responsible_person_id · budget_expenses.responsible_person_id
 *
 * يبقى كما هو:
 *   audit_log (سجل إلحاقي — لا يُمسّ)، import_rows (تاريخ الدفعة)،
 *   record_versions لكيانات مشتركة (لجنة/برنامج/اجتماع)
 *
 * حساب الدخول المرتبط **لا يُحذف**: `audit_log.actor_id` و`documents.issued_by` وعشرات
 * الأعمدة الأخرى تشير إليه بمفاتيح `NO ACTION`، وحذفه إما يفشل أو يفرض إتلاف سجل التدقيق.
 * البديل المعتمد: تعطيله وفكّ ارتباطه بالمنسوب وإنهاء جلساته — فلا يبقى مسار دخول.
 */

export type ImpactLine = { type: string; labelAr: string; count: number };

export type DeletionImpact = {
  entity: "person" | "perf_cycle" | "perf_model";
  entityId: string;
  /** مرجع تعريفي آمن يُعرض في المعاينة ويُحفظ في الشاهد */
  displayRef: string;
  /** الاسم الذي يجب على المستخدم كتابته حرفياً للتأكيد */
  confirmName: string;
  /** سجلات تُحذف نهائياً */
  owned: ImpactLine[];
  /** سجلات مؤسسية مشتركة تبقى وتُفكّ صلتها */
  shared: ImpactLine[];
  /** موانع مطلقة — وجود أي منها يمنع التنفيذ */
  blockers: string[];
};

export type DeleteResult = { error?: string; success?: string };

/** أدنى طول لسبب الحذف — سبب من حرفين ليس سبباً */
export const DELETE_REASON_MIN = 5;

/* ────────────────────────── أدوات مشتركة ────────────────────────── */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* عدّاد عام يقبل أي جدول — نفس نمط `lib/safe-delete.ts` */

async function countRows(table: any, where: any): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table).where(where);
  return Number(row?.c ?? 0);
}


async function countRowsTx(tx: Tx, table: any, where: any): Promise<number> {
  const [row] = await tx.select({ c: count() }).from(table).where(where);
  return Number(row?.c ?? 0);
}

/** يوحّد أعداد الأنواع في خريطة واحدة تُحفظ في الشاهد */
function countsMap(lines: ImpactLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) if (l.count > 0) out[l.type] = l.count;
  return out;
}

/** مرجع تعريفي آمن — الاسم والرقم الوظيفي فقط، بلا أي محتوى تقييمي */
function personDisplayRef(p: { fullName: string; jobNumber: string | null; category: string }): string {
  const parts = [orFallback(p.fullName, "بدون اسم"), p.jobNumber ? `الرقم الوظيفي ${p.jobNumber}` : null, p.category];
  return parts.filter(Boolean).join(" — ");
}

/**
 * الأعمدة التي قد تشير إلى ملف مخزَّن. مستخرجة من مفاتيح القاعدة الفعلية:
 * 12 مفتاحاً أجنبياً + مصفوفتَي صور (`inspections.photos` و`maintenance_issues.photos`)
 * تحفظان معرّفات الملفات نصاً بلا مفتاح أجنبي. أي ملف يشير إليه أيٌّ منها لا يُحذف.
 */
async function fileStillReferenced(tx: Tx, fileId: string): Promise<boolean> {
  const checks: Promise<number>[] = [
    countRowsTx(tx, evidenceItems, eq(evidenceItems.fileId, fileId)),
    countRowsTx(tx, evidenceVersions, eq(evidenceVersions.fileId, fileId)),
    countRowsTx(tx, documents, eq(documents.pdfFileId, fileId)),
    countRowsTx(tx, perfSessions, eq(perfSessions.signedReportFileId, fileId)),
    countRowsTx(tx, perfSignedReportVersions, eq(perfSignedReportVersions.fileId, fileId)),
    countRowsTx(tx, meetingAttachments, eq(meetingAttachments.fileId, fileId)),
    countRowsTx(tx, meetings, eq(meetings.signedMinutesFileId, fileId)),
    countRowsTx(tx, committees, eq(committees.signedAssignmentFileId, fileId)),
    countRowsTx(tx, committeeImpacts, eq(committeeImpacts.evidenceFileId, fileId)),
    countRowsTx(tx, floorBackgrounds, eq(floorBackgrounds.fileId, fileId)),
    countRowsTx(tx, importBatches, eq(importBatches.sourceFileId, fileId)),
    countRowsTx(tx, feedback, eq(feedback.attachmentFileId, fileId)),
    // مصفوفتا الصور تحفظان المعرّفات نصاً بلا مفتاح أجنبي — يلزمهما فحص jsonb صريح
    countRowsTx(tx, inspections, sql`${inspections.photos} @> ${JSON.stringify([fileId])}::jsonb`),
    countRowsTx(tx, maintenanceIssues, sql`${maintenanceIssues.photos} @> ${JSON.stringify([fileId])}::jsonb`),
  ];
  const results = await Promise.all(checks);
  return results.some((c) => c > 0);
}

/**
 * يحذف صفوف الملفات التي لم يبق لها أي مرجع، ويعيد مساراتها لحذفها من القرص **بعد**
 * نجاح المعاملة. حذف الملف من القرص لا يمكن التراجع عنه، فلا يقع داخل المعاملة أبداً.
 */
async function deleteOrphanFiles(tx: Tx, fileIds: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const fileId of [...new Set(fileIds)]) {
    if (await fileStillReferenced(tx, fileId)) continue;
    const [f] = await tx.select({ path: storedFiles.storagePath }).from(storedFiles).where(eq(storedFiles.id, fileId));
    if (!f) continue;
    await tx.delete(storedFiles).where(eq(storedFiles.id, fileId));
    paths.push(f.path);
  }
  return paths;
}

/** حذف الملفات من القرص بعد الالتزام — الفشل يُسجَّل ولا يُسقط العملية المُلتزمة */
async function purgeFiles(paths: string[]): Promise<number> {
  let removed = 0;
  for (const p of paths) {
    try {
      await storage.delete(p);
      removed += 1;
    } catch {
      // الملف مفقود أصلاً أو تعذّر حذفه — الصف حُذف من القاعدة والعملية التزمت بالفعل
    }
  }
  return removed;
}

/**
 * شواهد لم يبق لها أي رابط بعد فكّ روابط السجلات المحذوفة — أي شواهد خاصة بالموظف
 * حصراً. الشاهد المرتبط بأي سجل آخر (برنامج، لجنة، غرفة…) سجل مؤسسي مشترك ويبقى.
 */
async function deleteOrphanEvidence(tx: Tx, evidenceIds: string[]): Promise<{ deleted: number; fileIds: string[] }> {
  const fileIds: string[] = [];
  let deleted = 0;
  for (const id of [...new Set(evidenceIds)]) {
    const [row] = await tx.select({ c: count() }).from(evidenceLinks).where(eq(evidenceLinks.evidenceId, id));
    if (Number(row?.c ?? 0) > 0) continue;
    const [item] = await tx.select({ fileId: evidenceItems.fileId }).from(evidenceItems).where(eq(evidenceItems.id, id));
    if (!item) continue;
    // نسخ الشاهد تُحذف تعاقبياً بحكم المفتاح الأجنبي — نلتقط ملفاتها أولاً
    const versions = await tx
      .select({ fileId: evidenceVersions.fileId })
      .from(evidenceVersions)
      .where(eq(evidenceVersions.evidenceId, id));
    for (const v of versions) if (v.fileId) fileIds.push(v.fileId);
    if (item.fileId) fileIds.push(item.fileId);
    await tx.delete(evidenceItems).where(eq(evidenceItems.id, id));
    deleted += 1;
  }
  return { deleted, fileIds };
}

/* ────────────── معاينة أثر حذف دورة أداء ────────────── */

type CycleScope = {
  cycleIds: string[];
  sessionIds: string[];
  ratingCount: number;
  signedVersionCount: number;
  planCount: number;
  documentIds: string[];
  evidenceLinkCount: number;
  recordVersionCount: number;
};

async function collectCycleScope(cycleIds: string[]): Promise<CycleScope> {
  if (cycleIds.length === 0) {
    return { cycleIds: [], sessionIds: [], ratingCount: 0, signedVersionCount: 0, planCount: 0, documentIds: [], evidenceLinkCount: 0, recordVersionCount: 0 };
  }
  const sessionRows = await db.select({ id: perfSessions.id }).from(perfSessions).where(inArray(perfSessions.cycleId, cycleIds));
  const sessionIds = sessionRows.map((s) => s.id);

  const [ratingCount, signedVersionCount, planCount] = await Promise.all([
    sessionIds.length ? countRows(perfRatings, inArray(perfRatings.sessionId, sessionIds)) : 0,
    sessionIds.length ? countRows(perfSignedReportVersions, inArray(perfSignedReportVersions.sessionId, sessionIds)) : 0,
    countRows(improvementPlans, inArray(improvementPlans.cycleId, cycleIds)),
  ]);

  const docRows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      or(
        and(eq(documents.entityType, "perf_cycle"), inArray(documents.entityId, cycleIds)),
        sessionIds.length > 0
          ? and(eq(documents.entityType, "perf_session"), inArray(documents.entityId, sessionIds))
          : undefined,
      ),
    );

  const evidenceLinkCount = sessionIds.length
    ? await countRows(evidenceLinks, and(inArray(evidenceLinks.entityType, ["perf_session", "perf_rating"]), inArray(evidenceLinks.entityId, sessionIds)))
    : 0;
  const recordVersionCount = sessionIds.length
    ? await countRows(recordVersions, and(inArray(recordVersions.entityType, ["perf_session", "perf_cycle"]), inArray(recordVersions.entityId, [...sessionIds, ...cycleIds])))
    : await countRows(recordVersions, and(eq(recordVersions.entityType, "perf_cycle"), inArray(recordVersions.entityId, cycleIds)));

  return {
    cycleIds,
    sessionIds,
    ratingCount,
    signedVersionCount,
    planCount,
    documentIds: docRows.map((d) => d.id),
    evidenceLinkCount,
    recordVersionCount,
  };
}

function cycleOwnedLines(scope: CycleScope): ImpactLine[] {
  return [
    { type: "perf_cycles", labelAr: "دورات أداء", count: scope.cycleIds.length },
    { type: "perf_sessions", labelAr: "جلسات تقييم", count: scope.sessionIds.length },
    { type: "perf_ratings", labelAr: "تقديرات معايير", count: scope.ratingCount },
    { type: "perf_signed_report_versions", labelAr: "نسخ تقارير موقعة", count: scope.signedVersionCount },
    { type: "improvement_plans", labelAr: "خطط تحسين", count: scope.planCount },
    { type: "documents", labelAr: "وثائق أداء صادرة", count: scope.documentIds.length },
    { type: "evidence_links", labelAr: "روابط شواهد أداء", count: scope.evidenceLinkCount },
    { type: "record_versions", labelAr: "نسخ سجلات الأداء", count: scope.recordVersionCount },
  ];
}

/**
 * معاينة أثر حذف دورة أداء واحدة — الموظف ودوراته الأخرى لا تُمسّ.
 */
export async function assessCycleDeletion(cycleId: string): Promise<DeletionImpact | null> {
  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, cycleId));
  if (!cycle) return null;
  const [person] = await db.select().from(people).where(eq(people.id, cycle.personId));
  const scope = await collectCycleScope([cycleId]);
  const otherCycles = await countRows(
    perfCycles,
    and(eq(perfCycles.personId, cycle.personId), ne(perfCycles.id, cycleId)),
  );
  const displayRef = `دورة ${cycle.yearKey} — ${orFallback(person?.fullName, "منسوب محذوف")} (${cycle.cycleType})`;
  return {
    entity: "perf_cycle",
    entityId: cycleId,
    displayRef,
    // التأكيد الكتابي لدورة الأداء = سنة الدورة (قيمة قصيرة لا لبس فيها)
    confirmName: cycle.yearKey,
    owned: cycleOwnedLines(scope).filter((l) => l.count > 0),
    shared: [
      { type: "person", labelAr: "سجل المنسوب (يبقى)", count: person ? 1 : 0 },
      { type: "other_cycles", labelAr: "دورات أداء أخرى للمنسوب (تبقى)", count: otherCycles },
    ].filter((l) => l.count > 0),
    blockers: [],
  };
}

/* ────────────── معاينة أثر حذف منسوب ────────────── */

/**
 * هل هذا الحساب آخر حساب فعّال يملك صلاحية إدارة المستخدمين؟
 * تعطيله يترك المنصة بلا مالك قادر على استعادة الصلاحيات.
 */
async function isLastPrivilegedAccount(userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(permissionsTable.key, "admin.users"), eq(users.active, true)));
  const privileged = new Set(rows.map((r) => r.userId));
  return privileged.has(userId) && privileged.size <= 1;
}

export async function assessPersonDeletion(
  personId: string,
  opts?: { actorUserId?: string },
): Promise<DeletionImpact | null> {
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) return null;

  const cycleRows = await db.select({ id: perfCycles.id }).from(perfCycles).where(eq(perfCycles.personId, personId));
  const scope = await collectCycleScope(cycleRows.map((c) => c.id));

  const [stages, personDocs, personLinks, linkedAccounts, memberships, ownedPrograms, ownedActivities, ownedTasks, ownedIssues, findingRefs, expenseRefs] =
    await Promise.all([
      countRows(personStages, eq(personStages.personId, personId)),
      countRows(documents, and(eq(documents.entityType, "person"), eq(documents.entityId, personId))),
      countRows(evidenceLinks, and(eq(evidenceLinks.entityType, "person"), eq(evidenceLinks.entityId, personId))),
      db.select({ id: users.id, username: users.username, active: users.active }).from(users).where(eq(users.personId, personId)),
      countRows(committeeMembers, eq(committeeMembers.personId, personId)),
      countRows(programs, eq(programs.ownerPersonId, personId)),
      countRows(programActivities, eq(programActivities.ownerPersonId, personId)),
      countRows(actionTasks, eq(actionTasks.ownerPersonId, personId)),
      countRows(maintenanceIssues, eq(maintenanceIssues.ownerPersonId, personId)),
      countRows(inspectionFindings, eq(inspectionFindings.responsiblePersonId, personId)),
      countRows(budgetExpenses, eq(budgetExpenses.responsiblePersonId, personId)),
    ]);

  const blockers: string[] = [];
  for (const acc of linkedAccounts) {
    if (opts?.actorUserId && acc.id === opts.actorUserId) {
      blockers.push("لا يمكن حذف المنسوب المرتبط بحسابك الحالي — سجّل الدخول بحساب آخر مخوَّل.");
    }
    if (await isLastPrivilegedAccount(acc.id)) {
      blockers.push(`الحساب «${acc.username}» هو آخر حساب فعّال يملك صلاحية إدارة المستخدمين — عيّن حساباً مخوَّلاً آخر قبل الحذف.`);
    }
  }

  const owned: ImpactLine[] = [
    { type: "person", labelAr: "سجل المنسوب", count: 1 },
    ...cycleOwnedLines(scope),
    { type: "person_stages", labelAr: "مراحل تدريس مسندة", count: stages },
    { type: "person_documents", labelAr: "وثائق صادرة عن المنسوب", count: personDocs },
    { type: "person_evidence_links", labelAr: "روابط شواهد بالمنسوب", count: personLinks },
  ];

  const shared: ImpactLine[] = [
    { type: "committee_members", labelAr: "عضويات لجان (تُفكّ — اللجان تبقى)", count: memberships },
    { type: "programs", labelAr: "برامج يملكها (تبقى بلا مسؤول)", count: ownedPrograms },
    { type: "program_activities", labelAr: "أنشطة يملكها (تبقى بلا مسؤول)", count: ownedActivities },
    { type: "action_tasks", labelAr: "مهام مسندة (تبقى بلا مكلَّف)", count: ownedTasks },
    { type: "maintenance_issues", labelAr: "بلاغات صيانة مسندة (تبقى بلا مكلَّف)", count: ownedIssues },
    { type: "inspection_findings", labelAr: "ملاحظات فحص مسندة (تبقى بلا مسؤول)", count: findingRefs },
    { type: "budget_expenses", labelAr: "مصروفات مسجَّلة باسمه (تبقى بلا مسؤول)", count: expenseRefs },
    { type: "users", labelAr: "حسابات دخول (تُعطَّل وتُفكّ صلتها — لا تُحذف)", count: linkedAccounts.length },
  ];

  return {
    entity: "person",
    entityId: personId,
    displayRef: personDisplayRef(person),
    confirmName: person.fullName,
    owned: owned.filter((l) => l.count > 0),
    shared: shared.filter((l) => l.count > 0),
    blockers,
  };
}

/* ────────────── التنفيذ: حذف دورة الأداء ────────────── */

/**
 * يحذف دورة أداء واحدة بكامل دورة حياتها داخل معاملة واحدة.
 * يُستدعى أيضاً من حذف المنسوب لكل دوراته — نواة واحدة لا نسختان.
 */
async function deleteCyclesWithin(tx: Tx, scope: CycleScope): Promise<string[]> {
  const orphanFileIds: string[] = [];
  const { cycleIds, sessionIds, documentIds } = scope;
  if (cycleIds.length === 0) return orphanFileIds;

  // 1) روابط الشواهد أولاً — نلتقط معرّفات الشواهد قبل فكّ الروابط لنعرف أيها صار يتيماً
  const entityIds = [...sessionIds, ...cycleIds];
  let touchedEvidence: string[] = [];
  if (entityIds.length > 0) {
    const links = await tx
      .select({ evidenceId: evidenceLinks.evidenceId })
      .from(evidenceLinks)
      .where(and(inArray(evidenceLinks.entityType, ["perf_session", "perf_rating", "perf_cycle"]), inArray(evidenceLinks.entityId, entityIds)));
    touchedEvidence = links.map((l) => l.evidenceId);
    await tx
      .delete(evidenceLinks)
      .where(and(inArray(evidenceLinks.entityType, ["perf_session", "perf_rating", "perf_cycle"]), inArray(evidenceLinks.entityId, entityIds)));
  }

  // 2) نسخ السجلات التاريخية لهذه الجلسات والدورات
  if (entityIds.length > 0) {
    await tx
      .delete(recordVersions)
      .where(and(inArray(recordVersions.entityType, ["perf_session", "perf_cycle"]), inArray(recordVersions.entityId, entityIds)));
  }

  // 3) خطط التحسين قبل الجلسات — `improvement_plans.session_id` مفتاح NO ACTION
  await tx.delete(improvementPlans).where(inArray(improvementPlans.cycleId, cycleIds));

  // 4) ملفات التقارير الموقعة قبل حذف صفوفها
  if (sessionIds.length > 0) {
    const signed = await tx
      .select({ fileId: perfSignedReportVersions.fileId })
      .from(perfSignedReportVersions)
      .where(inArray(perfSignedReportVersions.sessionId, sessionIds));
    for (const s of signed) orphanFileIds.push(s.fileId);
    const sessionFiles = await tx
      .select({ fileId: perfSessions.signedReportFileId })
      .from(perfSessions)
      .where(and(inArray(perfSessions.id, sessionIds), isNotNull(perfSessions.signedReportFileId)));
    for (const s of sessionFiles) if (s.fileId) orphanFileIds.push(s.fileId);

    await tx.delete(perfRatings).where(inArray(perfRatings.sessionId, sessionIds));
    await tx.delete(perfSignedReportVersions).where(inArray(perfSignedReportVersions.sessionId, sessionIds));
  }

  // 5) الجلسات ثم الدورات — قبل الوثائق، لأن `perf_sessions.report_doc_id` يشير إليها
  await tx.delete(perfSessions).where(inArray(perfSessions.cycleId, cycleIds));
  await tx.delete(perfCycles).where(inArray(perfCycles.id, cycleIds));

  // 6) الوثائق الصادرة وملفاتها
  if (documentIds.length > 0) {
    const docFiles = await tx
      .select({ fileId: documents.pdfFileId })
      .from(documents)
      .where(inArray(documents.id, documentIds));
    for (const d of docFiles) if (d.fileId) orphanFileIds.push(d.fileId);
    await tx.delete(documents).where(inArray(documents.id, documentIds));
  }

  // 7) الشواهد التي لم يبق لها رابط
  const { fileIds } = await deleteOrphanEvidence(tx, touchedEvidence);
  orphanFileIds.push(...fileIds);

  return orphanFileIds;
}

export async function deleteCyclePermanently(opts: {
  cycleId: string;
  actorId: string;
  reason: string;
  typedConfirm: string;
}): Promise<DeleteResult> {
  const impact = await assessCycleDeletion(opts.cycleId);
  if (!impact) return { error: "دورة الأداء غير موجودة" };
  if (impact.blockers.length > 0) return { error: impact.blockers[0] };
  const reason = opts.reason.trim();
  if (reason.length < DELETE_REASON_MIN) return { error: "سبب الحذف إلزامي (5 أحرف على الأقل)" };
  if (opts.typedConfirm.trim() !== impact.confirmName) {
    return { error: `اكتب سنة الدورة «${impact.confirmName}» حرفياً للتأكيد` };
  }

  const scope = await collectCycleScope([opts.cycleId]);
  let orphanPaths: string[] = [];
  await db.transaction(async (tx) => {
    const fileIds = await deleteCyclesWithin(tx, scope);
    orphanPaths = await deleteOrphanFiles(tx, fileIds);
    await tx.insert(deletionTombstones).values({
      entityType: "perf_cycle",
      entityId: opts.cycleId,
      displayRef: impact.displayRef,
      reason,
      counts: countsMap(impact.owned),
      actorId: opts.actorId,
    });
    await tx.insert(auditLog).values({
      actorId: opts.actorId,
      action: "perf_cycle.permanently_deleted",
      entityType: "perf_cycle",
      entityId: opts.cycleId,
      summary: `حذف نهائي لدورة الأداء — ${impact.displayRef}`,
      detail: { counts: countsMap(impact.owned), reason },
    });
  });
  const removed = await purgeFiles(orphanPaths);
  return {
    success: `حُذفت دورة الأداء نهائياً — ${impact.owned.reduce((s, l) => s + l.count, 0)} سجلاً${removed ? ` و${removed} ملفاً` : ""}`,
  };
}

/* ────────────── نموذج التقييم (v2.5.0 §8.1) ────────────── */

/**
 * معاينة أثر حذف **نموذج تقييم** — الثالث من عمليات الحذف الثلاث المتمايزة.
 *
 * ما يملكه النموذج ويُحذف معه: مؤشراته (`perf_indicators`). لا شيء غيره.
 *
 * ما **لا** يملكه: دورات الأداء المبنية عليه. الدورة سجل حياة **الموظف** لا سجل النموذج،
 * وحذفها هنا يمحو تقييم إنسان بقرار عن قالب. هذا هو الاستثناء الوحيد المقصود من قاعدة
 * §8.2 «لا تتوقف بسبب سجلات تابعة»: القاعدة عن السجلات **المملوكة**، والدورة ليست منها.
 * فتظهر كمانع صريح مع البديل الصحيح — أرشفة النموذج، وهي تُبقي كل تقييم وتقرير تاريخي.
 */
export async function assessModelDeletion(modelId: string): Promise<DeletionImpact | null> {
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, modelId));
  if (!model) return null;

  const [indicators, cycles] = await Promise.all([
    countRows(perfIndicators, eq(perfIndicators.modelId, modelId)),
    countRows(perfCycles, eq(perfCycles.modelId, modelId)),
  ]);

  const blockers: string[] = [];
  if (cycles > 0) {
    blockers.push(
      `يرتبط بالنموذج ${cycles} دورة تقييم — حذفه يمحو تقييمات موظفين. استخدم «أرشفة النموذج»: تبقى كل الدورات والتقارير التاريخية سليمة ولا يُستعمل النموذج في دورات جديدة.`,
    );
  }
  if (model.official) {
    blockers.push("النماذج الرسمية لا تُحذف نهائياً — مصدرها ملف الوزارة (D-014). استخدم «أرشفة النموذج».");
  }

  return {
    entity: "perf_model",
    entityId: modelId,
    displayRef: `${orFallback(model.nameAr, "نموذج بدون اسم")} — ${model.audience} (${model.status})`,
    // التأكيد الكتابي = اسم النموذج
    confirmName: model.nameAr,
    owned: [
      { type: "perf_models", labelAr: "نموذج التقييم", count: 1 },
      { type: "perf_indicators", labelAr: "معايير النموذج", count: indicators },
    ].filter((l) => l.count > 0),
    shared: [],
    blockers,
  };
}

/**
 * حذف نموذج تقييم غير مستخدم بمعاييره، في معاملة واحدة مع شاهد الحذف وسجل التدقيق.
 *
 * كان الحذف قبل v2.5.0 بلا اسم مكتوب ولا سبب ولا شاهد — مجرد `window.confirm`. الآن يمرّ
 * بضوابط الحذف نفسها المطبَّقة على الموظف ودورة الأداء (§8.4، §12.9).
 */
export async function deleteModelPermanently(opts: {
  modelId: string;
  actorId: string;
  reason: string;
  typedName: string;
}): Promise<DeleteResult> {
  const impact = await assessModelDeletion(opts.modelId);
  if (!impact) return { error: "النموذج غير موجود" };
  if (impact.blockers.length > 0) return { error: impact.blockers[0] };
  const reason = opts.reason.trim();
  if (reason.length < DELETE_REASON_MIN) return { error: "سبب الحذف إلزامي (5 أحرف على الأقل)" };
  const expected = impact.confirmName.trim() || "حذف نهائي";
  if (opts.typedName.trim() !== expected) return { error: `اكتب اسم النموذج «${expected}» حرفياً للتأكيد` };

  await db.transaction(async (tx) => {
    // إعادة الفحص داخل المعاملة: دورة أُنشئت بين المعاينة والتنفيذ يجب ألا تمر
    const stillLinked = await countRowsTx(tx, perfCycles, eq(perfCycles.modelId, opts.modelId));
    if (stillLinked > 0) throw new Error("LINKED_DURING_DELETE");
    await tx.delete(perfIndicators).where(eq(perfIndicators.modelId, opts.modelId));
    await tx.delete(perfModels).where(eq(perfModels.id, opts.modelId));
    await tx.insert(deletionTombstones).values({
      entityType: "perf_model",
      entityId: opts.modelId,
      displayRef: impact.displayRef,
      reason,
      counts: countsMap(impact.owned),
      actorId: opts.actorId,
    });
    await tx.insert(auditLog).values({
      actorId: opts.actorId,
      action: "perf_model.permanently_deleted",
      entityType: "perf_model",
      entityId: opts.modelId,
      summary: `حذف نهائي لنموذج التقييم — ${impact.displayRef}`,
      detail: { counts: countsMap(impact.owned), reason },
    });
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "LINKED_DURING_DELETE") {
      throw new Error("ارتبطت بالنموذج دورة تقييم أثناء العملية — لم يُحذف شيء، استخدم «أرشفة النموذج»");
    }
    throw e;
  });

  return { success: `حُذف نموذج التقييم نهائياً — ${impact.owned.reduce((s, l) => s + l.count, 0)} سجلاً` };
}

/* ────────────── التنفيذ: حذف المنسوب ────────────── */

export async function deletePersonPermanently(opts: {
  personId: string;
  actorId: string;
  reason: string;
  typedName: string;
}): Promise<DeleteResult> {
  const impact = await assessPersonDeletion(opts.personId, { actorUserId: opts.actorId });
  if (!impact) return { error: "المنسوب غير موجود" };
  if (impact.blockers.length > 0) return { error: impact.blockers[0] };
  const reason = opts.reason.trim();
  if (reason.length < DELETE_REASON_MIN) return { error: "سبب الحذف إلزامي (5 أحرف على الأقل)" };
  // الاسم الفارغ لا يصلح تأكيداً — يُطلب بديل صريح لا يمكن إرساله بالخطأ
  const expected = impact.confirmName.trim() || "حذف نهائي";
  if (opts.typedName.trim() !== expected) {
    return { error: `اكتب اسم المنسوب «${expected}» حرفياً للتأكيد` };
  }

  const cycleRows = await db.select({ id: perfCycles.id }).from(perfCycles).where(eq(perfCycles.personId, opts.personId));
  const scope = await collectCycleScope(cycleRows.map((c) => c.id));

  let orphanPaths: string[] = [];
  await db.transaction(async (tx) => {
    // 1) دورة حياة الأداء كاملة (النواة نفسها المستعملة لحذف دورة واحدة)
    const fileIds = await deleteCyclesWithin(tx, scope);

    // 2) شواهد ووثائق المنسوب نفسه
    const personLinks = await tx
      .select({ evidenceId: evidenceLinks.evidenceId })
      .from(evidenceLinks)
      .where(and(eq(evidenceLinks.entityType, "person"), eq(evidenceLinks.entityId, opts.personId)));
    await tx.delete(evidenceLinks).where(and(eq(evidenceLinks.entityType, "person"), eq(evidenceLinks.entityId, opts.personId)));
    const personDocs = await tx
      .select({ id: documents.id, fileId: documents.pdfFileId })
      .from(documents)
      .where(and(eq(documents.entityType, "person"), eq(documents.entityId, opts.personId)));
    for (const d of personDocs) if (d.fileId) fileIds.push(d.fileId);
    if (personDocs.length > 0) {
      await tx.delete(documents).where(inArray(documents.id, personDocs.map((d) => d.id)));
    }
    const orphanEvidence = await deleteOrphanEvidence(tx, personLinks.map((l) => l.evidenceId));
    fileIds.push(...orphanEvidence.fileIds);

    // 3) فكّ الصلات المؤسسية المشتركة — السجل الأب يبقى دائماً
    await tx.delete(committeeMembers).where(eq(committeeMembers.personId, opts.personId));
    await tx.update(programs).set({ ownerPersonId: null }).where(eq(programs.ownerPersonId, opts.personId));
    await tx.update(programActivities).set({ ownerPersonId: null }).where(eq(programActivities.ownerPersonId, opts.personId));
    await tx.update(actionTasks).set({ ownerPersonId: null }).where(eq(actionTasks.ownerPersonId, opts.personId));
    await tx.update(maintenanceIssues).set({ ownerPersonId: null }).where(eq(maintenanceIssues.ownerPersonId, opts.personId));
    await tx.update(inspectionFindings).set({ responsiblePersonId: null }).where(eq(inspectionFindings.responsiblePersonId, opts.personId));
    await tx.update(budgetExpenses).set({ responsiblePersonId: null }).where(eq(budgetExpenses.responsiblePersonId, opts.personId));

    // 4) حساب الدخول: تعطيل وفكّ ارتباط وإنهاء الجلسات — لا حذف (يُبقي سجل التدقيق سليماً)
    const accounts = await tx.select({ id: users.id }).from(users).where(eq(users.personId, opts.personId));
    for (const acc of accounts) {
      await tx.update(users).set({ active: false, personId: null, updatedAt: new Date() }).where(eq(users.id, acc.id));
      await tx.delete(authSessions).where(eq(authSessions.userId, acc.id));
      await tx.delete(notifications).where(eq(notifications.userId, acc.id));
    }

    // 5) المنسوب نفسه (`person_stages` تُحذف تعاقبياً بحكم المفتاح الأجنبي)
    await tx.delete(personStages).where(eq(personStages.personId, opts.personId));
    await tx.delete(people).where(eq(people.id, opts.personId));

    orphanPaths = await deleteOrphanFiles(tx, fileIds);

    await tx.insert(deletionTombstones).values({
      entityType: "person",
      entityId: opts.personId,
      displayRef: impact.displayRef,
      reason,
      counts: { ...countsMap(impact.owned), ...countsMap(impact.shared.map((l) => ({ ...l, type: `unlinked_${l.type}` }))) },
      actorId: opts.actorId,
    });
    await tx.insert(auditLog).values({
      actorId: opts.actorId,
      action: "person.permanently_deleted",
      entityType: "person",
      entityId: opts.personId,
      summary: `حذف نهائي للمنسوب — ${impact.displayRef}`,
      detail: { deleted: countsMap(impact.owned), unlinked: countsMap(impact.shared), reason },
    });
  });

  const removed = await purgeFiles(orphanPaths);
  return {
    success: `حُذف المنسوب ودورة حياته نهائياً — ${impact.owned.reduce((s, l) => s + l.count, 0)} سجلاً${removed ? ` و${removed} ملفاً` : ""}`,
  };
}

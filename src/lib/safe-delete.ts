import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  people,
  programs,
  programMilestones,
  programDeliverables,
  programRoadmapCells,
  programFollowups,
  programChangeRequests,

  committees,
  committeeMembers,
  committeeTemplates,
  committeeImpacts,
  meetings,
  perfCycles,
  personStages,
  actionTasks,
  maintenanceIssues,
  inspections,
  inspectionSchedules,
  inspectionTemplates,
  rooms,
  assets,

  documents,
  evidenceLinks,
  users,
} from "@/db/schema";

/**
 * طبقة الحذف الآمن الموحّدة.
 *
 * القاعدة المعتمدة في نطاق المنتج:
 *   1) الحذف النهائي يُسمح به فقط للسجل غير المستخدم الذي لا يملك أي تبعية تاريخية.
 *   2) عند وجود ارتباط أو استخدام تاريخي: يُستبدل الحذف بالأرشفة أو الإيقاف.
 *   3) لا حذف تعاقبي صامت لأي سجل تاريخي — أبداً.
 *   4) يُشرح للمستخدم سبب المنع بالعربية، بأنواع التبعيات وأعدادها.
 *   5) كل تغيير جوهري يُقيَّد في سجل التدقيق (مسؤولية المستدعي).
 *
 * هذه الوحدة تقرأ فقط ولا تكتب شيئاً. الحارس الفعلي يُستدعى داخل إجراء الحذف نفسه.
 */

export type Dependency = {
  /** مفتاح تقني للاختبارات والتدقيق */
  type: string;
  labelAr: string;
  count: number;
};

export type SafeDeleteEntity =
  | "person"
  | "program"
  | "milestone"
  | "deliverable"
  | "budget_item"
  | "committee"
  | "committee_template"
  | "inspection_template"
  | "room"
  | "asset"
  | "evidence";

export type DeleteAssessment = {
  entity: SafeDeleteEntity;
  entityId: string;
  /** التبعيات ذات العدد > 0 فقط */
  dependencies: Dependency[];
  /** يُمنع الحذف النهائي عند وجود أي تبعية */
  blocked: boolean;
  /** شرح عربي جاهز للعرض */
  messageAr: string;
  /** البديل المتاح بالعربية (أرشفة/إيقاف) */
  alternativeAr: string;
};

/** البديل المناسب لكل نوع حين يكون الحذف ممنوعاً. */
const ALTERNATIVE_AR: Record<SafeDeleteEntity, string> = {
  person: "أوقف المنسوب (إيقاف قابل للإعادة) بدل حذفه — تبقى سجلاته التاريخية كما هي.",
  program: "أرشف البرنامج بدل حذفه — تبقى مخرجاته وشواهده ومتابعاته محفوظة.",
  milestone: "عدّل المعلم أو صفّر وزنه بدل حذفه — يبقى أثره في تقارير التقدم.",
  deliverable: "أرشف المخرج بدل حذفه — تبقى حزمة شواهده المعتمدة محفوظة.",
  budget_item: "أرشف بند الميزانية بدل حذفه — تبقى مصروفاته وشواهده محفوظة.",
  committee: "أغلق اللجنة أو أرشفها بدل حذفها — تبقى اجتماعاتها ومحاضرها محفوظة.",
  committee_template: "عطّل القالب بدل حذفه — تبقى التشكيلات المبنية عليه سليمة.",
  inspection_template: "عطّل القالب بدل حذفه — تبقى الفحوصات المنفذة بنسختها المجمدة.",
  room: "أوقف الغرفة بدل حذفها — تبقى فحوصاتها وبلاغاتها وأصولها مرتبطة.",
  asset: "أرشف الأصل بدل حذفه — تبقى بلاغات الصيانة والشواهد المرتبطة به.",
  evidence: "أرشف الشاهد بدل حذفه — تبقى كل السجلات المرتبطة به سليمة.",
};

async function countWhere(
   
  table: any,
   
  where: any,
): Promise<number> {
  const [row] = await db.select({ c: count() }).from(table).where(where);
  return Number(row?.c ?? 0);
}

/** التبعيات العامة: شواهد مرتبطة ووثائق صادرة تشير إلى السجل. */
async function polymorphicDeps(entityType: string, entityId: string): Promise<Dependency[]> {
  const [ev, docs] = await Promise.all([
    countWhere(evidenceLinks, and(eq(evidenceLinks.entityType, entityType), eq(evidenceLinks.entityId, entityId))),
    countWhere(documents, and(eq(documents.entityType, entityType), eq(documents.entityId, entityId))),
  ]);
  return [
    { type: "evidence_links", labelAr: "شواهد مرتبطة", count: ev },
    { type: "documents", labelAr: "وثائق صادرة", count: docs },
  ];
}

/** تبعيات شخص واحد — نفس المواضع السبعة المعتمدة في حارس تراجع دفعات الاستيراد. */
export async function personDependencies(personId: string): Promise<Dependency[]> {
  const [committeeMemberships, cycles, stagesAssigned, tasks, maintenance, ownedPrograms, accounts, poly] =
    await Promise.all([
      countWhere(committeeMembers, eq(committeeMembers.personId, personId)),
      countWhere(perfCycles, eq(perfCycles.personId, personId)),
      countWhere(personStages, eq(personStages.personId, personId)),
      countWhere(actionTasks, eq(actionTasks.ownerPersonId, personId)),
      countWhere(maintenanceIssues, eq(maintenanceIssues.ownerPersonId, personId)),
      countWhere(programs, eq(programs.ownerPersonId, personId)),
      countWhere(users, eq(users.personId, personId)),
      polymorphicDeps("person", personId),
    ]);
  return [
    { type: "committee_members", labelAr: "عضويات لجان", count: committeeMemberships },
    { type: "perf_cycles", labelAr: "دورات تقييم أداء", count: cycles },
    { type: "person_stages", labelAr: "مراحل تدريس مسندة", count: stagesAssigned },
    { type: "action_tasks", labelAr: "مهام وإجراءات مسندة", count: tasks },
    { type: "maintenance_issues", labelAr: "بلاغات صيانة مسندة", count: maintenance },
    { type: "programs", labelAr: "برامج خطة يملكها المنسوب", count: ownedPrograms },
    { type: "users", labelAr: "حسابات دخول مرتبطة", count: accounts },
    ...poly,
  ];
}

async function programDependencies(programId: string): Promise<Dependency[]> {
  const [milestones, deliverables, roadmap, followups, changeRequests, tasks, poly] = await Promise.all([
    countWhere(programMilestones, eq(programMilestones.programId, programId)),
    countWhere(programDeliverables, eq(programDeliverables.programId, programId)),
    countWhere(programRoadmapCells, eq(programRoadmapCells.programId, programId)),
    countWhere(programFollowups, eq(programFollowups.programId, programId)),
    countWhere(programChangeRequests, eq(programChangeRequests.programId, programId)),
    countWhere(actionTasks, and(eq(actionTasks.sourceType, "program"), eq(actionTasks.sourceId, programId))),
    polymorphicDeps("program", programId),
  ]);
  return [
    { type: "milestones", labelAr: "معالم موزونة", count: milestones },
    { type: "deliverables", labelAr: "مخرجات ومتطلبات", count: deliverables },
    { type: "roadmap_cells", labelAr: "خلايا خارطة التنفيذ", count: roadmap },
    { type: "followups", labelAr: "متابعات أسبوعية", count: followups },
    { type: "change_requests", labelAr: "طلبات تغيير", count: changeRequests },
    { type: "action_tasks", labelAr: "مهام ناتجة عن البرنامج", count: tasks },
    ...poly,
  ];
}

async function committeeDependencies(committeeId: string): Promise<Dependency[]> {
  const [members, committeeMeetings, impacts, poly] = await Promise.all([
    countWhere(committeeMembers, eq(committeeMembers.committeeId, committeeId)),
    countWhere(meetings, eq(meetings.committeeId, committeeId)),
    countWhere(committeeImpacts, eq(committeeImpacts.committeeId, committeeId)),
    polymorphicDeps("committee", committeeId),
  ]);
  return [
    { type: "committee_members", labelAr: "أعضاء التشكيل", count: members },
    { type: "meetings", labelAr: "اجتماعات", count: committeeMeetings },
    { type: "committee_impacts", labelAr: "نتائج وأثر", count: impacts },
    ...poly,
  ];
}

async function roomDependencies(roomId: string): Promise<Dependency[]> {
  const [roomAssets, roomInspections, maintenance, poly] = await Promise.all([
    countWhere(assets, eq(assets.roomId, roomId)),
    countWhere(inspections, eq(inspections.roomId, roomId)),
    countWhere(maintenanceIssues, eq(maintenanceIssues.roomId, roomId)),
    polymorphicDeps("room", roomId),
  ]);
  return [
    { type: "assets", labelAr: "أصول وعهد داخل الغرفة", count: roomAssets },
    { type: "inspections", labelAr: "فحوصات منفذة", count: roomInspections },
    { type: "maintenance_issues", labelAr: "بلاغات صيانة", count: maintenance },
    ...poly,
  ];
}

/**
 * تبعيات الأصل — مطابقة لسلوك `getAssetDependencies` القائم عمداً.
 * `asset_history` أثر داخلي للأصل وليس سجل أعمال مستقلاً، لذا لا يُعدّ تبعية مانعة
 * (إجراء الحذف القائم يزيله مع الأصل في المعاملة نفسها).
 */
async function assetDependencies(assetId: string): Promise<Dependency[]> {
  const [maintenance, poly] = await Promise.all([
    countWhere(maintenanceIssues, eq(maintenanceIssues.assetId, assetId)),
    polymorphicDeps("asset", assetId),
  ]);
  return [{ type: "maintenance_issues", labelAr: "بلاغات صيانة", count: maintenance }, ...poly];
}

async function templateDependencies(kind: "committee_template" | "inspection_template", id: string): Promise<Dependency[]> {
  if (kind === "committee_template") {
    const used = await countWhere(committees, eq(committees.templateId, id));
    return [{ type: "committees", labelAr: "تشكيلات مبنية على القالب", count: used }];
  }
  const [used, scheduled, versions] = await Promise.all([
    countWhere(inspections, eq(inspections.templateId, id)),
    countWhere(inspectionSchedules, eq(inspectionSchedules.templateId, id)),
    countWhere(inspectionTemplates, and(eq(inspectionTemplates.rootId, id), isNull(inspectionTemplates.approvedAt))),
  ]);
  return [
    { type: "inspections", labelAr: "فحوصات نُفذت بالقالب", count: used },
    { type: "inspection_schedules", labelAr: "جداول فحص مرتبطة", count: scheduled },
    { type: "template_versions", labelAr: "إصدارات لاحقة من القالب", count: versions },
  ];
}

async function evidenceDependencies(evidenceId: string): Promise<Dependency[]> {
  const links = await db
    .select({ entityType: evidenceLinks.entityType })
    .from(evidenceLinks)
    .where(eq(evidenceLinks.evidenceId, evidenceId));
  const byType = new Map<string, number>();
  for (const l of links) byType.set(l.entityType, (byType.get(l.entityType) ?? 0) + 1);
  const { entityLabelAr } = await import("./entity-registry");
  return [...byType.entries()].map(([type, c]) => ({
    type,
    labelAr: `مرتبط بـ${entityLabelAr(type)}`,
    count: c,
  }));
}

/** ملخص عربي مختصر لأنواع التبعيات وأعدادها. */
export function dependencySummaryAr(deps: Dependency[]): string {
  return deps.map((d) => `${d.labelAr} (${d.count})`).join("، ");
}

/**
 * التقييم الموحد قبل أي حذف نهائي. لا يكتب شيئاً.
 * النوع غير المدعوم يُعامل fail-closed: يُمنع الحذف بدل السماح به بصمت.
 */
export async function assessDeletion(entity: SafeDeleteEntity, entityId: string): Promise<DeleteAssessment> {
  let all: Dependency[];
  switch (entity) {
    case "person":
      all = await personDependencies(entityId);
      break;
    case "program":
      all = await programDependencies(entityId);
      break;
    case "committee":
      all = await committeeDependencies(entityId);
      break;
    case "room":
      all = await roomDependencies(entityId);
      break;
    case "asset":
      all = await assetDependencies(entityId);
      break;
    case "committee_template":
      all = await templateDependencies("committee_template", entityId);
      break;
    case "inspection_template":
      all = await templateDependencies("inspection_template", entityId);
      break;
    case "evidence":
      all = await evidenceDependencies(entityId);
      break;
    case "milestone":
    case "deliverable":
      all = await polymorphicDeps(entity, entityId);
      break;
    case "budget_item":
      all = await polymorphicDeps("budget_item", entityId);
      break;
    default: {
      // fail-closed — نوع لم يُسجَّل بعد لا يُحذف نهائياً
      const exhaustive: never = entity;
      return {
        entity: exhaustive,
        entityId,
        dependencies: [{ type: "unknown", labelAr: "نوع سجل غير مسجَّل في طبقة الحذف الآمن", count: 1 }],
        blocked: true,
        messageAr: "لا يمكن الحذف النهائي: نوع السجل غير مسجَّل في طبقة الحذف الآمن.",
        alternativeAr: "استخدم الأرشفة أو الإيقاف.",
      };
    }
  }

  const dependencies = all.filter((d) => d.count > 0);
  const blocked = dependencies.length > 0;
  const alternativeAr = ALTERNATIVE_AR[entity];
  const messageAr = blocked
    ? `لا يمكن الحذف النهائي — يوجد سجلات مرتبطة: ${dependencySummaryAr(dependencies)}. ${alternativeAr}`
    : "لا توجد سجلات مرتبطة — الحذف النهائي متاح.";

  return { entity, entityId, dependencies, blocked, messageAr, alternativeAr };
}

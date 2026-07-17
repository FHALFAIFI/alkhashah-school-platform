import "server-only";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actionTasks,
  committees,
  evidenceItems,
  evidenceLinks,
  importBatches,
  importRows,
  inspectionTemplates,
  maintenanceIssues,
  meetingOutcomes,
  meetings,
  people,
  perfCycles,
  perfSessions,
  programChangeRequests,
  programDeliverables,
  programs,
  rooms,
} from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { computePackageReadiness } from "@/lib/plan/progress";
import { todayIso } from "@/lib/dates";
import { getExcludedIdSets, notSynthetic, type SyntheticIdSets } from "@/lib/synthetic";

/**
 * قوائم عمل المدير — تجميع كل ما يحتاج إجراء عبر الوحدات في مكان واحد.
 * كل عنصر يحمل رابطاً إلى السجل المحدد الذي يحتاج الإجراء (لا إلى صفحة الوحدة)،
 * ونص «الإجراء التالي» بالعربية. تفحص صلاحيات المستخدم قبل كل استعلام.
 */
export type WorkItem = {
  title: string;
  detail?: string;
  status?: string;
  /** رابط السجل المحدد الذي يفتح مباشرة على موضع الإجراء */
  href: string;
  /** الإجراء التالي بصيغة أمر واضح */
  action: string;
  /** موعد الاستحقاق إن وجد (ISO) */
  due?: string;
  urgent?: boolean;
};

export type WorkCenter = {
  needsActionNow: WorkItem[];
  overdueTasks: WorkItem[];
  awaitingReview: WorkItem[];
  awaitingApproval: WorkItem[];
  evidenceGaps: WorkItem[];
  openDecisions: WorkItem[];
  upcomingPerformance: WorkItem[];
  maintenance: WorkItem[];
};

const OPEN_TASK = ["جديدة", "قيد التنفيذ"];
const ONCE_ONLY_ORDER = ["تخطيط", "منتصف", "نهائي"] as const;

/** يحل رابط السجل المصدر لمهمة (قرار اجتماع، برنامج، جلسة أداء، فحص، صيانة). */
export async function resolveTaskSources(
  tasks: { id: string; sourceType: string | null; sourceId: string | null }[],
): Promise<Map<string, { href: string; label: string }>> {
  const out = new Map<string, { href: string; label: string }>();
  const byType = (t: string) => tasks.filter((x) => x.sourceType === t && x.sourceId);

  const outcomeTasks = byType("meeting_outcome");
  if (outcomeTasks.length) {
    const rows = await db
      .select({
        outcomeId: meetingOutcomes.id,
        meetingId: meetings.id,
        committeeId: meetings.committeeId,
        committeeName: committees.nameAr,
        seq: meetings.seq,
      })
      .from(meetingOutcomes)
      .innerJoin(meetings, eq(meetingOutcomes.meetingId, meetings.id))
      .innerJoin(committees, eq(meetings.committeeId, committees.id))
      .where(inArray(meetingOutcomes.id, outcomeTasks.map((t) => t.sourceId!)));
    const byOutcome = new Map(rows.map((r) => [r.outcomeId, r]));
    for (const t of outcomeTasks) {
      const r = byOutcome.get(t.sourceId!);
      if (r) out.set(t.id, { href: `/committees/${r.committeeId}/meetings/${r.meetingId}`, label: `${r.committeeName} — الاجتماع ${r.seq}` });
    }
  }

  for (const t of byType("program")) {
    out.set(t.id, { href: `/plan/${t.sourceId}`, label: "برنامج في الخطة التشغيلية" });
  }

  const sessionTasks = byType("perf_session");
  if (sessionTasks.length) {
    const rows = await db
      .select({ id: perfSessions.id, cycleId: perfSessions.cycleId, type: perfSessions.sessionType })
      .from(perfSessions)
      .where(inArray(perfSessions.id, sessionTasks.map((t) => t.sourceId!)));
    const bySession = new Map(rows.map((r) => [r.id, r]));
    for (const t of sessionTasks) {
      const r = bySession.get(t.sourceId!);
      if (r) out.set(t.id, { href: `/performance/cycles/${r.cycleId}/sessions/${r.id}`, label: `جلسة ${r.type}` });
    }
  }

  const maintTasks = byType("maintenance");
  if (maintTasks.length) {
    const rows = await db
      .select({ id: maintenanceIssues.id, code: maintenanceIssues.code })
      .from(maintenanceIssues)
      .where(inArray(maintenanceIssues.id, maintTasks.map((t) => t.sourceId!)));
    const byIssue = new Map(rows.map((r) => [r.id, r]));
    for (const t of maintTasks) {
      const r = byIssue.get(t.sourceId!);
      if (r) out.set(t.id, { href: `/building/maintenance#issue-${r.code}`, label: `بلاغ ${r.code}` });
    }
  }

  return out;
}

async function importItems(user: CurrentUser): Promise<{ review: WorkItem[]; approve: WorkItem[] }> {
  if (!user.permissions.has("imports.read")) return { review: [], approve: [] };
  const batches = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.status, "معاينة"))
    .orderBy(desc(importBatches.createdAt));
  if (!batches.length) return { review: [], approve: [] };
  const counts = await db
    .select({ batchId: importRows.batchId, status: importRows.status, c: sql<number>`count(*)::int` })
    .from(importRows)
    .where(inArray(importRows.batchId, batches.map((b) => b.id)))
    .groupBy(importRows.batchId, importRows.status);
  const review: WorkItem[] = [];
  const approve: WorkItem[] = [];
  for (const b of batches) {
    const c = (s: string) => counts.find((x) => x.batchId === b.id && x.status === s)?.c ?? 0;
    const needsReview = c("يحتاج مراجعة");
    const deferred = c("مؤجل");
    const ready = c("جاهز");
    const label = b.importType === "people" ? "استيراد أشخاص" : b.importType === "operational_plan" ? "استيراد الخطة التشغيلية" : "استيراد";
    if (needsReview + deferred > 0) {
      review.push({
        title: `${label}: ${b.sourceFileName}`,
        detail:
          `${needsReview > 0 ? `${needsReview} صفاً بحاجة إلى مراجعة` : ""}` +
          `${needsReview > 0 && deferred > 0 ? " و" : ""}` +
          `${deferred > 0 ? `${deferred} صفاً مؤجلاً` : ""} قبل التنفيذ`,
        status: needsReview > 0 ? "يحتاج مراجعة" : "مؤجل",
        href: `/imports/${b.id}`,
        action: "راجع الصفوف ثم أكدها أو استبعدها",
      });
    } else if (ready > 0 && user.permissions.has("imports.commit")) {
      approve.push({
        title: `${label}: ${b.sourceFileName}`,
        detail: `${ready} صفاً جاهزاً — بانتظار موافقتك الصريحة`,
        status: "معاينة",
        href: `/imports/${b.id}`,
        action: "راجع المعاينة واعتمد التنفيذ",
        urgent: true,
      });
    }
  }
  return { review, approve };
}

async function planItems(user: CurrentUser, ex: SyntheticIdSets): Promise<{ approve: WorkItem[]; gaps: WorkItem[] }> {
  if (!user.permissions.has("plan.read")) return { approve: [], gaps: [] };
  const approve: WorkItem[] = [];

  if (user.permissions.has("plan.approve")) {
    const crs = await db
      .select({
        id: programChangeRequests.id,
        fieldLabel: programChangeRequests.fieldLabel,
        programId: programChangeRequests.programId,
        programName: programs.name,
        seq: programs.seq,
      })
      .from(programChangeRequests)
      .innerJoin(programs, eq(programChangeRequests.programId, programs.id))
      .where(and(eq(programChangeRequests.status, "قيد الاعتماد"), notSynthetic(programs.id, ex.programs)))
      .orderBy(desc(programChangeRequests.createdAt));
    for (const cr of crs) {
      approve.push({
        title: `طلب تعديل «${cr.fieldLabel}» — ${cr.seq}. ${cr.programName}`,
        status: "قيد الاعتماد",
        href: `/plan/${cr.programId}#change-requests`,
        action: "اعتمد التعديل أو ارفضه",
        urgent: true,
      });
    }

    const readyPackages = await db
      .select({
        id: programDeliverables.id,
        programId: programDeliverables.programId,
        mainOutput: programDeliverables.mainOutput,
        programName: programs.name,
        seq: programs.seq,
      })
      .from(programDeliverables)
      .innerJoin(programs, eq(programDeliverables.programId, programs.id))
      .where(and(eq(programDeliverables.packageStatus, "جاهزة للاعتماد"), notSynthetic(programs.id, ex.programs)));
    for (const d of readyPackages) {
      approve.push({
        title: `حزمة شواهد جاهزة — ${d.seq}. ${d.programName}`,
        detail: d.mainOutput ?? undefined,
        status: "جاهزة للاعتماد",
        href: `/plan/${d.programId}#evidence`,
        action: "اعتمد حزمة الشواهد",
      });
    }
  }

  // تنبيهات نقص الشواهد: البرامج المعتمدة التي تنقص حزمها أدوار شواهد إلزامية
  const gaps: WorkItem[] = [];
  if (user.permissions.has("evidence.read")) {
    const approvedPrograms = await db
      .select({ id: programs.id, name: programs.name, seq: programs.seq })
      .from(programs)
      .where(and(eq(programs.status, "معتمد"), notSynthetic(programs.id, ex.programs)));
    if (approvedPrograms.length) {
      const deliverables = await db
        .select()
        .from(programDeliverables)
        .where(inArray(programDeliverables.programId, approvedPrograms.map((p) => p.id)));
      const links = deliverables.length
        ? await db
            .select({ entityId: evidenceLinks.entityId, role: evidenceItems.role })
            .from(evidenceLinks)
            .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
            .where(and(eq(evidenceLinks.entityType, "deliverable"), inArray(evidenceLinks.entityId, deliverables.map((d) => d.id))))
        : [];
      const rolesByDeliverable = new Map<string, string[]>();
      for (const l of links) {
        if (!l.role) continue;
        const arr = rolesByDeliverable.get(l.entityId) ?? [];
        arr.push(l.role);
        rolesByDeliverable.set(l.entityId, arr);
      }
      const missingByProgram = new Map<string, Set<string>>();
      for (const d of deliverables) {
        if (d.packageStatus === "معتمدة") continue;
        const { missing } = computePackageReadiness({
          requiresExternal: d.requiresExternal,
          evidenceRoles: rolesByDeliverable.get(d.id) ?? [],
        });
        if (missing.length) {
          const set = missingByProgram.get(d.programId) ?? new Set<string>();
          missing.forEach((m) => set.add(m));
          missingByProgram.set(d.programId, set);
        }
      }
      for (const p of approvedPrograms) {
        const missing = missingByProgram.get(p.id);
        if (missing?.size) {
          gaps.push({
            title: `${p.seq}. ${p.name}`,
            detail: `شواهد ناقصة: ${[...missing].join("، ")}`,
            href: `/plan/${p.id}#evidence`,
            action: "أرفق الشواهد الناقصة",
          });
        }
      }
    }
  }

  return { approve, gaps };
}

async function committeeItems(user: CurrentUser, ex: SyntheticIdSets): Promise<{ review: WorkItem[]; approve: WorkItem[] }> {
  if (!user.permissions.has("committees.read")) return { review: [], approve: [] };
  const review: WorkItem[] = [];
  const approve: WorkItem[] = [];

  if (user.permissions.has("committees.approve")) {
    const drafts = await db
      .select({ id: committees.id, nameAr: committees.nameAr })
      .from(committees)
      .where(and(eq(committees.status, "مسودة"), notSynthetic(committees.id, ex.committees)))
      .orderBy(asc(committees.nameAr));
    for (const c of drafts) {
      approve.push({
        title: c.nameAr,
        detail: "تشكيل بانتظار الاعتماد — أضف الأعضاء ثم اعتمد",
        status: "مسودة",
        href: `/committees/${c.id}`,
        action: "أكمل التشكيل واعتمده",
      });
    }
  }

  const pendingSignature = await db
    .select({
      id: meetings.id,
      committeeId: meetings.committeeId,
      seq: meetings.seq,
      title: meetings.title,
      committeeName: committees.nameAr,
    })
    .from(meetings)
    .innerJoin(committees, eq(meetings.committeeId, committees.id))
    .where(and(eq(meetings.status, "بانتظار التوقيع"), notSynthetic(meetings.id, ex.meetings)))
    .orderBy(desc(meetings.createdAt));
  for (const m of pendingSignature) {
    review.push({
      title: `${m.committeeName} — الاجتماع ${m.seq}${m.title ? `: ${m.title}` : ""}`,
      detail: "المحضر الموقع مرفوع — بانتظار إكمال الاجتماع",
      status: "بانتظار التوقيع",
      href: `/committees/${m.committeeId}/meetings/${m.id}`,
      action: "أكمل الاجتماع",
      urgent: true,
    });
  }

  return { review, approve };
}

async function openDecisionItems(user: CurrentUser, ex: SyntheticIdSets): Promise<WorkItem[]> {
  if (!user.permissions.has("tasks.read") || !user.permissions.has("committees.read")) return [];
  const rows = await db
    .select({
      taskId: actionTasks.id,
      title: actionTasks.title,
      status: actionTasks.status,
      dueDate: actionTasks.dueDate,
      mandatory: actionTasks.mandatory,
      meetingId: meetings.id,
      committeeId: meetings.committeeId,
      committeeName: committees.nameAr,
      seq: meetings.seq,
    })
    .from(actionTasks)
    .innerJoin(meetingOutcomes, eq(actionTasks.sourceId, meetingOutcomes.id))
    .innerJoin(meetings, eq(meetingOutcomes.meetingId, meetings.id))
    .innerJoin(committees, eq(meetings.committeeId, committees.id))
    .where(and(eq(actionTasks.sourceType, "meeting_outcome"), inArray(actionTasks.status, OPEN_TASK), notSynthetic(actionTasks.id, ex.tasks)))
    .orderBy(asc(actionTasks.dueDate));
  const today = todayIso();
  return rows.map((r) => {
    const due = r.dueDate?.toISOString().slice(0, 10);
    const overdue = Boolean(due && due < today);
    return {
      title: r.title,
      detail: `${r.committeeName} — الاجتماع ${r.seq}${r.mandatory ? " · قرار إلزامي" : ""}`,
      status: overdue ? "متأخر" : r.status,
      href: `/committees/${r.committeeId}/meetings/${r.meetingId}`,
      action: "تابع تنفيذ القرار",
      due,
      urgent: overdue,
    };
  });
}

async function overdueTaskItems(user: CurrentUser, ex: SyntheticIdSets): Promise<WorkItem[]> {
  if (!user.permissions.has("tasks.read")) return [];
  const today = todayIso();
  const tasks = await db
    .select()
    .from(actionTasks)
    .where(and(inArray(actionTasks.status, OPEN_TASK), sql`${actionTasks.dueDate} is not null and ${actionTasks.dueDate}::date < ${today}::date`, notSynthetic(actionTasks.id, ex.tasks)))
    .orderBy(asc(actionTasks.dueDate));
  const sources = await resolveTaskSources(tasks);
  return tasks.map((t) => {
    const src = sources.get(t.id);
    return {
      title: t.title,
      detail: src?.label,
      status: "متأخر",
      href: src?.href ?? `/tasks#task-${t.id}`,
      action: t.mandatory ? "نفّذ القرار الإلزامي" : "تابع المهمة",
      due: t.dueDate?.toISOString().slice(0, 10),
      urgent: t.mandatory || t.priority === "عالية",
    };
  });
}

async function evidenceReviewItems(user: CurrentUser, ex: SyntheticIdSets): Promise<WorkItem[]> {
  if (!user.permissions.has("evidence.read")) return [];
  const items = await db
    .select({ id: evidenceItems.id, title: evidenceItems.title, role: evidenceItems.role })
    .from(evidenceItems)
    .where(and(eq(evidenceItems.reviewStatus, "لم يراجع"), notSynthetic(evidenceItems.id, ex.evidence)))
    .orderBy(desc(evidenceItems.createdAt));
  return items.map((e) => ({
    title: e.title,
    detail: e.role ? `شاهد ${e.role}` : undefined,
    status: "لم يراجع",
    href: `/evidence#ev-${e.id}`,
    action: "راجع الشاهد",
  }));
}

async function performanceItems(user: CurrentUser, ex: SyntheticIdSets): Promise<WorkItem[]> {
  if (!user.permissions.has("performance.read")) return [];
  const cycles = await db
    .select({
      id: perfCycles.id,
      personId: perfCycles.personId,
      cycleType: perfCycles.cycleType,
      personName: people.fullName,
    })
    .from(perfCycles)
    .innerJoin(people, eq(perfCycles.personId, people.id))
    .where(and(eq(perfCycles.status, "نشطة"), notSynthetic(perfCycles.id, ex.perfCycles)));
  if (!cycles.length) return [];
  const sessions = await db
    .select()
    .from(perfSessions)
    .where(inArray(perfSessions.cycleId, cycles.map((c) => c.id)));
  const byCycle = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const arr = byCycle.get(s.cycleId) ?? [];
    arr.push(s);
    byCycle.set(s.cycleId, arr);
  }
  const items: WorkItem[] = [];
  for (const c of cycles) {
    const ss = byCycle.get(c.id) ?? [];
    // جلسة قائمة تنتظر الإكمال أولاً
    const pending = ss.find((s) => s.status === "مسودة" || s.status === "بانتظار التقرير الموقع");
    if (pending) {
      const needsSigned = Boolean(pending.reportDocId) && !pending.signedReportFileId;
      items.push({
        title: `${c.personName} — جلسة ${pending.sessionType}`,
        detail: needsSigned ? "التقرير صادر — بانتظار رفع النسخة الموقعة" : "جلسة غير مكتملة",
        status: pending.status,
        href: `/performance/cycles/${c.id}/sessions/${pending.id}`,
        action: needsSigned ? "ارفع التقرير الموقع وأكمل الجلسة" : "أكمل الجلسة",
        urgent: needsSigned,
      });
      continue;
    }
    // وإلا: أول جلسة أساسية لم تعقد بعد
    const held = new Set(ss.map((s) => s.sessionType));
    const next = ONCE_ONLY_ORDER.find((t) => !held.has(t));
    if (next) {
      items.push({
        title: `${c.personName} — جلسة ${next}`,
        detail: c.cycleType === "معلم" ? "دورة معلم (التقويم الدراسي)" : "دورة موظف (السنة الميلادية)",
        href: `/performance/cycles/${c.id}`,
        action: `أنشئ جلسة ${next}`,
      });
    }
  }
  return items;
}

async function maintenanceItems(user: CurrentUser, ex: SyntheticIdSets): Promise<WorkItem[]> {
  if (!user.permissions.has("maintenance.read")) return [];
  const issues = await db
    .select({
      id: maintenanceIssues.id,
      code: maintenanceIssues.code,
      title: maintenanceIssues.title,
      status: maintenanceIssues.status,
      priority: maintenanceIssues.priority,
      roomId: maintenanceIssues.roomId,
      roomName: rooms.nameAr,
    })
    .from(maintenanceIssues)
    .leftJoin(rooms, eq(maintenanceIssues.roomId, rooms.id))
    .where(and(inArray(maintenanceIssues.status, ["مفتوح", "قيد الإصلاح", "تم الإصلاح"]), notSynthetic(maintenanceIssues.id, ex.maintenance)))
    .orderBy(desc(maintenanceIssues.createdAt));
  return issues.map((i) => ({
    title: `${i.title} (${i.code})`,
    detail: i.roomName ?? undefined,
    status: i.status,
    href: `/building/maintenance#issue-${i.code}`,
    action: i.status === "تم الإصلاح" ? "تحقق وأغلق البلاغ" : "تابع الإصلاح",
    urgent: i.priority === "عالية" && i.status === "مفتوح",
  }));
}

async function inspectionTemplateItems(user: CurrentUser): Promise<WorkItem[]> {
  if (!user.permissions.has("building.publish")) return [];
  const drafts = await db
    .select({ id: inspectionTemplates.id, nameAr: inspectionTemplates.nameAr })
    .from(inspectionTemplates)
    .where(eq(inspectionTemplates.status, "مسودة"));
  return drafts.map((t) => ({
    title: `قالب فحص: ${t.nameAr}`,
    detail: "لا يستخدم القالب قبل اعتماده",
    status: "مسودة",
    href: `/building/inspections#tpl-${t.id}`,
    action: "اعتمد قالب الفحص",
  }));
}

/** يجمع كل أقسام مركز العمل — كل قسم يفحص صلاحياته بنفسه. */
export async function getWorkCenter(user: CurrentUser): Promise<WorkCenter> {
  // مركز العمل يستبعد السجلات الاصطناعية (مفعّل في التطوير/الإنتاج)
  const ex = await getExcludedIdSets();
  const [imports, plan, committee, decisions, overdue, evidenceReview, performance, maintenance, templates] =
    await Promise.all([
      importItems(user),
      planItems(user, ex),
      committeeItems(user, ex),
      openDecisionItems(user, ex),
      overdueTaskItems(user, ex),
      evidenceReviewItems(user, ex),
      performanceItems(user, ex),
      maintenanceItems(user, ex),
      inspectionTemplateItems(user),
    ]);

  const awaitingReview = [...imports.review, ...committee.review, ...evidenceReview];
  const awaitingApproval = [...imports.approve, ...plan.approve, ...committee.approve, ...templates];

  // «ما يحتاج إجراء الآن»: العناصر العاجلة عبر الأقسام دون تكرار الروابط
  const urgentPool = [
    ...awaitingApproval,
    ...awaitingReview,
    ...overdue,
    ...decisions,
    ...performance,
    ...maintenance,
  ].filter((i) => i.urgent);
  const seen = new Set<string>();
  const needsActionNow: WorkItem[] = [];
  for (const item of urgentPool) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    needsActionNow.push(item);
  }

  return {
    needsActionNow,
    overdueTasks: overdue,
    awaitingReview,
    awaitingApproval,
    evidenceGaps: plan.gaps,
    openDecisions: decisions,
    upcomingPerformance: performance,
    maintenance,
  };
}

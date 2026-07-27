import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  people, programs, committees, meetings, actionTasks, evidenceItems, evidenceLinks,
  rooms, assets, inspections, maintenanceIssues, documents, perfCycles, perfSessions,
  aiDrafts, programDeliverables, programChangeRequests,
  committeeMembers, meetingOutcomes, readinessOverrides, meetingTypes, meetingAttachments,
} from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { createDraftEmail, m365Enabled } from "@/lib/email/m365";
import { computeRoomReadiness } from "@/lib/building/readiness";
import { readStoredFile } from "@/lib/storage";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { ocrImage } from "./assist";

/**
 * سجل الأدوات المصنفة لمساعد المدير الذكي — النموذج لا يصل لقاعدة البيانات إطلاقاً؛
 * يقترح استدعاء أداة معرفة هنا فقط، وتتحقق المنصة من الصلاحية والمدخلات قبل التنفيذ.
 *
 * قاعدة صارمة: لا توجد — ولن توجد — أدوات اعتماد أو إقفال أو توقيع أو ختم أو تقييم
 * أو تغيير نماذج/أوزان أو تنفيذ/رفض استيراد أو حذف نهائي أو إرسال بريد نهائي أو
 * إدارة مستخدمين وصلاحيات أو SQL خام. تلك يبقى إتمامها يدوياً للمدير حصراً.
 */

export type ToolLink = { title: string; href: string };
export type ReadToolResult = {
  summary: string;
  rows: { title: string; detail?: string; href?: string }[];
};
export type WriteToolResult = { message: string; links: ToolLink[] };
export type PreviewItem = { label: string; value: string };

/** سياق الصفحة المربوط بالمحادثة — يمرر مصادَقاً عليه من مسار المحادثة إلى تنفيذ الأدوات */
export type ToolContext = { type: string; id: string };

type ReadTool = {
  name: string;
  descriptionAr: string;
  /** الصلاحية المطلوبة — تفحص عند كل تنفيذ بصلاحيات المستخدم الحالي */
  permission: string;
  args: z.ZodTypeAny;
  readOnly: true;
  execute(user: CurrentUser, args: unknown, context?: ToolContext | null): Promise<ReadToolResult>;
};

type WriteTool = {
  name: string;
  descriptionAr: string;
  permission: string;
  args: z.ZodTypeAny;
  readOnly: false;
  /** معاينة مفصلة بنداً بنداً تعرض على المستخدم قبل أي تنفيذ */
  buildPreview(user: CurrentUser, args: unknown, context?: ToolContext | null): Promise<PreviewItem[]>;
  /** ينفذ فقط بعد تأكيد صريح — ويعاد فحص الصلاحية لحظة التنفيذ */
  execute(user: CurrentUser, args: unknown, context?: ToolContext | null): Promise<WriteToolResult>;
};

export type AiTool = ReadTool | WriteTool;

function requireToolPermission(user: CurrentUser, permission: string) {
  if (!user.permissions.has(permission)) {
    throw new Error(`لا تملك صلاحية «${permission}» اللازمة لهذه الأداة`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** يعيد معرف السياق فقط إذا طابق النوع المتوقع وكان UUID صالحاً — وإلا null */
function contextIdFor(context: ToolContext | null | undefined, expectedType: string): string | null {
  return context && context.type === expectedType && UUID_RE.test(context.id) ? context.id : null;
}

/** التحقق من أن معرف السياق يعود فعلاً لسجل من النوع المعلن — لا يوثق أي معرف قبل التحقق */
async function contextEntityExists(type: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  if (type === "program") return (await db.select({ id: programs.id }).from(programs).where(eq(programs.id, id)).limit(1)).length > 0;
  if (type === "meeting") return (await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, id)).limit(1)).length > 0;
  if (type === "performance") return (await db.select({ id: perfCycles.id }).from(perfCycles).where(eq(perfCycles.id, id)).limit(1)).length > 0;
  if (type === "room") return (await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, id)).limit(1)).length > 0;
  return false;
}

/**
 * ربط سياق الصفحة بوسائط الأداة على الخادم: عندما يغفل النموذج معرف السجل تملؤه المنصة
 * من السياق بعد التحقق من انتماء المعرف للنوع المعلن. المعرف الذي يقدمه النموذج صراحة
 * لا يستبدل، لكنه يتحقق منه داخل الأداة نفسها بالاستعلام في الجدول الصحيح، وتعاد
 * فحوص الصلاحية (RBAC) عند كل تنفيذ كالمعتاد.
 */
export async function bindContextToArgs(
  toolName: string,
  rawArgs: Record<string, unknown>,
  context: ToolContext | null | undefined,
): Promise<Record<string, unknown>> {
  if (!context || !UUID_RE.test(context.id)) return rawArgs;
  const args = { ...rawArgs };
  const fillIfValid = async (key: string, expectedType: string) => {
    if (!args[key] && context.type === expectedType && (await contextEntityExists(expectedType, context.id))) {
      args[key] = context.id;
    }
  };
  if (toolName === "program_brief") await fillIfValid("programId", "program");
  if (toolName === "meeting_brief") await fillIfValid("meetingId", "meeting");
  if (toolName === "room_brief") await fillIfValid("roomId", "room");
  if (toolName === "person_performance_brief" && !args.personId && context.type === "performance") {
    // سياق صفحة الأداء يحمل معرف الدورة — نستنتج الشخص من الدورة بعد التحقق من وجودها
    const [c] = await db.select({ personId: perfCycles.personId }).from(perfCycles).where(eq(perfCycles.id, context.id)).limit(1);
    if (c) args.personId = c.personId;
  }
  if (toolName === "create_maintenance_issue" && !args.roomId && !args.room) await fillIfValid("roomId", "room");
  if (toolName === "save_draft" && !args.relatedId && !args.relatedType && (await contextEntityExists(context.type, context.id))) {
    args.relatedType = context.type;
    args.relatedId = context.id;
  }
  return args;
}

const OPEN_TASK_STATUSES = ["جديدة", "قيد التنفيذ"];

// ————————————————— أدوات القراءة —————————————————

const ENTITY_CONFIG: Record<string, { permission: string; labelAr: string }> = {
  people: { permission: "people.read", labelAr: "الأشخاص" },
  programs: { permission: "plan.read", labelAr: "البرامج" },
  committees: { permission: "committees.read", labelAr: "اللجان" },
  meetings: { permission: "committees.read", labelAr: "الاجتماعات" },
  tasks: { permission: "tasks.read", labelAr: "المهام" },
  evidence: { permission: "evidence.read", labelAr: "الشواهد" },
  rooms: { permission: "building.read", labelAr: "الغرف" },
  assets: { permission: "assets.read", labelAr: "الأصول" },
  inspections: { permission: "inspections.read", labelAr: "الفحوصات" },
  documents: { permission: "documents.read", labelAr: "الوثائق" },
};

const searchRecords: ReadTool = {
  name: "search_records",
  descriptionAr:
    "البحث في سجلات المدرسة. entity واحدة من: people, programs, committees, meetings, tasks, evidence, rooms, assets, inspections, documents. query نص البحث بالعربية.",
  permission: "ai.use",
  readOnly: true,
  args: z.object({
    entity: z.enum(["people", "programs", "committees", "meetings", "tasks", "evidence", "rooms", "assets", "inspections", "documents"]),
    query: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(15).default(10),
  }),
  async execute(user, rawArgs) {
    const { entity, query, limit } = this.args.parse(rawArgs) as { entity: keyof typeof ENTITY_CONFIG; query: string; limit: number };
    requireToolPermission(user, ENTITY_CONFIG[entity].permission);
    const q = `%${query}%`;
    // سياق المساعد يستبعد السجلات الاصطناعية (مفعّل في التطوير/الإنتاج)
    const ex = await getExcludedIdSets();
    let rows: { title: string; detail?: string; href?: string }[] = [];

    if (entity === "people") {
      const r = await db.select().from(people).where(and(eq(people.active, true), notSynthetic(people.id, ex.people), or(ilike(people.fullName, q), ilike(people.jobTitle, q), ilike(people.orgUnit, q)))).limit(limit);
      rows = r.map((p) => ({ title: p.fullName, detail: `${p.category}${p.jobTitle ? ` — ${p.jobTitle}` : ""}`, href: `/people/${p.id}` }));
    } else if (entity === "programs") {
      const r = await db.select().from(programs).where(and(or(ilike(programs.name, q), ilike(programs.domain, q), ilike(programs.generalGoal, q)), notSynthetic(programs.id, ex.programs), isNull(programs.archivedAt))).limit(limit);
      rows = r.map((p) => ({ title: p.name, detail: `${p.status} — ${p.executionStatus} — الإنجاز ${p.progress}٪`, href: `/plan/${p.id}` }));
    } else if (entity === "committees") {
      const r = await db.select().from(committees).where(and(ilike(committees.nameAr, q), notSynthetic(committees.id, ex.committees))).limit(limit);
      rows = r.map((c) => ({ title: c.nameAr, detail: c.status, href: `/committees/${c.id}` }));
    } else if (entity === "meetings") {
      const r = await db
        .select({ m: meetings, committeeName: committees.nameAr })
        .from(meetings)
        .innerJoin(committees, eq(meetings.committeeId, committees.id))
        .where(and(or(ilike(meetings.title, q), ilike(committees.nameAr, q)), notSynthetic(meetings.id, ex.meetings)))
        .orderBy(desc(meetings.createdAt))
        .limit(limit);
      rows = r.map(({ m, committeeName }) => ({ title: m.title ?? `اجتماع ${committeeName} رقم ${m.seq}`, detail: `${committeeName} — ${m.status}`, href: `/committees/${m.committeeId}/meetings/${m.id}` }));
    } else if (entity === "tasks") {
      const r = await db.select().from(actionTasks).where(and(or(ilike(actionTasks.title, q), ilike(actionTasks.description, q)), notSynthetic(actionTasks.id, ex.tasks))).orderBy(desc(actionTasks.createdAt)).limit(limit);
      rows = r.map((t) => ({ title: t.title, detail: `${t.status} — أولوية ${t.priority}`, href: "/tasks" }));
    } else if (entity === "evidence") {
      const r = await db.select().from(evidenceItems).where(and(or(ilike(evidenceItems.title, q), ilike(evidenceItems.description, q)), notSynthetic(evidenceItems.id, ex.evidence))).orderBy(desc(evidenceItems.createdAt)).limit(limit);
      rows = r.map((e) => ({ title: e.title, detail: `${e.role ?? e.kind} — evidenceId=${e.id}`, href: "/evidence" }));
    } else if (entity === "rooms") {
      const r = await db.select().from(rooms).where(and(eq(rooms.active, true), or(ilike(rooms.nameAr, q), ilike(rooms.code, q), ilike(rooms.roomType, q)))).limit(limit);
      rows = r.map((rm) => ({ title: `${rm.nameAr} (${rm.code})`, detail: rm.roomType, href: `/building/rooms/${rm.id}` }));
    } else if (entity === "assets") {
      const r = await db.select().from(assets).where(and(eq(assets.active, true), or(ilike(assets.nameAr, q), ilike(assets.code, q)))).limit(limit);
      rows = r.map((a) => ({ title: `${a.nameAr} (${a.code})`, detail: a.condition, href: "/building/assets" }));
    } else if (entity === "inspections") {
      const r = await db
        .select({ ins: inspections, roomName: rooms.nameAr, roomId: rooms.id })
        .from(inspections)
        .innerJoin(rooms, eq(inspections.roomId, rooms.id))
        .where(ilike(rooms.nameAr, q))
        .orderBy(desc(inspections.inspectionDate))
        .limit(limit);
      rows = r.map(({ ins, roomName, roomId }) => ({
        title: `فحص ${roomName}`,
        detail: ins.inspectionDate.toLocaleDateString("ar-SA-u-nu-latn"),
        href: `/building/rooms/${roomId}`,
      }));
    } else if (entity === "documents") {
      const r = await db.select().from(documents).where(and(or(ilike(documents.title, q), ilike(documents.docNumber, q)), notSynthetic(documents.id, ex.documents))).orderBy(desc(documents.issuedAt)).limit(limit);
      rows = r.map((d) => ({ title: `${d.title} (${d.docNumber})`, href: "/documents" }));
    }

    return { summary: `نتائج البحث في ${ENTITY_CONFIG[entity].labelAr} عن «${query}»: ${rows.length}`, rows };
  },
};

const overduePrograms: ReadTool = {
  name: "overdue_programs",
  descriptionAr: "قائمة برامج الخطة التشغيلية المتأخرة أو غير المكتملة التي تجاوزت مراجعتها الشهر.",
  permission: "plan.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "plan.read");
    const ex = await getExcludedIdSets();
    const r = await db
      .select()
      .from(programs)
      .where(and(or(eq(programs.executionStatus, "متأخر"), and(eq(programs.status, "معتمد"), lt(programs.progress, 100), lt(programs.lastReviewAt, new Date(Date.now() - 30 * 24 * 3600 * 1000)))), notSynthetic(programs.id, ex.programs), isNull(programs.archivedAt)))
      .limit(25);
    return {
      summary: `البرامج المتأخرة أو المتوقفة عن المراجعة: ${r.length}`,
      rows: r.map((p) => ({ title: p.name, detail: `${p.executionStatus} — الإنجاز ${p.progress}٪${p.hijriEnd ? ` — النهاية ${p.hijriEnd}` : ""}`, href: `/plan/${p.id}` })),
    };
  },
};

const overdueTasks: ReadTool = {
  name: "overdue_tasks",
  descriptionAr: "المهام والإجراءات المفتوحة التي تجاوزت تاريخ استحقاقها.",
  permission: "tasks.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "tasks.read");
    const ex = await getExcludedIdSets();
    const r = await db
      .select()
      .from(actionTasks)
      .where(and(inArray(actionTasks.status, OPEN_TASK_STATUSES), lt(actionTasks.dueDate, new Date()), notSynthetic(actionTasks.id, ex.tasks)))
      .orderBy(actionTasks.dueDate)
      .limit(25);
    return {
      summary: `المهام المتأخرة: ${r.length}`,
      rows: r.map((t) => ({ title: t.title, detail: `استحقت ${t.dueDate?.toLocaleDateString("ar-SA-u-nu-latn") ?? ""} — ${t.status}${t.mandatory ? " — إجراء إلزامي" : ""}`, href: "/tasks" })),
    };
  },
};

const missingEvidence: ReadTool = {
  name: "missing_evidence",
  descriptionAr: "البرامج المعتمدة التي لم يُرفع لها أي شاهد بعد — معلوماتي فقط، بلا متطلب أو حصة أو نقص (D-025).",
  permission: "evidence.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "evidence.read");
    requireToolPermission(user, "plan.read");
    const ex = await getExcludedIdSets();
    const linked = db
      .select({ entityId: evidenceLinks.entityId })
      .from(evidenceLinks)
      .where(eq(evidenceLinks.entityType, "program"));
    const r = await db
      .select()
      .from(programs)
      .where(and(eq(programs.status, "معتمد"), notInArray(programs.id, linked), notSynthetic(programs.id, ex.programs), isNull(programs.archivedAt)))
      .limit(25);
    return {
      summary: `برامج معتمدة لم يُرفع لها أي شاهد بعد: ${r.length}`,
      rows: r.map((p) => ({ title: p.name, detail: "لم يُرفع أي شاهد بعد", href: `/plan/${p.id}#evidence` })),
    };
  },
};

const upcomingPerformanceSessions: ReadTool = {
  name: "upcoming_performance_sessions",
  descriptionAr: "دورات الأداء النشطة وجلساتها غير المكتملة — دون كشف أي درجات أو تفاصيل فردية.",
  permission: "performance.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "performance.read");
    const ex = await getExcludedIdSets();
    const r = await db
      .select({ cycle: perfCycles, personName: people.fullName, sessionCount: sql<number>`count(${perfSessions.id}) filter (where ${perfSessions.status} in ('مسودة','بانتظار التقرير الموقع'))` })
      .from(perfCycles)
      .innerJoin(people, eq(perfCycles.personId, people.id))
      .leftJoin(perfSessions, eq(perfSessions.cycleId, perfCycles.id))
      .where(and(eq(perfCycles.status, "نشطة"), notSynthetic(perfCycles.id, ex.perfCycles)))
      .groupBy(perfCycles.id, people.fullName)
      .limit(40);
    const withPending = r.filter((row) => Number(row.sessionCount) > 0);
    return {
      summary: `دورات أداء نشطة: ${r.length}، منها ${withPending.length} بجلسات غير مكتملة`,
      rows: r.map((row) => ({
        title: `${row.personName} — ${row.cycle.cycleType} ${row.cycle.yearKey}`,
        detail: `جلسات غير مكتملة: ${row.sessionCount}`,
        href: `/performance/cycles/${row.cycle.id}`,
      })),
    };
  },
};

const roomsNeedingInspection: ReadTool = {
  name: "rooms_needing_inspection",
  descriptionAr: "الغرف النشطة التي لم تفحص إطلاقاً أو مضى على آخر فحص لها أكثر من 30 يوماً.",
  permission: "inspections.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "inspections.read");
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const r = await db
      .select({ room: rooms, lastInspection: sql<Date | null>`max(${inspections.inspectionDate})` })
      .from(rooms)
      .leftJoin(inspections, eq(inspections.roomId, rooms.id))
      .where(eq(rooms.active, true))
      .groupBy(rooms.id)
      .having(sql`max(${inspections.inspectionDate}) is null or max(${inspections.inspectionDate}) < ${cutoff}`)
      .limit(40);
    return {
      summary: `غرف تحتاج فحصاً: ${r.length}`,
      rows: r.map(({ room, lastInspection }) => ({
        title: `${room.nameAr} (${room.code})`,
        detail: lastInspection ? `آخر فحص: ${new Date(lastInspection).toLocaleDateString("ar-SA-u-nu-latn")}` : "لم تفحص إطلاقاً",
        href: `/building/rooms/${room.id}`,
      })),
    };
  },
};

const openMaintenanceIssues: ReadTool = {
  name: "open_maintenance_issues",
  descriptionAr: "بلاغات الصيانة المفتوحة أو قيد الإصلاح.",
  permission: "maintenance.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "maintenance.read");
    const ex = await getExcludedIdSets();
    const r = await db
      .select({ issue: maintenanceIssues, roomName: rooms.nameAr })
      .from(maintenanceIssues)
      .leftJoin(rooms, eq(maintenanceIssues.roomId, rooms.id))
      .where(and(inArray(maintenanceIssues.status, ["مفتوح", "قيد الإصلاح"]), notSynthetic(maintenanceIssues.id, ex.maintenance)))
      .orderBy(desc(maintenanceIssues.createdAt))
      .limit(30);
    return {
      summary: `بلاغات الصيانة المفتوحة: ${r.length}`,
      rows: r.map(({ issue, roomName }) => ({
        title: `${issue.title} (${issue.code})`,
        detail: `${issue.status} — أولوية ${issue.priority}${roomName ? ` — ${roomName}` : ""}`,
        href: "/building/maintenance",
      })),
    };
  },
};

const dashboardSummary: ReadTool = {
  name: "dashboard_summary",
  descriptionAr: "شرح أرقام لوحة المتابعة: عدد البرامج وحالاتها ومتوسط الإنجاز، وأعداد المعلمين والموظفين والمهام المفتوحة والشواهد والبلاغات.",
  permission: "ai.use",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    const rows: { title: string; detail?: string; href?: string }[] = [];
    // ملخص الأرقام يستبعد السجلات الاصطناعية (مفعّل في التطوير/الإنتاج)
    const ex = await getExcludedIdSets();
    if (user.permissions.has("plan.read")) {
      const [prog] = await db
        .select({ total: sql<number>`count(*)`, approved: sql<number>`count(*) filter (where ${programs.status} = 'معتمد')`, late: sql<number>`count(*) filter (where ${programs.executionStatus} = 'متأخر')`, avg: sql<number>`coalesce(avg(${programs.progress}), 0)` })
        .from(programs)
        .where(and(notSynthetic(programs.id, ex.programs), isNull(programs.archivedAt)));
      rows.push({ title: `برامج الخطة: ${prog.total}`, detail: `المعتمد ${prog.approved} — المتأخر ${prog.late} — متوسط الإنجاز ${Math.round(Number(prog.avg))}٪`, href: "/plan" });
    }
    if (user.permissions.has("people.read")) {
      const [ppl] = await db
        .select({ teachers: sql<number>`count(*) filter (where ${people.category} = 'معلم')`, staff: sql<number>`count(*) filter (where ${people.category} = 'موظف')` })
        .from(people)
        .where(and(eq(people.active, true), notSynthetic(people.id, ex.people)));
      rows.push({ title: `المعلمون: ${ppl.teachers} — الموظفون: ${ppl.staff}`, href: "/people" });
    }
    if (user.permissions.has("tasks.read")) {
      const [t] = await db.select({ open: sql<number>`count(*)` }).from(actionTasks).where(and(inArray(actionTasks.status, OPEN_TASK_STATUSES), notSynthetic(actionTasks.id, ex.tasks)));
      rows.push({ title: `المهام المفتوحة: ${t.open}`, href: "/tasks" });
    }
    if (user.permissions.has("evidence.read")) {
      const [e] = await db.select({ total: sql<number>`count(*)` }).from(evidenceItems).where(notSynthetic(evidenceItems.id, ex.evidence));
      rows.push({ title: `الشواهد المسجلة: ${e.total}`, href: "/evidence" });
    }
    if (user.permissions.has("maintenance.read")) {
      const [m] = await db.select({ open: sql<number>`count(*)` }).from(maintenanceIssues).where(and(inArray(maintenanceIssues.status, ["مفتوح", "قيد الإصلاح"]), notSynthetic(maintenanceIssues.id, ex.maintenance)));
      rows.push({ title: `بلاغات الصيانة المفتوحة: ${m.open}`, href: "/building/maintenance" });
    }
    return { summary: "ملخص أرقام لوحة المتابعة الحالية", rows };
  },
};

// ————————————————— الأدوات السياقية (مربوطة بسجل الصفحة الحالية) —————————————————

const programBriefArgs = z.object({ programId: z.string().uuid().optional() });

const programBrief: ReadTool = {
  name: "program_brief",
  descriptionAr:
    "ملخص حالة برنامج واحد من الخطة التشغيلية: الحالة والتقدم المباشر وحالة التنفيذ وطلبات التغيير المفتوحة والمخرجات وعدد الشواهد المرتبطة. programId اختياري — يملأ تلقائياً من سياق الصفحة عند فتح المساعد من صفحة برنامج.",
  permission: "plan.read",
  readOnly: true,
  args: programBriefArgs,
  async execute(user, rawArgs, context) {
    requireToolPermission(user, "plan.read");
    const a = programBriefArgs.parse(rawArgs);
    const programId = a.programId ?? contextIdFor(context, "program");
    if (!programId) throw new Error("حدد معرف البرنامج أو افتح المساعد من صفحة البرنامج");
    const ex = await getExcludedIdSets();
    // البرامج المؤرشفة (v2.1 §A1) مستبعدة من مساعد المدير الذكي
    const [program] = await db.select().from(programs).where(and(eq(programs.id, programId), notSynthetic(programs.id, ex.programs), isNull(programs.archivedAt)));
    if (!program) throw new Error("البرنامج غير موجود");

    // البرنامج وحدة التنفيذ (D-024): التقدم مباشر من سجل البرنامج، لا من معالم/أنشطة موزونة.
    // الشواهد معلوماتية فقط (D-025): عدد فعلي بلا هدف أو جاهزية أو نقص.
    const [cr] = await db
      .select({ open: sql<number>`count(*)` })
      .from(programChangeRequests)
      .where(and(eq(programChangeRequests.programId, program.id), eq(programChangeRequests.status, "قيد الاعتماد")));
    const deliverables = await db.select().from(programDeliverables).where(eq(programDeliverables.programId, program.id));
    const [ev] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(evidenceLinks)
      .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
      .where(and(eq(evidenceLinks.entityType, "program"), eq(evidenceLinks.entityId, program.id), isNull(evidenceItems.archivedAt)));
    const evidenceCount = Number(ev?.count ?? 0);

    const rows: ReadToolResult["rows"] = [
      {
        title: `${program.seq}. ${program.name}`,
        detail: `${program.status} — التنفيذ: ${program.executionStatus} — الإنجاز ${program.progress}٪${program.hijriStart ? ` — الفترة ${program.hijriStart} إلى ${program.hijriEnd ?? "؟"}` : ""}`,
        href: `/plan/${program.id}`,
      },
      { title: `طلبات التغيير المفتوحة: ${Number(cr.open)}`, href: `/plan/${program.id}` },
      { title: `الشواهد المرتبطة: ${evidenceCount}`, href: `/plan/${program.id}#evidence` },
    ];
    for (const d of deliverables) {
      rows.push({
        title: `مخرج: ${d.mainOutput ?? d.outputType ?? "مخرج"}`,
        detail: `${d.packageStatus}${d.acceptedEvidence ? ` — الشواهد المقبولة: ${d.acceptedEvidence}` : ""}`,
      });
    }
    if (program.evidenceText) rows.push({ title: "الشواهد المطلوبة حسب الخطة (من المصدر)", detail: program.evidenceText.slice(0, 400) });

    return {
      summary: `برنامج «${program.name}»: ${program.status} — التنفيذ ${program.executionStatus} — الإنجاز ${program.progress}٪ — طلبات تغيير مفتوحة: ${Number(cr.open)} — الشواهد المرتبطة: ${evidenceCount}`,
      rows,
    };
  },
};

const meetingBriefArgs = z.object({ meetingId: z.string().uuid().optional() });

const meetingBrief: ReadTool = {
  name: "meeting_brief",
  descriptionAr:
    "المادة الكاملة لاجتماع واحد: اللجنة ورقمه وتاريخه وجدول أعماله والمناقشات والنتائج (قرار/توصية/ملاحظة) والأعضاء بأدوارهم والمرفقات المرتبطة — وهي المادة الخام لمسودة محضر تحفظ عبر save_draft بنوع «محضر اجتماع». meetingId اختياري — يملأ من سياق الصفحة.",
  permission: "committees.read",
  readOnly: true,
  args: meetingBriefArgs,
  async execute(user, rawArgs, context) {
    requireToolPermission(user, "committees.read");
    const a = meetingBriefArgs.parse(rawArgs);
    const meetingId = a.meetingId ?? contextIdFor(context, "meeting");
    if (!meetingId) throw new Error("حدد معرف الاجتماع أو افتح المساعد من صفحة الاجتماع");
    const ex = await getExcludedIdSets();
    const [row] = await db
      .select({ m: meetings, committee: committees })
      .from(meetings)
      .innerJoin(committees, eq(meetings.committeeId, committees.id))
      .where(and(eq(meetings.id, meetingId), notSynthetic(meetings.id, ex.meetings)));
    if (!row) throw new Error("الاجتماع غير موجود");
    const { m, committee } = row;
    const href = `/committees/${m.committeeId}/meetings/${m.id}`;

    const outcomes = await db.select().from(meetingOutcomes).where(eq(meetingOutcomes.meetingId, m.id)).orderBy(asc(meetingOutcomes.sortOrder));
    const members = await db
      .select({ name: people.fullName, role: committeeMembers.role, position: committeeMembers.position })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, m.committeeId))
      .orderBy(asc(committeeMembers.sortOrder));
    const attachments = await db
      .select({ e: evidenceItems })
      .from(evidenceLinks)
      .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
      .where(and(eq(evidenceLinks.entityType, "meeting"), eq(evidenceLinks.entityId, m.id)));
    const meetingFiles = await db.select().from(meetingAttachments).where(eq(meetingAttachments.meetingId, m.id)).orderBy(asc(meetingAttachments.createdAt));
    const typeName = m.typeId
      ? (await db.select({ nameAr: meetingTypes.nameAr }).from(meetingTypes).where(eq(meetingTypes.id, m.typeId)))[0]?.nameAr ?? null
      : null;

    const rows: ReadToolResult["rows"] = [
      {
        title: m.title ?? `اجتماع ${committee.nameAr} رقم ${m.seq}`,
        detail: `${committee.nameAr} — رقم ${m.seq}${typeName ? ` — نوع: ${typeName}` : ""} — ${m.status}${m.meetingDate ? ` — ${m.meetingDate.toLocaleDateString("ar-SA-u-nu-latn")}` : ""}${m.location ? ` — ${m.location}` : ""}`,
        href,
      },
    ];
    (m.agenda ?? []).forEach((item, i) => rows.push({ title: `بند ${i + 1}: ${item}` }));
    if (m.discussion) rows.push({ title: "المناقشات", detail: m.discussion.slice(0, 2000) });
    for (const o of outcomes) rows.push({ title: `${o.outcomeType}: ${o.text.slice(0, 300)}` });
    for (const mem of members) rows.push({ title: `عضو: ${mem.name}`, detail: `${mem.role}${mem.position ? ` — ${mem.position}` : ""}` });
    for (const { e } of attachments) {
      rows.push({ title: `مرفق: ${e.title}`, detail: `النوع ${e.kind} — لاستخراج نصه مرر evidenceId=${e.id} إلى attachment_text` });
    }
    for (const f of meetingFiles) {
      rows.push({ title: `مرفق اجتماع: ${f.title}`, detail: `فئة ${f.category}${f.description ? ` — ${f.description}` : ""}` });
    }

    return {
      summary: `اجتماع ${committee.nameAr} رقم ${m.seq} (${m.status})${typeName ? ` — نوع ${typeName}` : ""} — بنود جدول الأعمال: ${(m.agenda ?? []).length} — النتائج: ${outcomes.length} — الأعضاء: ${members.length} — مرفقات: ${attachments.length + meetingFiles.length}`,
      rows,
    };
  },
};

const personPerfBriefArgs = z.object({ personId: z.string().uuid().optional() });

/**
 * ملخص متابعة أداء موظف — القرار D-016 الصارم: تستبعد هذه الأداة عمداً كل الدرجات
 * والتقديرات والنتائج والأوزان (sessionResult وcoverage وperfRatings لا تستعلم إطلاقاً)
 * من أي مخرجات تصل للنموذج؛ تعرض الأنواع والمواعيد والحالات وعدد الشواهد فقط.
 */
const personPerformanceBrief: ReadTool = {
  name: "person_performance_brief",
  descriptionAr:
    "ملخص متابعة أداء موظف واحد دون أي تقديرات (تستبعد عمداً): الاسم والفئة والمسمى، الدورة النشطة، الجلسات المنعقدة (النوع والتاريخ والحالة فقط)، الجلسات الإلزامية غير المنعقدة، وعدد الشواهد المرتبطة بكل جلسة. personId اختياري — يستنتج من سياق صفحة دورة الأداء.",
  permission: "performance.read",
  readOnly: true,
  args: personPerfBriefArgs,
  async execute(user, rawArgs, context) {
    requireToolPermission(user, "performance.read");
    const a = personPerfBriefArgs.parse(rawArgs);
    let personId = a.personId ?? null;
    // سياق صفحة الأداء يحمل معرف الدورة — نستنتج منه الشخص بعد التحقق من وجود الدورة
    if (!personId) {
      const cycleId = contextIdFor(context, "performance");
      if (cycleId) {
        const [c] = await db.select({ personId: perfCycles.personId }).from(perfCycles).where(eq(perfCycles.id, cycleId)).limit(1);
        personId = c?.personId ?? null;
      }
    }
    if (!personId) throw new Error("حدد معرف الموظف أو افتح المساعد من صفحة دورة الأداء");
    const ex = await getExcludedIdSets();
    const [person] = await db.select().from(people).where(and(eq(people.id, personId), notSynthetic(people.id, ex.people)));
    if (!person) throw new Error("الشخص غير موجود");

    const [cycle] = await db
      .select()
      .from(perfCycles)
      .where(and(eq(perfCycles.personId, personId), eq(perfCycles.status, "نشطة")))
      .orderBy(desc(perfCycles.createdAt))
      .limit(1);

    const rows: ReadToolResult["rows"] = [
      { title: person.fullName, detail: `${person.category}${person.jobTitle ? ` — ${person.jobTitle}` : ""}`, href: `/people/${person.id}` },
    ];
    if (!cycle) {
      rows.push({ title: "لا دورة أداء نشطة لهذا الشخص" });
      return { summary: `«${person.fullName}» — لا دورة أداء نشطة حالياً (يعرض هذا الملخص المواعيد والحالات فقط دون أي تقديرات)`, rows };
    }
    rows.push({
      title: `الدورة النشطة: ${cycle.cycleType} ${cycle.yearKey}`,
      detail: cycle.startDate ? `من ${cycle.startDate}${cycle.endDate ? ` إلى ${cycle.endDate}` : ""}` : undefined,
      href: `/performance/cycles/${cycle.id}`,
    });

    // D-016: نستعلم النوع والتاريخ والحالة فقط — لا sessionResult ولا coverage ولا perfRatings إطلاقاً
    const sessions = await db
      .select({ id: perfSessions.id, sessionType: perfSessions.sessionType, sessionDate: perfSessions.sessionDate, status: perfSessions.status })
      .from(perfSessions)
      .where(eq(perfSessions.cycleId, cycle.id))
      .orderBy(asc(perfSessions.createdAt));

    const evidenceCounts = sessions.length
      ? await db
          .select({ entityId: evidenceLinks.entityId, n: sql<number>`count(*)` })
          .from(evidenceLinks)
          .where(and(eq(evidenceLinks.entityType, "perf_session"), inArray(evidenceLinks.entityId, sessions.map((s) => s.id))))
          .groupBy(evidenceLinks.entityId)
      : [];
    const countBySession = new Map(evidenceCounts.map((c) => [c.entityId, Number(c.n)]));

    for (const s of sessions) {
      rows.push({
        title: `جلسة ${s.sessionType}`,
        detail: `${s.status}${s.sessionDate ? ` — ${s.sessionDate}` : ""} — الشواهد المرتبطة: ${countBySession.get(s.id) ?? 0}`,
      });
    }
    const ONCE_ONLY_SESSIONS = ["تخطيط", "منتصف", "نهائي"];
    const held = new Set(sessions.map((s) => s.sessionType));
    const missingOnce = ONCE_ONLY_SESSIONS.filter((t) => !held.has(t));
    if (missingOnce.length) rows.push({ title: `جلسات إلزامية لم تنعقد بعد: ${missingOnce.join("، ")}` });

    return {
      summary: `متابعة أداء «${person.fullName}» — دورة ${cycle.cycleType} ${cycle.yearKey} — جلسات منعقدة: ${sessions.length}${missingOnce.length ? ` — لم تنعقد بعد: ${missingOnce.join("، ")}` : ""} (يعرض المواعيد والحالات فقط؛ التقديرات مستبعدة عمداً وفق القرار D-016)`,
      rows,
    };
  },
};

const roomBriefArgs = z.object({ roomId: z.string().uuid().optional() });

const roomBrief: ReadTool = {
  name: "room_brief",
  descriptionAr:
    "ملخص حالة غرفة واحدة: الاسم والرمز والنوع والأبعاد، الجاهزية المحسوبة، بلاغات الصيانة المفتوحة، وتاريخ آخر فحص. roomId اختياري — يملأ من سياق الصفحة عند فتح المساعد من صفحة غرفة.",
  permission: "building.read",
  readOnly: true,
  args: roomBriefArgs,
  async execute(user, rawArgs, context) {
    requireToolPermission(user, "building.read");
    const a = roomBriefArgs.parse(rawArgs);
    const roomId = a.roomId ?? contextIdFor(context, "room");
    if (!roomId) throw new Error("حدد معرف الغرفة أو افتح المساعد من صفحة الغرفة");
    const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId));
    if (!room) throw new Error("الغرفة غير موجودة");

    const [latestIns] = await db.select().from(inspections).where(eq(inspections.roomId, room.id)).orderBy(desc(inspections.inspectionDate)).limit(1);
    const roomAssets = await db
      .select({ condition: assets.condition, important: assets.important })
      .from(assets)
      .where(and(eq(assets.roomId, room.id), eq(assets.active, true)));
    const openIssues = await db
      .select()
      .from(maintenanceIssues)
      .where(and(eq(maintenanceIssues.roomId, room.id), inArray(maintenanceIssues.status, ["مفتوح", "قيد الإصلاح"])))
      .orderBy(desc(maintenanceIssues.createdAt));
    const [override] = await db
      .select()
      .from(readinessOverrides)
      .where(eq(readinessOverrides.roomId, room.id))
      .orderBy(desc(readinessOverrides.createdAt))
      .limit(1);
    const { readiness, source } = computeRoomReadiness({
      latestInspection: latestIns ? { results: latestIns.results ?? [] } : null,
      assets: roomAssets,
      openIssues: openIssues.length,
      override: override ? { value: override.overrideValue } : null,
    });

    const dims = room.lengthM && room.widthM ? `الأبعاد ${room.lengthM}×${room.widthM} م` : null;
    const rows: ReadToolResult["rows"] = [
      {
        title: `${room.nameAr} (${room.code})`,
        detail: [room.roomType, dims, room.areaM2 ? `المساحة ${room.areaM2} م²` : null, room.capacity ? `السعة ${room.capacity}` : null]
          .filter(Boolean)
          .join(" — "),
        href: `/building/rooms/${room.id}`,
      },
      { title: `الجاهزية: ${readiness}٪`, detail: source },
      { title: "آخر فحص", detail: latestIns ? latestIns.inspectionDate.toLocaleDateString("ar-SA-u-nu-latn") : "لم تفحص إطلاقاً" },
    ];
    for (const issue of openIssues) {
      rows.push({ title: `بلاغ ${issue.code}: ${issue.title}`, detail: `${issue.status} — أولوية ${issue.priority}`, href: "/building/maintenance" });
    }

    return {
      summary: `غرفة «${room.nameAr}» (${room.code}): الجاهزية ${readiness}٪ — بلاغات مفتوحة: ${openIssues.length} — آخر فحص: ${latestIns ? latestIns.inspectionDate.toLocaleDateString("ar-SA-u-nu-latn") : "لا يوجد"}`,
      rows,
    };
  },
};

const attachmentTextArgs = z.object({
  evidenceId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
});

const ATTACHMENT_TEXT_MAX = 8000;
const execFileAsync = promisify(execFile);

/** استخراج نص PDF عبر pdftotext (poppler) — البيانات تقرأ من جدول stored_files حصراً وتكتب لملف مؤقت يولده الخادم؛ لا مسارات من العميل أو النموذج أبداً */
async function extractPdfText(data: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "madrasa-ai-pdf-"));
  const pdfPath = path.join(dir, "in.pdf");
  try {
    await writeFile(pdfPath, data);
    const { stdout } = await execFileAsync("pdftotext", ["-enc", "UTF-8", pdfPath, "-"], {
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    throw new Error("تعذر استخراج النص من PDF — تأكد من توفر أداة pdftotext (حزمة poppler)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractStoredFileText(fileId: string, actorId: string): Promise<string> {
  const stored = await readStoredFile(fileId); // مسارات جدول stored_files فقط
  if (!stored) throw new Error("الملف غير موجود");
  const { file, data } = stored;
  if (file.mime === "application/pdf") return extractPdfText(data);
  if (file.mime.startsWith("image/")) return ocrImage({ imageBase64: data.toString("base64"), mime: file.mime, actorId });
  if (file.mime === "text/plain") return data.toString("utf8");
  throw new Error(`استخراج النص يدعم PDF والصور والنصوص فقط — نوع الملف: ${file.mime}`);
}

const attachmentText: ReadTool = {
  name: "attachment_text",
  descriptionAr:
    "استخراج النص من مرفق لتحليله (مثل استخراج القرارات والمهام منه): شاهد ملف (PDF عبر pdftotext، صورة عبر OCR محلي، نص/رابط) أو وثيقة صادرة. مرر evidenceId (يظهر في نتائج meeting_brief وsearch_records) أو documentId. بعد الاستخراج اقترح لكل قرار قابل للتنفيذ إنشاء مهمة عبر create_task.",
  permission: "evidence.read",
  readOnly: true,
  args: attachmentTextArgs,
  async execute(user, rawArgs) {
    requireToolPermission(user, "evidence.read");
    const a = attachmentTextArgs.parse(rawArgs);
    if (!a.evidenceId && !a.documentId) throw new Error("حدد evidenceId أو documentId");

    if (a.evidenceId) {
      const [ev] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, a.evidenceId));
      if (!ev) throw new Error("الشاهد غير موجود");
      let text: string;
      if (ev.kind === "text") text = ev.textContent ?? "";
      else if (ev.kind === "link") text = `رابط: ${ev.url ?? "—"}\n${ev.description ?? ""}`;
      else if (ev.kind === "file" && ev.fileId) text = await extractStoredFileText(ev.fileId, user.id);
      else throw new Error("لا ملف مرتبطاً بهذا الشاهد");
      const clipped = text.trim().slice(0, ATTACHMENT_TEXT_MAX);
      return {
        summary: `النص المستخرج من الشاهد «${ev.title}»${text.trim().length > ATTACHMENT_TEXT_MAX ? " (مقتطع للحد الأقصى)" : ""}`,
        rows: [{ title: ev.title, detail: clipped || "لا نص مستخرجاً", href: "/evidence" }],
      };
    }

    requireToolPermission(user, "documents.read");
    const [doc] = await db.select().from(documents).where(eq(documents.id, a.documentId!));
    if (!doc) throw new Error("الوثيقة غير موجودة");
    let text = "";
    if (doc.htmlSnapshot) text = doc.htmlSnapshot.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    else if (doc.pdfFileId) text = await extractStoredFileText(doc.pdfFileId, user.id);
    const clipped = text.slice(0, ATTACHMENT_TEXT_MAX);
    return {
      summary: `النص المستخرج من الوثيقة «${doc.title}» (${doc.docNumber})${text.length > ATTACHMENT_TEXT_MAX ? " (مقتطع للحد الأقصى)" : ""}`,
      rows: [{ title: `${doc.title} (${doc.docNumber})`, detail: clipped || "لا نص", href: "/documents" }],
    };
  },
};

// ————————————————— أدوات الكتابة (معاينة ثم تأكيد صريح) —————————————————

const DRAFT_KINDS = [
  "جدول أعمال",
  "محضر اجتماع",
  "قرارات وتوصيات",
  "تحديث برنامج",
  "وصف شاهد",
  "ملخص أداء",
  "خطة تحسين",
  "تقرير تنفيذي",
  "ملخص فحص",
  "أخرى",
] as const;

const saveDraftArgs = z.object({
  kind: z.enum(DRAFT_KINDS),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  relatedType: z.string().trim().max(40).optional(),
  relatedId: z.string().uuid().optional(),
});

const saveDraft: WriteTool = {
  name: "save_draft",
  descriptionAr:
    "حفظ مسودة نصية يراجعها المدير وينقلها يدوياً للسجل الرسمي. kind واحدة من: " +
    DRAFT_KINDS.join("، ") +
    ". استخدمها لمسودات جداول الأعمال والمحاضر والقرارات وتحديثات البرامج وأوصاف الشواهد وملخصات الأداء (دون أي درجات) وخطط التحسين والتقارير التنفيذية وملخصات الفحص.",
  permission: "ai.use",
  readOnly: false,
  args: saveDraftArgs,
  async buildPreview(_user, rawArgs) {
    // relatedType/relatedId يملآن تلقائياً من سياق الصفحة عند إغفالهما (bindContextToArgs)
    const a = saveDraftArgs.parse(rawArgs);
    return [
      { label: "نوع المسودة", value: a.kind },
      { label: "العنوان", value: a.title },
      { label: "المحتوى", value: a.content },
      ...(a.relatedType && a.relatedId ? [{ label: "مرتبطة بالسجل", value: `${a.relatedType}: ${a.relatedId}` }] : []),
      { label: "ملاحظة", value: "تحفظ كمسودة للمراجعة فقط — لا تمس أي سجل رسمي" },
    ];
  },
  async execute(user, rawArgs) {
    requireToolPermission(user, "ai.use");
    const a = saveDraftArgs.parse(rawArgs);
    const [row] = await db
      .insert(aiDrafts)
      .values({ userId: user.id, kind: a.kind, title: a.title, content: a.content, relatedType: a.relatedType, relatedId: a.relatedId })
      .returning();
    return { message: `حفظت مسودة «${a.title}» (${a.kind}) — راجعها وانقلها للسجل الرسمي يدوياً`, links: [{ title: "فتح المسودات", href: `/assistant/drafts#${row.id}` }] };
  },
};

const createTaskArgs = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["عالية", "متوسطة", "منخفضة"]).default("متوسطة"),
  dueDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD").optional(),
  ownerText: z.string().trim().max(120).optional(),
});

const createTask: WriteTool = {
  name: "create_task",
  descriptionAr: "إنشاء مهمة عادية جديدة في سجل المهام والإجراءات (ليست إجراء لجنة إلزامياً).",
  permission: "tasks.write",
  readOnly: false,
  args: createTaskArgs,
  async buildPreview(_user, rawArgs) {
    const a = createTaskArgs.parse(rawArgs);
    return [
      { label: "الإجراء", value: "إنشاء مهمة جديدة" },
      { label: "العنوان", value: a.title },
      ...(a.description ? [{ label: "الوصف", value: a.description }] : []),
      { label: "الأولوية", value: a.priority },
      ...(a.dueDateIso ? [{ label: "تاريخ الاستحقاق", value: a.dueDateIso }] : []),
      ...(a.ownerText ? [{ label: "المكلف", value: a.ownerText }] : []),
    ];
  },
  async execute(user, rawArgs) {
    requireToolPermission(user, "tasks.write");
    const a = createTaskArgs.parse(rawArgs);
    const [row] = await db
      .insert(actionTasks)
      .values({
        title: a.title,
        description: a.description,
        priority: a.priority,
        dueDate: a.dueDateIso ? new Date(`${a.dueDateIso}T12:00:00+03:00`) : null,
        ownerText: a.ownerText,
        sourceType: "ai_assistant",
        createdBy: user.id,
      })
      .returning();
    return { message: `أنشئت المهمة «${row.title}»`, links: [{ title: "فتح المهام", href: "/tasks" }] };
  },
};

const createIssueArgs = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["عالية", "متوسطة", "منخفضة"]).default("متوسطة"),
  room: z.string().trim().max(120).optional(),
  /** معرف الغرفة مباشرة — يملأ تلقائياً من سياق صفحة الغرفة عند إغفاله مع room */
  roomId: z.string().uuid().optional(),
});

async function resolveRoomByQuery(roomQuery: string | undefined) {
  if (!roomQuery) return null;
  const [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.active, true), or(ilike(rooms.code, `%${roomQuery}%`), ilike(rooms.nameAr, `%${roomQuery}%`))))
    .limit(1);
  return room ?? null;
}

/** حل الغرفة: roomId الصريح أولاً (يتحقق منه بالجدول)، ثم البحث النصي، ثم سياق صفحة الغرفة */
async function resolveIssueRoom(a: { roomId?: string; room?: string }, context?: ToolContext | null) {
  const roomId = a.roomId ?? (!a.room ? contextIdFor(context, "room") : null);
  if (roomId) {
    const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    return room ?? null;
  }
  return resolveRoomByQuery(a.room);
}

const createMaintenanceIssue: WriteTool = {
  name: "create_maintenance_issue",
  descriptionAr:
    "إنشاء بلاغ صيانة جديد، ويمكن ربطه بغرفة عبر roomId (يملأ تلقائياً من سياق صفحة الغرفة) أو عبر رمزها (مثل KHS-RM-0001) أو اسمها في room.",
  permission: "maintenance.write",
  readOnly: false,
  args: createIssueArgs,
  async buildPreview(_user, rawArgs, context) {
    const a = createIssueArgs.parse(rawArgs);
    const room = await resolveIssueRoom(a, context);
    return [
      { label: "الإجراء", value: "إنشاء بلاغ صيانة" },
      { label: "العنوان", value: a.title },
      ...(a.description ? [{ label: "الوصف", value: a.description }] : []),
      { label: "الأولوية", value: a.priority },
      {
        label: "الغرفة",
        value: room
          ? `${room.nameAr} (${room.code})`
          : a.roomId
            ? "معرف الغرفة غير صالح — سيسجل البلاغ دون غرفة"
            : a.room
              ? `لم يعثر على غرفة تطابق «${a.room}» — سيسجل البلاغ دون غرفة`
              : "دون غرفة محددة",
      },
    ];
  },
  async execute(user, rawArgs, context) {
    requireToolPermission(user, "maintenance.write");
    const a = createIssueArgs.parse(rawArgs);
    const room = await resolveIssueRoom(a, context);
    const { nextMaintenanceCode } = await import("@/lib/building/codes");
    const code = await nextMaintenanceCode();
    const [row] = await db
      .insert(maintenanceIssues)
      .values({ code, title: a.title, description: a.description, priority: a.priority, roomId: room?.id ?? null, reportedBy: user.id })
      .returning();
    return {
      message: `سجل بلاغ الصيانة ${row.code} — «${row.title}»`,
      links: [
        { title: "فتح بلاغات الصيانة", href: "/building/maintenance" },
        ...(room ? [{ title: `غرفة ${room.nameAr}`, href: `/building/rooms/${room.id}` }] : []),
      ],
    };
  },
};

const emailDraftArgs = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  to: z.string().trim().email().optional(),
});

const createEmailDraft: WriteTool = {
  name: "create_email_draft",
  descriptionAr:
    "إنشاء مسودة بريد إلكتروني (لا يرسل أبداً): إن كان تكامل Microsoft 365 مفعلاً تنشأ المسودة في بريد المدير ليراجعها ويرسلها بنفسه، وإلا تحفظ كمسودة نصية مع رابط mailto.",
  permission: "ai.use",
  readOnly: false,
  args: emailDraftArgs,
  async buildPreview(_user, rawArgs) {
    const a = emailDraftArgs.parse(rawArgs);
    return [
      { label: "الإجراء", value: m365Enabled() ? "إنشاء مسودة في بريد Microsoft 365 (دون إرسال)" : "حفظ مسودة بريد نصية (تكامل M365 غير مفعل)" },
      ...(a.to ? [{ label: "إلى", value: a.to }] : []),
      { label: "الموضوع", value: a.subject },
      { label: "النص", value: a.body },
      { label: "ملاحظة", value: "الإرسال النهائي يبقى يدوياً للمدير حصراً" },
    ];
  },
  async execute(user, rawArgs) {
    requireToolPermission(user, "ai.use");
    const a = emailDraftArgs.parse(rawArgs);
    if (m365Enabled()) {
      const bodyHtml = a.body.split("\n").map((l) => `<p dir="rtl">${l}</p>`).join("");
      const { webLink } = await createDraftEmail({ to: a.to, subject: a.subject, bodyHtml, actorId: user.id });
      return {
        message: "أنشئت مسودة البريد في صندوقك — راجعها وأرسلها بنفسك",
        links: webLink ? [{ title: "فتح المسودة في البريد", href: webLink }] : [],
      };
    }
    const [row] = await db
      .insert(aiDrafts)
      .values({ userId: user.id, kind: "مسودة بريد", title: a.subject, content: `إلى: ${a.to ?? "—"}\n\n${a.body}` })
      .returning();
    const mailto = `mailto:${a.to ?? ""}?subject=${encodeURIComponent(a.subject)}&body=${encodeURIComponent(a.body.slice(0, 1500))}`;
    return {
      message: "حفظت مسودة البريد — الإرسال يدوي دائماً",
      links: [
        { title: "فتح المسودات", href: `/assistant/drafts#${row.id}` },
        { title: "فتح في تطبيق البريد", href: mailto },
      ],
    };
  },
};

// ————————————————— السجل —————————————————

export const AI_TOOLS: AiTool[] = [
  searchRecords,
  overduePrograms,
  overdueTasks,
  missingEvidence,
  upcomingPerformanceSessions,
  roomsNeedingInspection,
  openMaintenanceIssues,
  dashboardSummary,
  programBrief,
  meetingBrief,
  personPerformanceBrief,
  roomBrief,
  attachmentText,
  saveDraft,
  createTask,
  createMaintenanceIssue,
  createEmailDraft,
];

export function getTool(name: string): AiTool | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}

/** وصف الأدوات للنموذج — يبنى نصياً داخل موجه النظام */
export function toolCatalogForPrompt(user: CurrentUser): string {
  return AI_TOOLS.filter((t) => t.readOnly || user.permissions.has(t.permission) || t.permission === "ai.use")
    .map((t) => {
      const shape = t.args instanceof z.ZodObject ? Object.keys((t.args as z.ZodObject<z.ZodRawShape>).shape).join(", ") : "";
      return `- ${t.name}(${shape}) ${t.readOnly ? "[قراءة]" : "[كتابة — يتطلب تأكيد المدير]"}: ${t.descriptionAr}`;
    })
    .join("\n");
}

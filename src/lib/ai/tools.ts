import "server-only";
import { and, desc, eq, gt, ilike, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  people, programs, committees, meetings, actionTasks, evidenceItems, evidenceLinks,
  rooms, assets, inspections, maintenanceIssues, documents, perfCycles, perfSessions,
  aiDrafts,
} from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { createDraftEmail, m365Enabled } from "@/lib/email/m365";

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

type ReadTool = {
  name: string;
  descriptionAr: string;
  /** الصلاحية المطلوبة — تفحص عند كل تنفيذ بصلاحيات المستخدم الحالي */
  permission: string;
  args: z.ZodTypeAny;
  readOnly: true;
  execute(user: CurrentUser, args: unknown): Promise<ReadToolResult>;
};

type WriteTool = {
  name: string;
  descriptionAr: string;
  permission: string;
  args: z.ZodTypeAny;
  readOnly: false;
  /** معاينة مفصلة بنداً بنداً تعرض على المستخدم قبل أي تنفيذ */
  buildPreview(user: CurrentUser, args: unknown): Promise<PreviewItem[]>;
  /** ينفذ فقط بعد تأكيد صريح — ويعاد فحص الصلاحية لحظة التنفيذ */
  execute(user: CurrentUser, args: unknown): Promise<WriteToolResult>;
};

export type AiTool = ReadTool | WriteTool;

function requireToolPermission(user: CurrentUser, permission: string) {
  if (!user.permissions.has(permission)) {
    throw new Error(`لا تملك صلاحية «${permission}» اللازمة لهذه الأداة`);
  }
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
    let rows: { title: string; detail?: string; href?: string }[] = [];

    if (entity === "people") {
      const r = await db.select().from(people).where(and(eq(people.active, true), or(ilike(people.fullName, q), ilike(people.jobTitle, q), ilike(people.orgUnit, q)))).limit(limit);
      rows = r.map((p) => ({ title: p.fullName, detail: `${p.category}${p.jobTitle ? ` — ${p.jobTitle}` : ""}`, href: `/people/${p.id}` }));
    } else if (entity === "programs") {
      const r = await db.select().from(programs).where(or(ilike(programs.name, q), ilike(programs.domain, q), ilike(programs.generalGoal, q))).limit(limit);
      rows = r.map((p) => ({ title: p.name, detail: `${p.status} — ${p.executionStatus} — الإنجاز ${p.progress}٪`, href: `/plan/${p.id}` }));
    } else if (entity === "committees") {
      const r = await db.select().from(committees).where(ilike(committees.nameAr, q)).limit(limit);
      rows = r.map((c) => ({ title: c.nameAr, detail: c.status, href: `/committees/${c.id}` }));
    } else if (entity === "meetings") {
      const r = await db
        .select({ m: meetings, committeeName: committees.nameAr })
        .from(meetings)
        .innerJoin(committees, eq(meetings.committeeId, committees.id))
        .where(or(ilike(meetings.title, q), ilike(committees.nameAr, q)))
        .orderBy(desc(meetings.createdAt))
        .limit(limit);
      rows = r.map(({ m, committeeName }) => ({ title: m.title ?? `اجتماع ${committeeName} رقم ${m.seq}`, detail: `${committeeName} — ${m.status}`, href: `/committees/${m.committeeId}/meetings/${m.id}` }));
    } else if (entity === "tasks") {
      const r = await db.select().from(actionTasks).where(or(ilike(actionTasks.title, q), ilike(actionTasks.description, q))).orderBy(desc(actionTasks.createdAt)).limit(limit);
      rows = r.map((t) => ({ title: t.title, detail: `${t.status} — أولوية ${t.priority}`, href: "/tasks" }));
    } else if (entity === "evidence") {
      const r = await db.select().from(evidenceItems).where(or(ilike(evidenceItems.title, q), ilike(evidenceItems.description, q))).orderBy(desc(evidenceItems.createdAt)).limit(limit);
      rows = r.map((e) => ({ title: e.title, detail: e.role ?? e.kind, href: "/evidence" }));
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
      const r = await db.select().from(documents).where(or(ilike(documents.title, q), ilike(documents.docNumber, q))).orderBy(desc(documents.issuedAt)).limit(limit);
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
    const r = await db
      .select()
      .from(programs)
      .where(or(eq(programs.executionStatus, "متأخر"), and(eq(programs.status, "معتمد"), lt(programs.progress, 100), lt(programs.lastReviewAt, new Date(Date.now() - 30 * 24 * 3600 * 1000)))))
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
    const r = await db
      .select()
      .from(actionTasks)
      .where(and(inArray(actionTasks.status, OPEN_TASK_STATUSES), lt(actionTasks.dueDate, new Date())))
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
  descriptionAr: "البرامج المعتمدة التي تتطلب شواهد حسب الخطة ولا شاهد مرتبطاً بها بعد.",
  permission: "evidence.read",
  readOnly: true,
  args: z.object({}),
  async execute(user) {
    requireToolPermission(user, "evidence.read");
    requireToolPermission(user, "plan.read");
    const linked = db
      .select({ entityId: evidenceLinks.entityId })
      .from(evidenceLinks)
      .where(eq(evidenceLinks.entityType, "program"));
    const r = await db
      .select()
      .from(programs)
      .where(and(eq(programs.status, "معتمد"), sql`${programs.evidenceText} is not null and ${programs.evidenceText} <> ''`, notInArray(programs.id, linked)))
      .limit(25);
    return {
      summary: `برامج معتمدة بلا أي شاهد مرتبط: ${r.length}`,
      rows: r.map((p) => ({ title: p.name, detail: `الشواهد المطلوبة: ${p.evidenceText?.slice(0, 120) ?? ""}`, href: `/plan/${p.id}` })),
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
    const r = await db
      .select({ cycle: perfCycles, personName: people.fullName, sessionCount: sql<number>`count(${perfSessions.id}) filter (where ${perfSessions.status} in ('مسودة','بانتظار التقرير الموقع'))` })
      .from(perfCycles)
      .innerJoin(people, eq(perfCycles.personId, people.id))
      .leftJoin(perfSessions, eq(perfSessions.cycleId, perfCycles.id))
      .where(eq(perfCycles.status, "نشطة"))
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
    const r = await db
      .select({ issue: maintenanceIssues, roomName: rooms.nameAr })
      .from(maintenanceIssues)
      .leftJoin(rooms, eq(maintenanceIssues.roomId, rooms.id))
      .where(inArray(maintenanceIssues.status, ["مفتوح", "قيد الإصلاح"]))
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
    if (user.permissions.has("plan.read")) {
      const [prog] = await db
        .select({ total: sql<number>`count(*)`, approved: sql<number>`count(*) filter (where ${programs.status} = 'معتمد')`, late: sql<number>`count(*) filter (where ${programs.executionStatus} = 'متأخر')`, avg: sql<number>`coalesce(avg(${programs.progress}), 0)` })
        .from(programs);
      rows.push({ title: `برامج الخطة: ${prog.total}`, detail: `المعتمد ${prog.approved} — المتأخر ${prog.late} — متوسط الإنجاز ${Math.round(Number(prog.avg))}٪`, href: "/plan" });
    }
    if (user.permissions.has("people.read")) {
      const [ppl] = await db
        .select({ teachers: sql<number>`count(*) filter (where ${people.category} = 'معلم')`, staff: sql<number>`count(*) filter (where ${people.category} = 'موظف')` })
        .from(people)
        .where(eq(people.active, true));
      rows.push({ title: `المعلمون: ${ppl.teachers} — الموظفون: ${ppl.staff}`, href: "/people" });
    }
    if (user.permissions.has("tasks.read")) {
      const [t] = await db.select({ open: sql<number>`count(*)` }).from(actionTasks).where(inArray(actionTasks.status, OPEN_TASK_STATUSES));
      rows.push({ title: `المهام المفتوحة: ${t.open}`, href: "/tasks" });
    }
    if (user.permissions.has("evidence.read")) {
      const [e] = await db.select({ total: sql<number>`count(*)` }).from(evidenceItems);
      rows.push({ title: `الشواهد المسجلة: ${e.total}`, href: "/evidence" });
    }
    if (user.permissions.has("maintenance.read")) {
      const [m] = await db.select({ open: sql<number>`count(*)` }).from(maintenanceIssues).where(inArray(maintenanceIssues.status, ["مفتوح", "قيد الإصلاح"]));
      rows.push({ title: `بلاغات الصيانة المفتوحة: ${m.open}`, href: "/building/maintenance" });
    }
    return { summary: "ملخص أرقام لوحة المتابعة الحالية", rows };
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
    const a = saveDraftArgs.parse(rawArgs);
    return [
      { label: "نوع المسودة", value: a.kind },
      { label: "العنوان", value: a.title },
      { label: "المحتوى", value: a.content },
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

const createMaintenanceIssue: WriteTool = {
  name: "create_maintenance_issue",
  descriptionAr: "إنشاء بلاغ صيانة جديد، ويمكن ربطه بغرفة عبر رمزها (مثل KHS-RM-0001) أو اسمها.",
  permission: "maintenance.write",
  readOnly: false,
  args: createIssueArgs,
  async buildPreview(_user, rawArgs) {
    const a = createIssueArgs.parse(rawArgs);
    const room = await resolveRoomByQuery(a.room);
    return [
      { label: "الإجراء", value: "إنشاء بلاغ صيانة" },
      { label: "العنوان", value: a.title },
      ...(a.description ? [{ label: "الوصف", value: a.description }] : []),
      { label: "الأولوية", value: a.priority },
      { label: "الغرفة", value: room ? `${room.nameAr} (${room.code})` : a.room ? `لم يعثر على غرفة تطابق «${a.room}» — سيسجل البلاغ دون غرفة` : "دون غرفة محددة" },
    ];
  },
  async execute(user, rawArgs) {
    requireToolPermission(user, "maintenance.write");
    const a = createIssueArgs.parse(rawArgs);
    const room = await resolveRoomByQuery(a.room);
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

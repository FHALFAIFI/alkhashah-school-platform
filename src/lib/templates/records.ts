import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  programs,
  planYears,
  programRisks,
  committees,
  committeeMembers,
  committeeTaskAssignments,
  meetings,
  meetingOutcomes,
  people,
  perfCycles,
  perfSessions,
  perfRatings,
  improvementPlans,
  evidenceItems,
  evidenceLinks,
  rooms,
  assets,
  financialItems,
} from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { getSchoolFinance } from "@/lib/finance/service";
import { amountOrNull } from "@/lib/finance/calc";
import { dualDisplay } from "@/lib/dates";
import { orFallback } from "@/lib/format";
import { weightedScore } from "@/lib/performance/scoring";
import type { TemplateDocType } from "./schema";
import type { RenderTable } from "./render";

/**
 * مصادر السجلات الحقيقية لمعاينة القوالب (v2.2 §E4).
 *
 * **قاعدة التفويض**: لكل نوع وثيقة صلاحية قراءة السجل الخاصة به، ولا تُغني عنها صلاحية
 * إدارة القوالب. والأهم: `load` **يعيد اشتقاق الاستعلام نفسه** الذي يبني قائمة السجلات
 * المتاحة، فالمعرّف القادم من المتصفح لا يصل إلى قراءة سجل خارج تلك القائمة (IDOR).
 * السجلات الاصطناعية مستبعدة كما في بقية أقسام المنصة.
 *
 * **لا كتابة إطلاقاً**: كل ما هنا قراءة. المعاينة لا تُصدر وثيقة ولا تُنشئ لقطة مجمّدة
 * ولا تلمس السجل.
 */

export type EligibleRecord = { id: string; label: string };

export type RecordData = {
  /** قيم العناصر النائبة — نصوص عادية تُهرَّب عند التصيير */
  values: Record<string, string>;
  /** صفوف جدول المحتوى بمفاتيح أعمدة النوع */
  table: RenderTable;
  /** وصف السجل المعروض — يظهر في شريط «معاينة» */
  recordLabel: string;
};

export type RecordSource = {
  /** الصلاحية اللازمة لقراءة هذا النوع من السجلات */
  permission: string;
  /** وصف عربي لما يُختار — يظهر فوق القائمة */
  pickerLabel: string;
  list(): Promise<EligibleRecord[]>;
  load(id: string): Promise<RecordData | null>;
};

/** أقصى عدد سجلات تُعرض في قائمة الاختيار — قائمة محدودة لا صفحة بيانات */
const PICKER_LIMIT = 50;

const dateText = (value: Date | string | null | undefined): string => {
  if (!value) return "";
  const d = dualDisplay(value, "employee");
  return d ? d.primary : "";
};

const money = (value: string | number | null | undefined): string => {
  const n = amountOrNull(value);
  return n === null ? "" : n.toLocaleString("ar-SA", { maximumFractionDigits: 2 });
};

/* ─────────────────────────── الخطة والبرامج ─────────────────────────── */

async function listPrograms(): Promise<EligibleRecord[]> {
  const excluded = await getExcludedIdSets();
  const rows = await db
    .select({ id: programs.id, seq: programs.seq, name: programs.name })
    .from(programs)
    .where(and(isNull(programs.archivedAt), notSynthetic(programs.id, excluded.programs)))
    .orderBy(asc(programs.seq))
    .limit(PICKER_LIMIT);
  return rows.map((r) => ({ id: r.id, label: `${r.seq}. ${orFallback(r.name, "بدون عنوان")}` }));
}

/** السجل المطلوب فقط إن كان ضمن المتاح — الحارس نفسه للقائمة والتحميل */
async function loadProgram(id: string) {
  const excluded = await getExcludedIdSets();
  const [row] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.id, id), isNull(programs.archivedAt), notSynthetic(programs.id, excluded.programs)));
  return row ?? null;
}

async function programOwnerName(program: typeof programs.$inferSelect): Promise<string> {
  if (program.ownerPersonId) {
    const [p] = await db.select({ fullName: people.fullName }).from(people).where(eq(people.id, program.ownerPersonId));
    if (p) return p.fullName;
  }
  return program.ownerPosition ?? "";
}

const programSource = (docType: "program_report" | "program_closure"): RecordSource => ({
  permission: "plan.read",
  pickerLabel: "اختر برنامجاً",
  list: listPrograms,
  async load(id) {
    const program = await loadProgram(id);
    if (!program) return null;
    const owner = await programOwnerName(program);
    const label = `${program.seq}. ${orFallback(program.name, "بدون عنوان")}`;
    const values: Record<string, string> = {
      program_name: orFallback(program.name, "بدون عنوان"),
      program_domain: program.domain,
      program_owner: owner,
      program_progress: `${program.progress}٪`,
      closure_date: dateText(program.closedAt),
      closure_note: program.closureNote ?? "",
    };
    const table: RenderTable =
      docType === "program_report"
        ? [
            {
              name: orFallback(program.name, "بدون عنوان"),
              domain: program.domain,
              owner,
              period: program.periodText,
              executionStatus: program.executionStatus,
              progress: `${program.progress}٪`,
            },
          ]
        : [
            { field: "البرنامج", value: orFallback(program.name, "بدون عنوان") },
            { field: "المجال", value: program.domain },
            { field: "مسؤول التنفيذ", value: owner },
            { field: "حالة التنفيذ", value: program.executionStatus },
            { field: "نسبة الإنجاز", value: `${program.progress}٪` },
            { field: "تاريخ الإقفال", value: dateText(program.closedAt) },
            { field: "ملاحظة الإقفال", value: program.closureNote },
          ];
    return { values, table, recordLabel: label };
  },
});

const riskSource: RecordSource = {
  permission: "plan.read",
  pickerLabel: "اختر سنة تخطيطية",
  async list() {
    const excluded = await getExcludedIdSets();
    const rows = await db
      .select({ id: planYears.id, nameAr: planYears.nameAr })
      .from(planYears)
      .where(notSynthetic(planYears.id, excluded.planYears))
      .orderBy(desc(planYears.createdAt))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: r.nameAr }));
  },
  async load(id) {
    const excluded = await getExcludedIdSets();
    const [year] = await db
      .select()
      .from(planYears)
      .where(and(eq(planYears.id, id), notSynthetic(planYears.id, excluded.planYears)));
    if (!year) return null;
    const risks = await db
      .select()
      .from(programRisks)
      .where(and(eq(programRisks.planYearId, id), notSynthetic(programRisks.id, excluded.risks)))
      .orderBy(asc(programRisks.code));
    return {
      values: { academic_year: year.nameAr },
      table: risks.map((r) => ({
        code: r.code,
        risk: r.risk,
        likelihood: r.likelihood,
        impact: r.impact,
        treatment: r.treatment,
        owner: r.owner,
      })),
      recordLabel: `سجل مخاطر ${year.nameAr}`,
    };
  },
};

/* ─────────────────────────── اللجان والاجتماعات ─────────────────────────── */

const committeeSource: RecordSource = {
  permission: "committees.read",
  pickerLabel: "اختر لجنة",
  async list() {
    const excluded = await getExcludedIdSets();
    const rows = await db
      .select({ id: committees.id, nameAr: committees.nameAr })
      .from(committees)
      .where(notSynthetic(committees.id, excluded.committees))
      .orderBy(asc(committees.nameAr))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: r.nameAr }));
  },
  async load(id) {
    const excluded = await getExcludedIdSets();
    const [committee] = await db
      .select()
      .from(committees)
      .where(and(eq(committees.id, id), notSynthetic(committees.id, excluded.committees)));
    if (!committee) return null;

    const members = await db
      .select({ id: committeeMembers.id, role: committeeMembers.role, fullName: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(people.id, committeeMembers.personId))
      .where(eq(committeeMembers.committeeId, id))
      .orderBy(asc(committeeMembers.sortOrder));
    const memberById = new Map(members.map((m) => [m.id, m]));
    const tasks = await db
      .select()
      .from(committeeTaskAssignments)
      .where(and(eq(committeeTaskAssignments.committeeId, id), eq(committeeTaskAssignments.excluded, false)))
      .orderBy(asc(committeeTaskAssignments.sortOrder));

    // العضو بلا مهمة يظهر أيضاً (D-027: قائمتان مستقلتان لا جدول واحد يُسقِط أحدهما)
    const assignedMemberIds = new Set(tasks.map((t) => t.assignedMemberId).filter(Boolean) as string[]);
    const table: RenderTable = [
      ...tasks.map((t) => {
        const m = t.assignedMemberId ? memberById.get(t.assignedMemberId) : undefined;
        return { member: m?.fullName ?? "", role: m?.role ?? "", task: t.title, dueText: t.notes };
      }),
      ...members
        .filter((m) => !assignedMemberIds.has(m.id))
        .map((m) => ({ member: m.fullName, role: m.role, task: "", dueText: "" })),
    ];

    return {
      values: {
        committee_name: committee.nameAr,
        member_list: members.map((m) => m.fullName).join("، "),
        task_list: tasks.map((t) => t.title).join("، "),
      },
      table,
      recordLabel: committee.nameAr,
    };
  },
};

const meetingSource: RecordSource = {
  permission: "committees.read",
  pickerLabel: "اختر اجتماعاً",
  async list() {
    const excluded = await getExcludedIdSets();
    const rows = await db
      .select({ id: meetings.id, seq: meetings.seq, title: meetings.title, committee: committees.nameAr })
      .from(meetings)
      .innerJoin(committees, eq(committees.id, meetings.committeeId))
      .where(and(notSynthetic(meetings.id, excluded.meetings), notSynthetic(committees.id, excluded.committees)))
      .orderBy(desc(meetings.createdAt))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: `${r.committee} — ${orFallback(r.title, `الاجتماع ${r.seq}`)}` }));
  },
  async load(id) {
    const excluded = await getExcludedIdSets();
    const [row] = await db
      .select({ meeting: meetings, committee: committees })
      .from(meetings)
      .innerJoin(committees, eq(committees.id, meetings.committeeId))
      .where(and(eq(meetings.id, id), notSynthetic(meetings.id, excluded.meetings), notSynthetic(committees.id, excluded.committees)));
    if (!row) return null;
    const outcomes = await db
      .select()
      .from(meetingOutcomes)
      .where(and(eq(meetingOutcomes.meetingId, id), notSynthetic(meetingOutcomes.id, excluded.outcomes)))
      .orderBy(asc(meetingOutcomes.sortOrder));
    const members = await db
      .select({ fullName: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(people.id, committeeMembers.personId))
      .where(eq(committeeMembers.committeeId, row.committee.id))
      .orderBy(asc(committeeMembers.sortOrder));
    const title = orFallback(row.meeting.title, `الاجتماع ${row.meeting.seq}`);
    return {
      values: {
        committee_name: row.committee.nameAr,
        meeting_title: title,
        meeting_date: dateText(row.meeting.meetingDate),
        member_list: members.map((m) => m.fullName).join("، "),
        recommendations: outcomes.filter((o) => o.outcomeType === "توصية").map((o) => o.text).join("، "),
      },
      table: outcomes.map((o) => ({ topic: o.outcomeType, outcome: o.text, owner: "", dueText: "" })),
      recordLabel: `${row.committee.nameAr} — ${title}`,
    };
  },
};

/* ─────────────────────────── الأداء الوظيفي ─────────────────────────── */

const perfSessionSource: RecordSource = {
  permission: "performance.individual.read",
  pickerLabel: "اختر جلسة أداء",
  async list() {
    const excluded = await getExcludedIdSets();
    const rows = await db
      .select({ id: perfSessions.id, sessionType: perfSessions.sessionType, fullName: people.fullName })
      .from(perfSessions)
      .innerJoin(perfCycles, eq(perfCycles.id, perfSessions.cycleId))
      .innerJoin(people, eq(people.id, perfCycles.personId))
      .where(and(notSynthetic(perfSessions.id, excluded.perfSessions), notSynthetic(perfCycles.id, excluded.perfCycles)))
      .orderBy(desc(perfSessions.createdAt))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: `${r.fullName} — ${r.sessionType}` }));
  },
  async load(id) {
    const excluded = await getExcludedIdSets();
    const [row] = await db
      .select({ session: perfSessions, cycle: perfCycles, person: people })
      .from(perfSessions)
      .innerJoin(perfCycles, eq(perfCycles.id, perfSessions.cycleId))
      .innerJoin(people, eq(people.id, perfCycles.personId))
      .where(
        and(
          eq(perfSessions.id, id),
          notSynthetic(perfSessions.id, excluded.perfSessions),
          notSynthetic(perfCycles.id, excluded.perfCycles),
        ),
      );
    if (!row) return null;

    const snapshot = row.cycle.modelSnapshot as { indicators?: { id: string; nameAr: string; weight: string }[] } | null;
    const ratings = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, id));
    const ratingBy = new Map(ratings.map((r) => [r.indicatorId, r]));
    const table: RenderTable = (snapshot?.indicators ?? []).map((ind) => {
      const r = ratingBy.get(ind.id);
      const weight = Number(ind.weight);
      const score = r?.rating != null ? weightedScore(r.rating, weight) : null;
      return {
        indicator: ind.nameAr,
        weight: `${weight}٪`,
        rating: r?.rating != null ? String(r.rating) : "",
        score: score != null ? `${score}٪` : "",
      };
    });

    return {
      values: {
        employee_name: row.person.fullName,
        evaluation_period: row.session.sessionType,
      },
      table,
      recordLabel: `${row.person.fullName} — ${row.session.sessionType}`,
    };
  },
};

const improvementPlanSource: RecordSource = {
  // خطط التحسين تنبثق عن دورة أداء فردية — تُقرأ بصلاحية الأداء الفردي لا بصلاحية الخطة
  permission: "performance.individual.read",
  pickerLabel: "اختر دورة تقييم",
  async list() {
    const excluded = await getExcludedIdSets();
    const rows = await db
      .select({ id: perfCycles.id, fullName: people.fullName, year: perfCycles.yearKey })
      .from(perfCycles)
      .innerJoin(people, eq(people.id, perfCycles.personId))
      .where(notSynthetic(perfCycles.id, excluded.perfCycles))
      .orderBy(desc(perfCycles.createdAt))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: `${r.fullName} — ${orFallback(r.year, "بلا سنة")}` }));
  },
  async load(id) {
    const excluded = await getExcludedIdSets();
    const [row] = await db
      .select({ cycle: perfCycles, person: people })
      .from(perfCycles)
      .innerJoin(people, eq(people.id, perfCycles.personId))
      .where(and(eq(perfCycles.id, id), notSynthetic(perfCycles.id, excluded.perfCycles)));
    if (!row) return null;
    const plans = await db
      .select()
      .from(improvementPlans)
      .where(eq(improvementPlans.cycleId, id))
      .orderBy(desc(improvementPlans.createdAt));
    return {
      values: { employee_name: row.person.fullName, academic_year: row.cycle.yearKey },
      table: plans.map((p) => ({ title: p.title, goals: p.goals, actions: p.actions, status: p.status })),
      recordLabel: `${row.person.fullName} — خطط التحسين`,
    };
  },
};

/* ─────────────────────────── الشواهد والمبنى ─────────────────────────── */

const evidenceSource: RecordSource = {
  permission: "evidence.read",
  pickerLabel: "اختر برنامجاً لعرض شواهده",
  list: listPrograms,
  async load(id) {
    const program = await loadProgram(id);
    if (!program) return null;
    const excluded = await getExcludedIdSets();
    const items = await db
      .select({ item: evidenceItems })
      .from(evidenceLinks)
      .innerJoin(evidenceItems, eq(evidenceItems.id, evidenceLinks.evidenceId))
      .where(
        and(
          eq(evidenceLinks.entityType, "program"),
          eq(evidenceLinks.entityId, id),
          isNull(evidenceItems.archivedAt),
          notSynthetic(evidenceItems.id, excluded.evidence),
        ),
      )
      .orderBy(desc(evidenceItems.createdAt));
    return {
      values: { program_name: orFallback(program.name, "بدون عنوان") },
      table: items.map(({ item }) => ({
        title: item.title,
        kind: item.evidenceType ?? item.kind,
        program: orFallback(program.name, "بدون عنوان"),
        createdAt: dateText(item.createdAt),
      })),
      recordLabel: `شواهد: ${orFallback(program.name, "بدون عنوان")}`,
    };
  },
};

const roomSource: RecordSource = {
  permission: "building.read",
  pickerLabel: "اختر غرفة أو مرفقاً",
  async list() {
    const rows = await db
      .select({ id: rooms.id, code: rooms.code, nameAr: rooms.nameAr })
      .from(rooms)
      .where(eq(rooms.active, true))
      .orderBy(asc(rooms.code))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: `${r.code} — ${r.nameAr}` }));
  },
  async load(id) {
    const [room] = await db.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.active, true)));
    if (!room) return null;
    const roomAssets = await db
      .select()
      .from(assets)
      .where(and(eq(assets.roomId, id), eq(assets.active, true)))
      .orderBy(asc(assets.code));
    return {
      values: {},
      table: roomAssets.map((a) => ({
        name: a.nameAr,
        location: `${room.code} — ${room.nameAr}`,
        status: a.condition,
        notes: a.notes,
      })),
      recordLabel: `${room.code} — ${room.nameAr}`,
    };
  },
};

/* ─────────────────────────── المالية ─────────────────────────── */

const financialItemSource = (docType: "financial_report" | "income_expense_report"): RecordSource => ({
  permission: "budget.read",
  pickerLabel: "اختر بند صرف",
  async list() {
    const rows = await db
      .select({ id: financialItems.id, nameAr: financialItems.nameAr })
      .from(financialItems)
      .where(isNull(financialItems.archivedAt))
      .orderBy(asc(financialItems.sortOrder))
      .limit(PICKER_LIMIT);
    return rows.map((r) => ({ id: r.id, label: orFallback(r.nameAr, "بند بدون اسم") }));
  },
  async load(id) {
    const [item] = await db
      .select()
      .from(financialItems)
      .where(and(eq(financialItems.id, id), isNull(financialItems.archivedAt)));
    if (!item) return null;
    const itemName = orFallback(item.nameAr, "بند بدون اسم");

    // الحساب من خدمة المالية الموحدة — لا حساب مستقل في المعاينة (§B5)
    const finance = await getSchoolFinance();
    const line = finance.lines.find((l) => l.id === id);
    const values: Record<string, string> = {
      financial_total: money(item.allocatedAmount),
      total_income: money(finance.summary.totalIncome),
      total_expenses: money(finance.summary.totalExpenses),
      cash_balance: money(finance.summary.cashBalance),
    };

    const table: RenderTable =
      docType === "financial_report"
        ? [
            {
              item: itemName,
              allocated: money(line?.allocated ?? item.allocatedAmount),
              spent: line ? money(line.expenses) : "",
              remaining: line?.remaining === null || line?.remaining === undefined ? "" : money(line.remaining),
            },
          ]
        : [
            ...finance.income
              .filter((r) => r.financialItemId === id && !r.archivedAt)
              .map((r) => ({
                date: r.incomeDate ?? "",
                kind: "إيراد",
                item: itemName,
                description: r.source,
                amount: money(r.amount),
                invoiceNumber: "",
              })),
            ...finance.expenses
              .filter((r) => r.financialItemId === id && !r.archivedAt)
              .map((r) => ({
                date: r.expenseDate ?? "",
                kind: "مصروف",
                item: itemName,
                description: r.notes ?? r.supplier,
                amount: money(r.amount),
                invoiceNumber: r.paymentReference,
              })),
          ];

    return { values, table, recordLabel: `بند: ${itemName}` };
  },
});

/**
 * السجلات المتاحة لكل نوع وثيقة. النوع غير المذكور هنا (الخطاب الرسمي العام) لا سجل له —
 * معاينته ببيانات نموذجية فقط، وهذا مذكور صراحةً في الواجهة لا مسكوت عنه.
 */
export const RECORD_SOURCES: Partial<Record<TemplateDocType, RecordSource>> = {
  program_report: programSource("program_report"),
  program_closure: programSource("program_closure"),
  financial_report: financialItemSource("financial_report"),
  income_expense_report: financialItemSource("income_expense_report"),
  committee_assignment: committeeSource,
  committee_minutes: meetingSource,
  council_minutes: meetingSource,
  employee_performance_report: perfSessionSource,
  final_evaluation_report: perfSessionSource,
  evidence_report: evidenceSource,
  building_report: roomSource,
  risk_report: riskSource,
  external_evaluation_report: improvementPlanSource,
};

export function recordSourceFor(docType: TemplateDocType): RecordSource | null {
  return RECORD_SOURCES[docType] ?? null;
}

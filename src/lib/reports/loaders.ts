import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  programs,
  programClosureHistory,
  programEditHistory,
  programRisks,
  programKpis,
  programFollowups,
  planSwotItems,
  planYears,
  actionTasks,
  calendarEvents,
  feedback,
  evidenceItems,
  evidenceLinks,
  storedFiles,
  budgetIncome,
  budgetExpenses,
  financialItems,
  perfSessions,
  perfCycles,
  people,
  committees,
  committeeMembers,
  committeeTaskAssignments,
  meetings,
  meetingTypes,
  meetingAttachments,
  meetingOutcomes,
  rooms,
  floors,
  facilityChecklist,
  maintenanceIssues,
  assets,
  improvementPlans,
  documents,
  importBatches,
  importRows,
  auditLog,
  users,
} from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { getSchoolFinance } from "@/lib/finance/service";
import { amountOrNull, toMinor, fromMinor } from "@/lib/finance/calc";
import { ALLOCATION_NONE_VALUE, REMAINING_UNAVAILABLE } from "@/lib/finance/allocation";
import { normalizeWeeklyStatus } from "@/lib/plan/followup";
import { TASK_STATUS_UNSET_LABEL } from "@/lib/committees/task-status";
import { programLifecycle } from "@/lib/plan/lifecycle";
import { programsEvidenceSummary } from "@/lib/plan/program-service";
import { hijriTextToIso } from "@/lib/dates";
import { type ReportRow, reportByKey, isSortableColumn } from "./catalog";
import { type ReportFilters, type FilterFlag, DEFAULT_LOW_THRESHOLD } from "./filters";
import { clampPage, clampPageSize, MAX_EXPORT_ROWS } from "./export-safety";

/**
 * محمّلات بيانات التقارير (v2.2 §D) — الطرف الخادمي لسجل `./catalog`.
 *
 * كل محمّل يعيد صفوفاً مسطّحة جاهزة للعرض والتصدير. لا صفوف قاعدة بيانات خام تُعاد كما
 * هي: تُختار الأعمدة صراحةً فلا يتسرّب حقل حسّاس (كلمة مرور، رمز جلسة، مسار تخزين) إلى
 * جدول أو ملف مُصدَّر.
 *
 * الترشيح والترتيب وتقسيم الصفحات تُطبَّق هنا على الخادم، والترتيب مقيَّد بقائمة بيضاء من
 * أعمدة التقرير نفسه فلا يمر اسم عمود عشوائي من عنوان URL.
 */

export type LoadedReport = { rows: ReportRow[]; total: number };

/** نص عربي آمن للبحث الجزئي — يُهرَّب محرف البدل حتى لا يغيّر المستخدم دلالة النمط */
function likeTerm(search: string): string {
  return `%${search.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * تنسيق تاريخ للعرض بلا اعتماد على منطقة زمنية متغيّرة.
 *
 * يقبل `Date` و`string` معاً عن قصد: أعمدة `timestamp` العادية تعود كـ`Date` من drizzle،
 * بينما الدوال المجمَّعة (`max(created_at)`) تعود **نصاً** من سائق Postgres. توحيد المعالجة
 * هنا يمنع سقوط التقرير عند وجود بيانات فعلية (لا يظهر الخلل على جدول فارغ لأن `max`
 * تعيد null حينها).
 */
function isoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** ترتيب وتقسيم صفحات في الذاكرة — للتقارير المجمَّعة أو المدمَجة من مصدرين */
function paginate(rows: ReportRow[], filters: ReportFilters, reportKey: string): LoadedReport {
  const sortKey = filters.sort && isSortableColumn(reportKey, filters.sort) ? filters.sort : null;
  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        // القيم الفارغة تُدفع إلى النهاية دائماً فلا يفسد الترتيب بحقل اختياري غير مُدخل
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "ar");
        return filters.dir === "desc" ? -cmp : cmp;
      })
    : rows;
  const page = clampPage(filters.page ?? 1);
  const pageSize = clampPageSize(filters.pageSize);
  return { rows: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length };
}

/* ───────────────── أدوات الترشيح الموحّدة (v2.5.0 §3) ───────────────── */

/**
 * «واحد أو عدّة أو الكل» بمعنى واحد في كل التقارير (§3.3): المصفوفة الفارغة أو الغائبة
 * تعني **الكل**، وأي قيمة أخرى تعني الانتماء إلى المجموعة. تُطبَّق في الذاكرة للتقارير
 * المجمَّعة، وبـ`inArray` للاستعلامات المباشرة — بالدلالة نفسها.
 */
export function matchesMulti(value: string | null | undefined, selected: string[] | undefined): boolean {
  if (!selected || selected.length === 0) return true;
  return value !== null && value !== undefined && selected.includes(value);
}

/** مرشّح `IN` اختياري — يُسقَط تماماً حين لا يُحدَّد شيء فلا يضيف شرطاً بلا داعٍ */
function inArrayIf(column: AnyColumn, selected: string[] | undefined): SQL | undefined {
  return selected && selected.length > 0 ? inArray(column, selected) : undefined;
}

/** هل طُلبت هذه العلامة؟ */
function hasFlag(filters: ReportFilters, flag: FilterFlag): boolean {
  return Boolean(filters.flags?.includes(flag));
}

/** مدى عددي مغلق الطرفين — أي طرف غائب يعني «بلا حد» */
function inRange(value: number | null | undefined, min: number | undefined, max: number | undefined): boolean {
  if (min === undefined && max === undefined) return true;
  if (value === null || value === undefined) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/** بحث نصّي حرّ على عدة حقول — يكفي تطابق واحد */
function textMatches(term: string | undefined, ...fields: (string | null | undefined)[]): boolean {
  if (!term) return true;
  const needle = term.trim();
  if (!needle) return true;
  return fields.some((f) => (f ?? "").includes(needle));
}

/** مرشّح مدى تاريخي على عمود نصي بصيغة ISO */
function dateRangeText(column: AnyColumn, filters: ReportFilters): SQL[] {
  const parts: SQL[] = [];
  if (filters.dateFrom) parts.push(gte(column, filters.dateFrom));
  if (filters.dateTo) parts.push(lte(column, filters.dateTo));
  return parts;
}

/** مرشّح مدى تاريخي على عمود timestamp */
function dateRangeTs(column: AnyColumn, filters: ReportFilters): SQL[] {
  const parts: SQL[] = [];
  if (filters.dateFrom) parts.push(gte(column, new Date(filters.dateFrom)));
  if (filters.dateTo) parts.push(lte(column, new Date(`${filters.dateTo}T23:59:59.999Z`)));
  return parts;
}

/* ────────────────────────────── الخطة والبرامج ────────────────────────────── */

async function loadPrograms(filters: ReportFilters, mode: "active" | "completed" | "closed" | "archived" | "reopened"): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const where: (SQL | undefined)[] = [notSynthetic(programs.id, excluded.programs)];

  if (mode === "active") where.push(isNull(programs.archivedAt), isNull(programs.closedAt));
  if (mode === "completed") where.push(isNull(programs.archivedAt), isNull(programs.closedAt), isNotNull(programs.completedAt), ...dateRangeTs(programs.completedAt, filters));
  if (mode === "closed") where.push(isNotNull(programs.closedAt), ...dateRangeTs(programs.closedAt, filters));
  if (mode === "archived") where.push(isNotNull(programs.archivedAt), ...dateRangeTs(programs.archivedAt, filters));
  if (mode === "reopened") where.push(isNotNull(programs.reopenedAt), ...dateRangeTs(programs.reopenedAt, filters));

  if (filters.search) where.push(or(ilike(programs.name, likeTerm(filters.search)), ilike(programs.domain, likeTerm(filters.search))));
  if (filters.status) where.push(eq(programs.status, filters.status));

  const rows = await db.select().from(programs).where(and(...where)).orderBy(asc(programs.seq));
  return rows.map((p) => ({
    seq: p.seq,
    name: p.name,
    domain: p.domain,
    owner: p.ownerPosition,
    progress: p.progress,
    executionStatus: p.executionStatus,
    status: p.status,
    completedAt: isoDate(p.completedAt),
    completionNote: p.completionNote,
    closedAt: isoDate(p.closedAt),
    closureNote: p.closureNote,
    archivedAt: isoDate(p.archivedAt),
    archivedReason: p.archivedReason,
    reopenedAt: isoDate(p.reopenedAt),
  }));
}

async function loadClosureHistory(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(programClosureHistory.at, filters)];
  if (filters.search) where.push(ilike(programs.name, likeTerm(filters.search)));

  const rows = await db
    .select({
      programName: programs.name,
      action: programClosureHistory.action,
      fromStatus: programClosureHistory.fromStatus,
      toStatus: programClosureHistory.toStatus,
      at: programClosureHistory.at,
      note: programClosureHistory.note,
      actor: users.displayName,
    })
    .from(programClosureHistory)
    .innerJoin(programs, eq(programClosureHistory.programId, programs.id))
    .leftJoin(users, eq(programClosureHistory.actorId, users.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(programClosureHistory.at));
  return rows.map((r) => ({ ...r, at: isoDate(r.at) }));
}

/**
 * v2.4 §8-9: الصفوف التفصيلية للبرامج مجمعةً بمفتاح (المجال أو المسؤول) — أسماء البرامج
 * لا أعداد فقط. لكل برنامج: الحالة الاعتمادية ودورة الحياة وحالة التنفيذ والتقدم
 * والتواريخ المخططة وعدد الشواهد ومؤشر التأخر. الإجمالي يبقى في تقرير الملخص المرافق.
 */
async function detailedProgramRows(filters: ReportFilters, groupBy: "domain" | "owner"): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const rows = await db
    .select()
    .from(programs)
    .where(and(notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt)))
    .orderBy(asc(programs.seq));
  const ids = rows.map((p) => p.id);
  const evidence = await programsEvidenceSummary(ids);
  // v2.5.0 §5.3: علامة «عُدّل بعد الاعتماد» تُشتقّ من سجل التعديلات لا من عمود حالة موازٍ
  const editedAfterApproval = await programsEditedAfterApproval(ids);
  const today = new Date().toISOString().slice(0, 10);

  const owner = (p: (typeof rows)[number]) => (p.ownerPosition ?? "").trim() || "بدون مسؤول";
  const domain = (p: (typeof rows)[number]) => (p.domain ?? "").trim() || "بدون تصنيف";

  let out = rows.map((p) => {
    const endIso = hijriTextToIso(p.hijriEnd);
    const delayed = endIso !== null && endIso < today && !p.completedAt && !p.closedAt;
    return {
      id: p.id,
      group: groupBy === "domain" ? domain(p) : owner(p),
      seq: p.seq,
      name: p.name,
      other: groupBy === "domain" ? owner(p) : domain(p),
      approval: p.status,
      lifecycle: programLifecycle(p),
      executionStatus: p.executionStatus,
      progress: p.progress,
      hijriStart: p.hijriStart,
      hijriEnd: p.hijriEnd,
      evidenceCount: evidence.get(p.id)?.count ?? 0,
      delayed: delayed ? "متأخر عن نهايته" : "",
      // §4.4: «مؤشر التعديل بعد الاعتماد» عمود مستقل يمكن اختياره في المنشئ
      editedAfterApproval: editedAfterApproval.has(p.id) ? "نعم" : "",
      _domain: domain(p),
      _owner: owner(p),
      _delayed: delayed,
    };
  });

  // «واحد أو عدّة أو الكل» على المحورين معاً — التقرير حسب المسؤول يقبل ترشيح المجال أيضاً
  out = out.filter(
    (r) =>
      matchesMulti(r._owner, filters.owners) &&
      matchesMulti(r._domain, filters.domains) &&
      matchesMulti(r.approval, filters.statuses) &&
      matchesMulti(r.id, filters.programIds) &&
      inRange(r.progress, filters.minProgress, filters.maxProgress) &&
      textMatches(filters.search, r.name, r.group, r.other),
  );

  if (hasFlag(filters, "delayed")) out = out.filter((r) => r._delayed);
  if (hasFlag(filters, "approved")) out = out.filter((r) => r.approval === "معتمد");
  if (hasFlag(filters, "notApproved")) out = out.filter((r) => r.approval !== "معتمد");
  if (hasFlag(filters, "editedAfterApproval")) out = out.filter((r) => r.editedAfterApproval === "نعم");
  if (hasFlag(filters, "hasEvidence")) out = out.filter((r) => r.evidenceCount > 0);
  if (hasFlag(filters, "noEvidence")) out = out.filter((r) => r.evidenceCount === 0);

  // التجميع: ترتيب ثابت بالمجموعة ثم تسلسل البرنامج — كل برامج المجموعة متجاورة
  const sorted = out.sort((a, b) => a.group.localeCompare(b.group, "ar") || a.seq - b.seq);
  // الحقول التقنية لا تُصدَّر ولا تُعرض
  return sorted.map(({ id: _id, _domain, _owner, _delayed, ...rest }) => rest);
}

/**
 * البرامج التي تحمل تعديلاً واحداً على الأقل سُجِّل بعد الاعتماد (§5.3).
 * المصدر هو `program_edit_history` نفسه، فلا يمكن للعلامة أن تخالف السجل.
 */
async function programsEditedAfterApproval(programIds: string[]): Promise<Set<string>> {
  if (programIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ programId: programEditHistory.programId })
    .from(programEditHistory)
    .where(
      and(
        inArray(programEditHistory.programId, programIds),
        ne(programEditHistory.approvalStatusAtEdit, "مسودة"),
      ),
    );
  return new Set(rows.map((r) => r.programId));
}

async function loadProgramsByDomain(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await detailedProgramRows(filters, "domain");
  return rows.map(({ group, other, ...rest }) => ({ domain: group, owner: other, ...rest }));
}

async function loadProgramsByOwner(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await detailedProgramRows(filters, "owner");
  return rows.map(({ group, other, ...rest }) => ({ owner: group, domain: other, ...rest }));
}

/** ملخص الأعداد حسب المجال (كان `programs-by-domain` قبل v2.4) — الإجمالي يبقى متاحاً */
async function loadProgramsByDomainSummary(): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const rows = await db.select().from(programs).where(and(notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt)));
  const byDomain = new Map<string, { count: number; progressSum: number; closed: number }>();
  for (const p of rows) {
    const key = (p.domain ?? "").trim() || "بدون تصنيف";
    const cur = byDomain.get(key) ?? { count: 0, progressSum: 0, closed: 0 };
    cur.count += 1;
    cur.progressSum += p.progress;
    if (p.closedAt) cur.closed += 1;
    byDomain.set(key, cur);
  }
  return [...byDomain.entries()].map(([domain, v]) => ({
    domain,
    count: v.count,
    avgProgress: v.count ? Math.round(v.progressSum / v.count) : 0,
    closedCount: v.closed,
  }));
}

/** ملخص الأعداد حسب المسؤول (كان `programs-by-owner` قبل v2.4) */
async function loadProgramsByOwnerSummary(): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const rows = await db.select().from(programs).where(and(notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt)));
  const byOwner = new Map<string, { count: number; progressSum: number }>();
  for (const p of rows) {
    const key = (p.ownerPosition ?? "").trim() || "بدون مسؤول";
    const cur = byOwner.get(key) ?? { count: 0, progressSum: 0 };
    cur.count += 1;
    cur.progressSum += p.progress;
    byOwner.set(key, cur);
  }
  return [...byOwner.entries()].map(([owner, v]) => ({
    owner,
    count: v.count,
    avgProgress: v.count ? Math.round(v.progressSum / v.count) : 0,
  }));
}

async function loadProgramsWithoutEvidence(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const linked = await db
    .selectDistinct({ entityId: evidenceLinks.entityId })
    .from(evidenceLinks)
    .where(eq(evidenceLinks.entityType, "program"));
  const linkedIds = linked.map((l) => l.entityId);

  const where: (SQL | undefined)[] = [notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt)];
  if (linkedIds.length) where.push(sql`${programs.id} not in ${linkedIds}`);
  if (filters.search) where.push(ilike(programs.name, likeTerm(filters.search)));

  const rows = await db.select().from(programs).where(and(...where)).orderBy(asc(programs.seq));
  return rows.map((p) => ({ seq: p.seq, name: p.name, domain: p.domain, status: p.status }));
}

/* ────────────────────────────────── الشواهد ───────────────────────────────── */

async function loadEvidenceRegister(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [isNull(evidenceItems.archivedAt), ...dateRangeTs(evidenceItems.createdAt, filters)];
  if (filters.search) where.push(ilike(evidenceItems.title, likeTerm(filters.search)));

  const rows = await db.select().from(evidenceItems).where(and(...where)).orderBy(desc(evidenceItems.createdAt));
  const counts = await db
    .select({ evidenceId: evidenceLinks.evidenceId, n: sql<number>`count(*)::int` })
    .from(evidenceLinks)
    .groupBy(evidenceLinks.evidenceId);
  const linkCount = new Map(counts.map((c) => [c.evidenceId, c.n]));

  return rows.map((e) => ({
    title: e.title,
    kind: e.kind,
    evidenceType: e.evidenceType,
    evidenceDate: e.evidenceDate,
    createdAt: isoDate(e.createdAt),
    linkCount: linkCount.get(e.id) ?? 0,
  }));
}

async function loadEvidenceByType(): Promise<ReportRow[]> {
  const rows = await db
    .select({ kind: evidenceItems.kind, count: sql<number>`count(*)::int`, latest: sql<Date | null>`max(${evidenceItems.createdAt})` })
    .from(evidenceItems)
    .where(isNull(evidenceItems.archivedAt))
    .groupBy(evidenceItems.kind);
  return rows.map((r) => ({ kind: r.kind, count: r.count, latest: isoDate(r.latest) }));
}

async function loadEvidenceByProgram(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db
    .select({
      programName: programs.name,
      count: sql<number>`count(*)::int`,
      latest: sql<Date | null>`max(${evidenceItems.createdAt})`,
    })
    .from(evidenceLinks)
    .innerJoin(programs, eq(evidenceLinks.entityId, programs.id))
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(and(eq(evidenceLinks.entityType, "program"), isNull(evidenceItems.archivedAt)))
    .groupBy(programs.name);
  return rows
    .filter((r) => !filters.search || (r.programName ?? "").includes(filters.search))
    .map((r) => ({ programName: r.programName, count: r.count, latest: isoDate(r.latest) }));
}

async function loadFileTypes(): Promise<ReportRow[]> {
  const rows = await db
    .select({ mime: storedFiles.mime, count: sql<number>`count(*)::int`, totalSize: sql<number>`coalesce(sum(${storedFiles.size}),0)::bigint` })
    .from(storedFiles)
    .groupBy(storedFiles.mime);
  return rows.map((r) => ({ mime: r.mime, count: r.count, totalSize: Number(r.totalSize) }));
}

/* ───────────────────────────── المالية والميزانية ─────────────────────────── */

/** يعتمد خدمة الحساب المالية الموحّدة نفسها — لا حساب مالي ثانٍ في التقارير */
async function financeData() {
  return getSchoolFinance();
}

function inDateRange(date: string | null, filters: ReportFilters): boolean {
  if (!date) return !filters.dateFrom && !filters.dateTo;
  if (filters.dateFrom && date < filters.dateFrom) return false;
  if (filters.dateTo && date > filters.dateTo) return false;
  return true;
}

async function loadIncomeRegister(filters: ReportFilters): Promise<ReportRow[]> {
  const f = await financeData();
  return f.income
    .filter((r) => !r.archivedAt)
    .filter((r) => inDateRange(r.incomeDate, filters))
    .filter((r) => !filters.status || r.status === filters.status)
    .filter((r) => !filters.itemId || r.financialItemId === filters.itemId)
    .filter((r) => !filters.search || (r.source ?? "").includes(filters.search))
    .map((r) => ({
      source: r.source,
      amount: amountOrNull(r.amount),
      incomeDate: r.incomeDate,
      itemName: r.itemName,
      status: r.status,
      hasInvoice: r.hasInvoice ? "نعم" : "لا",
    }));
}

/**
 * v2.4 §4 · v2.4.1 §1.1: المتبقي من مخصص البند **قبل كل مصروف وبعده** — تراكمي بترتيب
 * زمني حتمي داخل كل بند (التاريخ ثم وقت الإدخال ثم المعرف). القيمتان `null` للمصروف بلا
 * بند أو لبند بلا مخصص، فلا يظهر صفر يُقرأ «نفد الرصيد».
 */
function expenseRemainingAfter(
  lines: { id: string; allocated: number | null }[],
  expenses: { id: string; amount: string | null; financialItemId: string | null; archivedAt: Date | null; expenseDate: string | null; createdAt: Date | null }[],
): Map<string, { before: number | null; after: number | null }> {
  const allocationByItem = new Map(lines.map((l) => [l.id, l.allocated]));
  const spentMinorByItem = new Map<string, number>();
  const result = new Map<string, { before: number | null; after: number | null }>();
  const sorted = expenses
    .filter((r) => !r.archivedAt)
    .slice()
    .sort((a, b) => {
      const aKey = a.expenseDate ?? "";
      const bKey = b.expenseDate ?? "";
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      const aT = a.createdAt?.getTime() ?? 0;
      const bT = b.createdAt?.getTime() ?? 0;
      if (aT !== bT) return aT - bT;
      return a.id.localeCompare(b.id);
    });
  for (const r of sorted) {
    if (!r.financialItemId) {
      result.set(r.id, { before: null, after: null });
      continue;
    }
    const allocated = allocationByItem.get(r.financialItemId) ?? null;
    const cur = spentMinorByItem.get(r.financialItemId) ?? 0;
    const next = cur + toMinor(amountOrNull(r.amount) ?? 0);
    spentMinorByItem.set(r.financialItemId, next);
    result.set(r.id, {
      before: allocated === null ? null : fromMinor(toMinor(allocated) - cur),
      after: allocated === null ? null : fromMinor(toMinor(allocated) - next),
    });
  }
  return result;
}

/**
 * سجل المصروفات (v2.5.0 §11.1).
 *
 * الترشيح: بنداً واحداً أو عدة بنود أو الكل، ومدى التاريخ، ومدى المبلغ، والمورّد ورقم
 * الفاتورة بالبحث الحر، وعلامتا «بلا مخصص» و«المتجاوزة للمخصص» على مستوى بند المصروف.
 */
async function loadExpenseRegister(filters: ReportFilters): Promise<ReportRow[]> {
  const f = await financeData();
  const remainingAfter = expenseRemainingAfter(f.lines, f.expenses);
  const lineByItem = new Map(f.lines.map((l) => [l.id, l]));

  let rows = f.expenses
    .filter((r) => !r.archivedAt)
    .filter((r) => inDateRange(r.expenseDate, filters))
    .filter((r) => matchesMulti(r.financialItemId, filters.itemIds))
    .filter((r) => inRange(amountOrNull(r.amount), filters.minAmount, filters.maxAmount))
    .filter((r) => textMatches(filters.search, r.supplier, r.paymentReference, r.itemName));

  const flags = filters.flags ?? [];
  if (flags.includes("missingAllocation")) {
    rows = rows.filter((r) => {
      const line = r.financialItemId ? lineByItem.get(r.financialItemId) : undefined;
      return !line || line.allocationState === "none";
    });
  }
  if (flags.includes("overspent")) {
    rows = rows.filter((r) => (r.financialItemId ? lineByItem.get(r.financialItemId)?.overspent : false) === true);
  }

  return rows.map((r) => {
    const line = r.financialItemId ? lineByItem.get(r.financialItemId) : undefined;
    return {
      amount: amountOrNull(r.amount),
      expenseDate: r.expenseDate,
      itemName: r.itemName ?? (r.items ? `${r.items} (تاريخي)` : null),
      paymentReference: r.paymentReference,
      supplier: r.supplier,
      hasInvoice: r.hasInvoice ? "نعم" : "لا",
      remainingBefore: remainingAfter.get(r.id)?.before ?? null,
      remainingAfter: remainingAfter.get(r.id)?.after ?? null,
      // v2.4.1 §1.1: البند بلا مخصص لا يُقال عنه «ضمن المخصص» — يُسمّى بحاله
      allocationState:
        !line || line.allocationState === "none" ? ALLOCATION_NONE_VALUE : line.overspent ? "تجاوز المخصص" : "ضمن المخصص",
    };
  });
}

/**
 * استغلال المخصصات (§11.2) — لكل بند: المخصص والمنصرف والمتبقي ونسبة الصرف وحاله.
 * يقبل بنداً أو عدة أو الكل، ومدى نسبة الصرف، وعلامتَي التجاوز وغياب المخصص.
 */
async function loadAllocationUtilization(filters: ReportFilters): Promise<ReportRow[]> {
  const f = await financeData();
  let lines = f.lines.filter((l) => matchesMulti(l.id, filters.itemIds));
  // «مدى نسبة الصرف» يُقرأ من مرشّح الإنجاز — المعنى واحد: نسبة مئوية من حدّ معلوم
  lines = lines.filter((l) => inRange(l.spentPercent, filters.minProgress, filters.maxProgress));

  const flags = filters.flags ?? [];
  if (flags.includes("overspent")) lines = lines.filter((l) => l.overspent);
  if (flags.includes("missingAllocation")) lines = lines.filter((l) => l.allocationState === "none");

  return lines.map((l) => ({
    name: l.name,
    allocated: l.allocated,
    income: l.income,
    expenses: l.expenses,
    remaining: l.remaining,
    spentPercent: l.spentPercent,
    state: l.archived
      ? "مؤرشف"
      : l.allocationState === "none"
        ? `${ALLOCATION_NONE_VALUE} — ${REMAINING_UNAVAILABLE}`
        : l.overspent
          ? "تجاوز"
          : l.nearExhaustion
            ? "قارب الاستنفاد"
            : "ضمن المخصص",
  }));
}

/** البنود بلا مخصص (§11.2) — سبب تعذّر احتساب المتبقي يُقال صراحةً */
async function loadMissingAllocation(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await loadAllocationUtilization({ ...filters, flags: ["missingAllocation"] });
  return rows;
}

async function loadItemAllocations(): Promise<ReportRow[]> {
  const f = await financeData();
  return f.lines.map((l) => ({
    name: l.name,
    allocated: l.allocated,
    income: l.income,
    expenses: l.expenses,
    remaining: l.remaining,
    spentPercent: l.spentPercent,
    // v2.4.1 §1.1: البند بلا مخصص ليس «ضمن المخصص» — يُسمّى بحاله وبسبب تعذّر الاحتساب
    state: l.archived
      ? "مؤرشف"
      : l.allocationState === "none"
        ? `${ALLOCATION_NONE_VALUE} — ${REMAINING_UNAVAILABLE}`
        : l.overspent
          ? "تجاوز"
          : l.nearExhaustion
            ? "قارب الاستنفاد"
            : "ضمن المخصص",
  }));
}

async function loadOverBudget(): Promise<ReportRow[]> {
  const f = await financeData();
  return f.lines
    .filter((l) => l.overspent && !l.archived)
    .map((l) => ({
      name: l.name,
      allocated: l.allocated,
      expenses: l.expenses,
      overrun: l.remaining === null ? null : Math.abs(l.remaining),
    }));
}

/** الإيرادات والمصروفات في سجل موحّد — أساس تقارير الفواتير وكل العمليات */
async function unifiedOperations(filters: ReportFilters) {
  const f = await financeData();
  const remainingAfter = expenseRemainingAfter(f.lines, f.expenses);
  const income = f.income
    .filter((r) => !r.archivedAt && r.status !== "ملغى")
    .map((r) => ({
      kind: "إيراد",
      amount: amountOrNull(r.amount),
      date: r.incomeDate,
      itemName: r.itemName,
      reference: r.source,
      description: r.purpose ?? r.source,
      hasInvoice: r.hasInvoice,
      remainingBefore: null as number | null,
      remainingAfter: null as number | null,
    }));
  const expenses = f.expenses
    .filter((r) => !r.archivedAt)
    .map((r) => ({
      kind: "مصروف",
      amount: amountOrNull(r.amount),
      date: r.expenseDate,
      itemName: r.itemName ?? (r.items ? `${r.items} (تاريخي)` : null),
      reference: r.paymentReference,
      description: r.notes ?? r.supplier,
      hasInvoice: r.hasInvoice,
      remainingBefore: remainingAfter.get(r.id)?.before ?? null,
      remainingAfter: remainingAfter.get(r.id)?.after ?? null,
    }));
  return [...income, ...expenses]
    .filter((r) => inDateRange(r.date, filters))
    .filter((r) => !filters.search || (r.description ?? "").includes(filters.search) || (r.reference ?? "").includes(filters.search));
}

async function loadAllOperations(filters: ReportFilters): Promise<ReportRow[]> {
  const ops = await unifiedOperations(filters);
  return ops.map((r) => ({ ...r, hasInvoice: r.hasInvoice ? "نعم" : "لا" }));
}

async function loadInvoiceReports(filters: ReportFilters, withInvoice: boolean): Promise<ReportRow[]> {
  const ops = await unifiedOperations(filters);
  return ops
    .filter((r) => r.hasInvoice === withInvoice)
    .map((r) => ({ kind: r.kind, amount: r.amount, date: r.date, itemName: r.itemName, reference: r.reference }));
}

async function loadMonthlyTrend(): Promise<ReportRow[]> {
  const f = await financeData();
  const months = new Map<string, { income: number; expenses: number }>();
  for (const r of f.monthlyIncome) months.set(r.month, { income: r.total, expenses: 0 });
  for (const r of f.monthlyExpenses) {
    const cur = months.get(r.month) ?? { income: 0, expenses: 0 };
    cur.expenses = r.total;
    months.set(r.month, cur);
  }
  return [...months.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, income: v.income, expenses: v.expenses, net: v.income - v.expenses }));
}

async function loadFinanceArchived(filters: ReportFilters): Promise<ReportRow[]> {
  const f = await financeData();
  const rows: ReportRow[] = [
    ...f.income
      .filter((r) => r.archivedAt || r.status === "ملغى")
      .map((r) => ({
        kind: "إيراد",
        amount: amountOrNull(r.amount),
        date: r.incomeDate,
        state: r.archivedAt ? "مؤرشف" : "ملغى",
      })),
    ...f.expenses
      .filter((r) => r.archivedAt)
      .map((r) => ({ kind: "مصروف", amount: amountOrNull(r.amount), date: r.expenseDate, state: "مؤرشف" })),
  ];
  return rows.filter((r) => inDateRange(r.date as string | null, filters));
}

/* ───────────────────────────── الأداء الوظيفي ─────────────────────────────── */

async function loadPerfSessions(filters: ReportFilters, mode: "planning" | "evaluations" | "incomplete" | "evidence"): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [];
  if (mode === "planning") where.push(eq(perfSessions.sessionType, "تخطيط"));
  if (mode === "evaluations") where.push(sql`${perfSessions.sessionType} <> 'تخطيط'`);
  if (mode === "incomplete") where.push(isNull(perfSessions.lockedAt));
  if (filters.personId) where.push(eq(perfCycles.personId, filters.personId));
  if (filters.status) where.push(eq(perfSessions.status, filters.status));

  const rows = await db
    .select({
      personName: people.fullName,
      cycleType: perfCycles.cycleType,
      stage: perfSessions.sessionType,
      status: perfSessions.status,
      sessionResult: perfSessions.sessionResult,
      completedAt: perfSessions.evaluationCompletedAt,
      sessionId: perfSessions.id,
    })
    .from(perfSessions)
    .innerJoin(perfCycles, eq(perfSessions.cycleId, perfCycles.id))
    .leftJoin(people, eq(perfCycles.personId, people.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(perfSessions.createdAt));

  const filtered = rows.filter((r) => !filters.search || (r.personName ?? "").includes(filters.search));

  if (mode === "evidence") {
    const ids = filtered.map((r) => r.sessionId);
    const counts = ids.length
      ? await db
          .select({ entityId: evidenceLinks.entityId, n: sql<number>`count(*)::int` })
          .from(evidenceLinks)
          .where(and(eq(evidenceLinks.entityType, "perf_session"), inArray(evidenceLinks.entityId, ids)))
          .groupBy(evidenceLinks.entityId)
      : [];
    const byId = new Map(counts.map((c) => [c.entityId, c.n]));
    return filtered.map((r) => ({
      personName: r.personName,
      stage: r.stage,
      evidenceCount: byId.get(r.sessionId) ?? 0,
      status: r.status,
    }));
  }

  if (mode === "planning") {
    // جلسة التخطيط مستثناة من احتساب المؤشرات وتُعرض دائماً «لم يبدأ التقييم بعد»
    return filtered.map((r) => ({
      personName: r.personName,
      cycleType: r.cycleType,
      stage: r.stage,
      state: "لم يبدأ التقييم بعد",
    }));
  }

  if (mode === "incomplete") {
    return filtered.map((r) => ({ personName: r.personName, cycleType: r.cycleType, stage: r.stage, status: r.status }));
  }

  return filtered.map((r) => ({
    personName: r.personName,
    cycleType: r.cycleType,
    stage: r.stage,
    status: r.status,
    sessionResult: r.sessionResult,
    completedAt: isoDate(r.completedAt),
  }));
}

/* ───────────────────────────── اللجان والاجتماعات ─────────────────────────── */

/* ─────────────── الأداء الوظيفي: النتائج والأداء المنخفض (v2.5.0 §7) ─────────────── */

/**
 * كل تقارير §7 تقرأ `lib/performance/results-service` — حساب واحد للنتيجة والفئة والعتبة.
 * الاستيراد كسول لأن الوحدة `server-only` وتجرّ خدمة التحليلات معها.
 */
async function loadPerfResults(filters: ReportFilters, mode: "results" | "low" | "narrative"): Promise<ReportRow[]> {
  const { loadEmployeeResults, effectiveThreshold, isLowPerformer } = await import("@/lib/performance/results-service");
  const threshold = effectiveThreshold(filters);
  const rows = await loadEmployeeResults(filters);

  if (mode === "low") {
    // §7.5: أسماء لا نسب مجرّدة — ومع كل اسم ما يفسّر انخفاضه وما يُقترح له
    return rows
      .filter((r) => isLowPerformer(r, threshold))
      .sort((a, b) => (a.resultPercent ?? 0) - (b.resultPercent ?? 0))
      .map((r) => ({
        personName: r.personName,
        employeeType: r.employeeType,
        jobTitle: r.jobTitle,
        yearKey: r.yearKey,
        resultPercent: r.resultPercent,
        band: r.band,
        weakCriteria: r.weakCriteria.join("، "),
        weaknesses: r.weaknesses.join(" · "),
        recommendations: r.recommendations.join(" · "),
        threshold,
      }));
  }

  if (mode === "narrative") {
    // §7.6: لا يُعرض صف بلا أي سرد — التقرير عن ما سُجّل فعلاً
    return rows
      .filter((r) => r.strengths.length + r.weaknesses.length + r.weakCriteria.length + r.recommendations.length > 0)
      .map((r) => ({
        personName: r.personName,
        employeeType: r.employeeType,
        yearKey: r.yearKey,
        strengths: r.strengths.join(" · "),
        weaknesses: r.weaknesses.join(" · "),
        weakCriteria: r.weakCriteria.join("، "),
        recommendations: r.recommendations.join(" · "),
      }));
  }

  return rows.map((r) => ({
    personName: r.personName,
    employeeType: r.employeeType,
    jobTitle: r.jobTitle,
    department: r.department,
    yearKey: r.yearKey,
    modelName: r.modelName,
    criteriaCount: r.criteriaCount,
    ratedCount: r.ratedCount,
    resultPercent: r.resultPercent,
    band: r.band,
    cycleStatus: r.cycleStatus,
    // §7.3: الغياب يُقال — لا صفر مضلّل ولا صف مخفيّ
    missingReason: r.missingReason,
    lowPerformer: isLowPerformer(r, threshold) ? `أقل من ${threshold}٪` : "",
  }));
}

/** التوزيع الإحصائي — الأعداد مبنيّة على المجموعة المرشَّحة نفسها التي تعرضها التقارير التفصيلية */
async function loadPerfDistribution(filters: ReportFilters): Promise<ReportRow[]> {
  const { loadEmployeeResults } = await import("@/lib/performance/results-service");
  const rows = await loadEmployeeResults(filters);
  const bands = new Map<string, { count: number; teachers: number; admins: number }>();
  for (const r of rows) {
    const cur = bands.get(r.band) ?? { count: 0, teachers: 0, admins: 0 };
    cur.count += 1;
    if (r.employeeType === "معلم") cur.teachers += 1;
    else cur.admins += 1;
    bands.set(r.band, cur);
  }
  return [...bands.entries()].map(([band, v]) => ({ band, count: v.count, teachers: v.teachers, admins: v.admins }));
}

async function loadCommitteeRegister(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [];
  if (filters.search) where.push(ilike(committees.nameAr, likeTerm(filters.search)));
  if (filters.status) where.push(eq(committees.status, filters.status));

  const rows = await db.select().from(committees).where(where.length ? and(...where) : undefined).orderBy(asc(committees.nameAr));
  const [memberCounts, meetingCounts] = await Promise.all([
    db.select({ id: committeeMembers.committeeId, n: sql<number>`count(*)::int` }).from(committeeMembers).groupBy(committeeMembers.committeeId),
    db.select({ id: meetings.committeeId, n: sql<number>`count(*)::int` }).from(meetings).groupBy(meetings.committeeId),
  ]);
  const members = new Map(memberCounts.map((c) => [c.id, c.n]));
  const mtgs = new Map(meetingCounts.map((c) => [c.id, c.n]));

  return rows.map((c) => ({
    nameAr: c.nameAr,
    kind: c.kind,
    status: c.status,
    memberCount: members.get(c.id) ?? 0,
    meetingCount: mtgs.get(c.id) ?? 0,
  }));
}

/**
 * v2.4 §12: صف مستقل لكل عضو — لا خلايا مدموجة. يضم دور العضو ومهامه المسندة وحالة كل
 * مهمة وفترة العضوية ونوع اللجنة وحالتها.
 */
async function loadCommitteeMembers(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [];
  if (filters.personId) where.push(eq(committeeMembers.personId, filters.personId));
  const rows = await db
    .select({
      memberId: committeeMembers.id,
      committeeName: committees.nameAr,
      committeeKind: committees.kind,
      committeeStatus: committees.status,
      personName: people.fullName,
      role: committeeMembers.role,
      position: committeeMembers.position,
      effectiveFrom: committeeMembers.effectiveFrom,
      effectiveTo: committeeMembers.effectiveTo,
    })
    .from(committeeMembers)
    .innerJoin(committees, eq(committeeMembers.committeeId, committees.id))
    .leftJoin(people, eq(committeeMembers.personId, people.id))
    .where(where.length ? and(...where) : undefined);

  const tasks = await db
    .select({
      assignedMemberId: committeeTaskAssignments.assignedMemberId,
      title: committeeTaskAssignments.title,
      status: committeeTaskAssignments.status,
      excluded: committeeTaskAssignments.excluded,
    })
    .from(committeeTaskAssignments);
  const tasksByMember = new Map<string, string[]>();
  const statusByMember = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.assignedMemberId || t.excluded) continue;
    const list = tasksByMember.get(t.assignedMemberId) ?? [];
    list.push(t.title);
    tasksByMember.set(t.assignedMemberId, list);
    const statuses = statusByMember.get(t.assignedMemberId) ?? [];
    statuses.push(t.status ?? "—");
    statusByMember.set(t.assignedMemberId, statuses);
  }

  return rows
    .filter(
      (r) => !filters.search || (r.committeeName ?? "").includes(filters.search) || (r.personName ?? "").includes(filters.search),
    )
    .map((r) => ({
      committeeName: r.committeeName,
      kind: r.committeeKind,
      committeeStatus: r.committeeStatus,
      personName: r.personName,
      role: r.role,
      position: r.position,
      membership: r.effectiveTo
        ? `${isoDate(r.effectiveFrom) ?? "—"} ← ${isoDate(r.effectiveTo)}`
        : "عضوية قائمة",
      tasks: (tasksByMember.get(r.memberId) ?? []).join("؛ ") || "—",
      taskStatuses: (statusByMember.get(r.memberId) ?? []).join("؛ ") || "—",
    }));
}

async function loadCommitteeTasks(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db
    .select({
      committeeName: committees.nameAr,
      personName: people.fullName,
      role: committeeMembers.role,
      taskText: committeeTaskAssignments.title,
      status: committeeTaskAssignments.status,
      notes: committeeTaskAssignments.notes,
      excluded: committeeTaskAssignments.excluded,
    })
    .from(committeeTaskAssignments)
    .innerJoin(committees, eq(committeeTaskAssignments.committeeId, committees.id))
    .leftJoin(committeeMembers, eq(committeeTaskAssignments.assignedMemberId, committeeMembers.id))
    .leftJoin(people, eq(committeeMembers.personId, people.id));
  return rows
    .filter((r) => !r.excluded)
    .filter((r) => !filters.search || (r.taskText ?? "").includes(filters.search) || (r.personName ?? "").includes(filters.search))
    .map((r) => ({
      committeeName: r.committeeName,
      personName: r.personName,
      role: r.role,
      taskText: r.taskText,
      status: r.status ?? "—",
      notes: r.notes,
    }));
}

/* ─────────── المجالس واللجان: الأنواع الثلاثة المتمايزة (v2.5.0 §9.1) ─────────── */

/** ترشيح اللجان المشترك — واحدة أو عدة أو الكل، بالحالة والنوع والمدة (§9.2) */
function committeeWhere(filters: ReportFilters): (SQL | undefined)[] {
  const where: (SQL | undefined)[] = [];
  if (filters.search) where.push(ilike(committees.nameAr, likeTerm(filters.search)));
  const byId = inArrayIf(committees.id, filters.committeeIds);
  if (byId) where.push(byId);
  const byStatus = inArrayIf(committees.status, filters.statuses);
  if (byStatus) where.push(byStatus);
  return where;
}

/**
 * (١) الملخص الإحصائي — أعداد فقط، بلا أسماء (§9.1).
 * منفصل عمداً عن السجل التفصيلي: خلطهما هو ما جعل التقرير السابق يبدو «أرقاماً بلا أسماء»
 * و«أسماءً بلا إجماليات» في آن واحد.
 */
async function loadCommitteeSummary(filters: ReportFilters): Promise<ReportRow[]> {
  const where = committeeWhere(filters);
  const rows = await db.select().from(committees).where(where.length ? and(...where) : undefined).orderBy(asc(committees.nameAr));
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id);

  const [memberRows, meetingRows, taskRows] = await Promise.all([
    db.select({ id: committeeMembers.committeeId }).from(committeeMembers).where(inArray(committeeMembers.committeeId, ids)),
    db.select({ id: meetings.committeeId }).from(meetings).where(inArray(meetings.committeeId, ids)),
    db
      .select({ id: committeeTaskAssignments.committeeId, status: committeeTaskAssignments.status, excluded: committeeTaskAssignments.excluded })
      .from(committeeTaskAssignments)
      .where(inArray(committeeTaskAssignments.committeeId, ids)),
  ]);

  const count = (list: { id: string }[], id: string) => list.filter((r) => r.id === id).length;
  return rows.map((c) => {
    const tasks = taskRows.filter((t) => t.id === c.id && !t.excluded);
    return {
      nameAr: c.nameAr,
      kind: c.kind,
      status: c.status,
      memberCount: count(memberRows, c.id),
      meetingCount: count(meetingRows, c.id),
      taskCount: tasks.length,
      // «منجزة» هي حالة الإنجاز المعتمدة في مفردات مهام اللجان
      completedTasks: tasks.filter((t) => t.status === "منجزة").length,
      // المهمة بلا حالة ليست متأخرة ولا منجزة — تُعد «غير محددة» ولا تُحسب إنجازاً
      unsetTasks: tasks.filter((t) => !t.status).length,
      pendingTasks: tasks.filter((t) => t.status && t.status !== "منجزة").length,
    };
  });
}

/**
 * (٢) السجل التفصيلي للمجالس واللجان (§9.3/§9.4).
 *
 * **صف واحد لكل (لجنة × عضو × مهمة).** الخلية المدموجة ممنوعة: كان العضو يظهر ومهامه
 * مجموعة في خلية واحدة مفصولة بفواصل، فيتعذّر الفرز والتصفية والقراءة في PDF. الآن
 * الترويسة كما طلبها المدير — العضو | الصفة | المهمة | حالة التنفيذ — مع اسم اللجنة في
 * العمود الأول فتبقى صفوف كل لجنة متجاورة ومعنونة.
 *
 * العضو بلا مهام يظهر بصف واحد بمهمة فارغة — لا يختفي من السجل.
 */
async function loadCommitteeRegistryDetailed(filters: ReportFilters): Promise<ReportRow[]> {
  const where = committeeWhere(filters);
  const committeeRows = await db
    .select()
    .from(committees)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(committees.nameAr));
  if (committeeRows.length === 0) return [];
  const ids = committeeRows.map((c) => c.id);

  const [memberRows, taskRows, meetingRows] = await Promise.all([
    db
      .select({
        id: committeeMembers.id,
        committeeId: committeeMembers.committeeId,
        personName: people.fullName,
        role: committeeMembers.role,
        position: committeeMembers.position,
      })
      .from(committeeMembers)
      .leftJoin(people, eq(committeeMembers.personId, people.id))
      .where(inArray(committeeMembers.committeeId, ids)),
    db
      .select({
        committeeId: committeeTaskAssignments.committeeId,
        assignedMemberId: committeeTaskAssignments.assignedMemberId,
        title: committeeTaskAssignments.title,
        status: committeeTaskAssignments.status,
        notes: committeeTaskAssignments.notes,
        excluded: committeeTaskAssignments.excluded,
      })
      .from(committeeTaskAssignments)
      .where(inArray(committeeTaskAssignments.committeeId, ids)),
    db
      .select({ committeeId: meetings.committeeId, n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(inArray(meetings.committeeId, ids))
      .groupBy(meetings.committeeId),
  ]);
  const meetingCount = new Map(meetingRows.map((m) => [m.committeeId, m.n]));
  const tasks = taskRows.filter((t) => !t.excluded);

  const out: ReportRow[] = [];
  for (const c of committeeRows) {
    const members = memberRows.filter((m) => m.committeeId === c.id);
    const committeeTasks = tasks.filter((t) => t.committeeId === c.id);
    const base = {
      committeeName: c.nameAr,
      kind: c.kind,
      committeeStatus: c.status,
      meetingCount: meetingCount.get(c.id) ?? 0,
    };

    if (members.length === 0) {
      // اللجنة بلا أعضاء تبقى في السجل بصفّها — الغياب معلومة لا فراغ
      out.push({ ...base, personName: null, role: null, taskText: null, taskStatus: null, taskNotes: null });
      continue;
    }
    for (const m of members) {
      const memberTasks = committeeTasks.filter((t) => t.assignedMemberId === m.id);
      if (memberTasks.length === 0) {
        out.push({ ...base, personName: m.personName, role: m.role ?? m.position, taskText: null, taskStatus: null, taskNotes: null });
        continue;
      }
      for (const t of memberTasks) {
        out.push({
          ...base,
          personName: m.personName,
          role: m.role ?? m.position,
          taskText: t.title,
          // §9.4: الحالة غير المحددة تُقال صراحةً ولا تُقدَّم كإنجاز
          taskStatus: t.status ?? TASK_STATUS_UNSET_LABEL,
          taskNotes: t.notes,
        });
      }
    }
    // مهام اللجنة غير المسندة لعضو — تبقى ظاهرة تحت لجنتها
    for (const t of committeeTasks.filter((t) => !t.assignedMemberId)) {
      out.push({
        ...base,
        personName: null,
        role: "غير مسندة",
        taskText: t.title,
        taskStatus: t.status ?? TASK_STATUS_UNSET_LABEL,
        taskNotes: t.notes,
      });
    }
  }

  const flags = filters.flags ?? [];
  let result = out;
  if (flags.includes("hasTasks")) result = result.filter((r) => r.taskText !== null);
  if (flags.includes("noTasks")) result = result.filter((r) => r.taskText === null);
  if (flags.includes("hasMeetings")) result = result.filter((r) => Number(r.meetingCount) > 0);
  if (flags.includes("noMeetings")) result = result.filter((r) => Number(r.meetingCount) === 0);
  if (flags.includes("incompleteTasks")) result = result.filter((r) => r.taskText !== null && r.taskStatus !== "منجزة");
  return result;
}

/**
 * (٣) سجل الاجتماعات التفصيلي (§9.6) — صف لكل اجتماع بتفاصيله الكاملة.
 * منفصل عن السجل أعلاه: الاجتماع وحدة مستقلة بحضورها وجدولها وقراراتها.
 */
async function loadMeetingsRegistryDetailed(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(meetings.meetingDate, filters)];
  const byCommittee = inArrayIf(meetings.committeeId, filters.committeeIds);
  if (byCommittee) where.push(byCommittee);
  const byStatus = inArrayIf(meetings.status, filters.statuses);
  if (byStatus) where.push(byStatus);
  if (filters.search) where.push(or(ilike(meetings.title, likeTerm(filters.search)), ilike(committees.nameAr, likeTerm(filters.search))));

  const rows = await db
    .select({ m: meetings, committeeName: committees.nameAr, kind: committees.kind, typeName: meetingTypes.nameAr })
    .from(meetings)
    .innerJoin(committees, eq(meetings.committeeId, committees.id))
    .leftJoin(meetingTypes, eq(meetings.typeId, meetingTypes.id))
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(desc(meetings.meetingDate));
  if (rows.length === 0) return [];

  const meetingIds = rows.map((r) => r.m.id);
  const [outcomes, attachments] = await Promise.all([
    db.select().from(meetingOutcomes).where(inArray(meetingOutcomes.meetingId, meetingIds)),
    db
      .select({ meetingId: meetingAttachments.meetingId, n: sql<number>`count(*)::int` })
      .from(meetingAttachments)
      .where(inArray(meetingAttachments.meetingId, meetingIds))
      .groupBy(meetingAttachments.meetingId),
  ]);
  const attachmentCount = new Map(attachments.map((a) => [a.meetingId, a.n]));

  // مالك القرار وتاريخه المستهدف وحالة تنفيذه ليست حقولاً على النتيجة: النتيجة تُحوَّل
  // إلى مهمة في `action_tasks` وهناك تُحفظ. تُقرأ من مصدرها لا تُختلق هنا.
  const taskIds = outcomes.map((o) => o.taskId).filter((v): v is string => Boolean(v));
  const taskRows = taskIds.length
    ? await db
        .select({ id: actionTasks.id, ownerText: actionTasks.ownerText, ownerName: people.fullName, status: actionTasks.status, dueDate: actionTasks.dueDate })
        .from(actionTasks)
        .leftJoin(people, eq(actionTasks.ownerPersonId, people.id))
        .where(inArray(actionTasks.id, taskIds))
    : [];
  const taskById = new Map(taskRows.map((t) => [t.id, t]));

  const textsOf = (list: typeof outcomes, kind: string) =>
    list.filter((o) => o.outcomeType === kind).map((o) => o.text).filter(Boolean).join(" · ");

  return rows.map(({ m, committeeName, kind, typeName }) => {
    const mine = outcomes.filter((o) => o.meetingId === m.id);
    const linkedTasks = mine.map((o) => (o.taskId ? taskById.get(o.taskId) : undefined)).filter(Boolean);
    return {
      committeeName,
      kind,
      // رقم الاجتماع داخل لجنته هو `seq` — لا رقم عام عبر اللجان
      meetingNumber: m.seq,
      title: m.title,
      meetingType: typeName,
      meetingDate: isoDate(m.meetingDate),
      status: m.status,
      location: m.location,
      // جدول الأعمال مصفوفة بنود — تُعرض مرقّمة لا ككائن
      agenda: (m.agenda ?? []).join(" · "),
      discussion: m.discussion,
      decisions: textsOf(mine, "قرار"),
      recommendations: textsOf(mine, "توصية"),
      notes: textsOf(mine, "ملاحظة"),
      owners: linkedTasks.map((t) => t!.ownerName ?? t!.ownerText ?? "").filter(Boolean).join(" · "),
      targetDates: linkedTasks.map((t) => isoDate(t!.dueDate) ?? "").filter(Boolean).join(" · "),
      executionStatus: linkedTasks.map((t) => t!.status).filter(Boolean).join(" · "),
      minutesSigned: m.signedMinutesFileId ? "محضر موقّع مستلم" : "لم يُستلم المحضر الموقّع",
      attachmentCount: attachmentCount.get(m.id) ?? 0,
    };
  });
}

async function loadCommitteesWithoutMeetings(): Promise<ReportRow[]> {
  const all = await db.select().from(committees);
  const withMeetings = await db.selectDistinct({ id: meetings.committeeId }).from(meetings);
  const has = new Set(withMeetings.map((m) => m.id));
  const memberCounts = await db
    .select({ id: committeeMembers.committeeId, n: sql<number>`count(*)::int` })
    .from(committeeMembers)
    .groupBy(committeeMembers.committeeId);
  const members = new Map(memberCounts.map((c) => [c.id, c.n]));
  return all
    .filter((c) => !has.has(c.id))
    .map((c) => ({ nameAr: c.nameAr, status: c.status, memberCount: members.get(c.id) ?? 0 }));
}

async function loadMeetings(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(meetings.meetingDate, filters)];
  if (filters.status) where.push(eq(meetings.status, filters.status));
  const rows = await db
    .select({
      committeeName: committees.nameAr,
      title: meetings.title,
      meetingDate: meetings.meetingDate,
      location: meetings.location,
      status: meetings.status,
      id: meetings.id,
    })
    .from(meetings)
    .innerJoin(committees, eq(meetings.committeeId, committees.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(meetings.meetingDate));
  const counts = await db
    .select({ id: meetingOutcomes.meetingId, n: sql<number>`count(*)::int` })
    .from(meetingOutcomes)
    .groupBy(meetingOutcomes.meetingId);
  const outcomeCount = new Map(counts.map((c) => [c.id, c.n]));
  return rows
    .filter((r) => !filters.search || (r.title ?? "").includes(filters.search) || (r.committeeName ?? "").includes(filters.search))
    .map((r) => ({
      committeeName: r.committeeName,
      title: r.title,
      meetingDate: isoDate(r.meetingDate),
      location: r.location,
      status: r.status,
      outcomeCount: outcomeCount.get(r.id) ?? 0,
    }));
}

async function loadDecisions(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(meetings.meetingDate, filters)];
  const rows = await db
    .select({
      committeeName: committees.nameAr,
      meetingTitle: meetings.title,
      meetingDate: meetings.meetingDate,
      outcomeText: meetingOutcomes.text,
    })
    .from(meetingOutcomes)
    .innerJoin(meetings, eq(meetingOutcomes.meetingId, meetings.id))
    .innerJoin(committees, eq(meetings.committeeId, committees.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(meetings.meetingDate));
  return rows
    .filter((r) => !filters.search || (r.outcomeText ?? "").includes(filters.search))
    .map((r) => ({ ...r, meetingDate: isoDate(r.meetingDate) }));
}

/* ───────────────────────────── المبنى والمرافق ────────────────────────────── */

async function loadRooms(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db
    .select({
      code: rooms.code,
      nameAr: rooms.nameAr,
      floorName: floors.nameAr,
      roomType: rooms.roomType,
      capacity: rooms.capacity,
      areaM2: rooms.areaM2,
      active: rooms.active,
    })
    .from(rooms)
    .leftJoin(floors, eq(rooms.floorId, floors.id))
    .orderBy(asc(rooms.code));
  return rows
    .filter((r) => !filters.search || (r.nameAr ?? "").includes(filters.search) || (r.code ?? "").includes(filters.search))
    .map((r) => ({
      code: r.code,
      nameAr: r.nameAr,
      floorName: r.floorName,
      roomType: r.roomType,
      capacity: r.capacity,
      areaM2: r.areaM2 === null ? null : Number(r.areaM2),
      status: r.active ? "نشطة" : "غير نشطة",
    }));
}

async function loadFacilities(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db.select().from(facilityChecklist).orderBy(asc(facilityChecklist.sortOrder));
  return rows
    .filter((r) => !filters.search || (r.facilityType ?? "").includes(filters.search))
    .map((r) => ({ facilityType: r.facilityType, kind: r.kind, status: r.status, requiredQty: r.requiredQty }));
}

/**
 * سجل بلاغات الصيانة (v2.5.0 §10).
 *
 * سير عمل v2.4.1 «الصيانة أولاً» لم يُمسّ — ما أُضيف هو الترشيح: الحالة والأولوية
 * والتصنيف والموقع والمسؤول والمدة، مع علامات الاعتماد والإصدار والفتح/الإغلاق وأثر
 * السلامة. كل ملاحظة فحص تبقى **بلاغاً مستقلاً** كما تقرّر في v2.4.1 — لا تجميع.
 */
async function loadMaintenance(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(maintenanceIssues.createdAt, filters)];
  const byStatus = inArrayIf(maintenanceIssues.status, filters.statuses);
  if (byStatus) where.push(byStatus);
  const byRoom = inArrayIf(maintenanceIssues.roomId, filters.roomIds);
  if (byRoom) where.push(byRoom);
  const byOwner = inArrayIf(maintenanceIssues.ownerPersonId, filters.personIds);
  if (byOwner) where.push(byOwner);

  const rows = await db
    .select({
      code: maintenanceIssues.code,
      title: maintenanceIssues.title,
      roomName: rooms.nameAr,
      floorName: floors.nameAr,
      category: maintenanceIssues.category,
      priority: maintenanceIssues.priority,
      status: maintenanceIssues.status,
      safetyImpact: maintenanceIssues.safetyImpact,
      operationalImpact: maintenanceIssues.operationalImpact,
      requestedAction: maintenanceIssues.requestedAction,
      ownerName: people.fullName,
      approvedAt: maintenanceIssues.approvedAt,
      sentTo: maintenanceIssues.sentTo,
      sentAt: maintenanceIssues.sentAt,
      documentId: maintenanceIssues.documentId,
      closedAt: maintenanceIssues.closedAt,
      fromInspection: maintenanceIssues.inspectionFindingId,
      createdAt: maintenanceIssues.createdAt,
    })
    .from(maintenanceIssues)
    .leftJoin(rooms, eq(maintenanceIssues.roomId, rooms.id))
    .leftJoin(floors, eq(rooms.floorId, floors.id))
    .leftJoin(people, eq(maintenanceIssues.ownerPersonId, people.id))
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(desc(maintenanceIssues.createdAt));

  let out = rows.filter(
    (r) =>
      textMatches(filters.search, r.title, r.code, r.roomName, r.sentTo) &&
      matchesMulti(r.category, filters.categories) &&
      matchesMulti(r.priority, filters.priorities),
  );

  const flags = filters.flags ?? [];
  if (flags.includes("approved")) out = out.filter((r) => r.approvedAt !== null);
  if (flags.includes("notApproved")) out = out.filter((r) => r.approvedAt === null);
  if (flags.includes("issued")) out = out.filter((r) => r.documentId !== null);
  if (flags.includes("notIssued")) out = out.filter((r) => r.documentId === null);
  if (flags.includes("openOnly")) out = out.filter((r) => r.closedAt === null);
  if (flags.includes("closedOnly")) out = out.filter((r) => r.closedAt !== null);
  if (flags.includes("safetyImpact")) out = out.filter((r) => (r.safetyImpact ?? "").trim() !== "");

  return out.map((r) => ({
    code: r.code,
    title: r.title,
    location: [r.floorName, r.roomName].filter(Boolean).join(" — ") || null,
    category: r.category,
    priority: r.priority,
    status: r.status,
    safetyImpact: r.safetyImpact,
    operationalImpact: r.operationalImpact,
    requestedAction: r.requestedAction,
    owner: r.ownerName,
    approved: r.approvedAt ? "معتمد" : "",
    sentTo: r.sentTo,
    sentAt: r.sentAt,
    issued: r.documentId ? "صدرت وثيقته" : "",
    // §10: كل ملاحظة فحص بلاغ مستقل — يُقال مصدره صراحةً
    source: r.fromInspection ? "من ملاحظة فحص" : "بلاغ مباشر",
    closedAt: isoDate(r.closedAt),
    createdAt: isoDate(r.createdAt),
  }));
}

async function loadAssets(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db
    .select({
      code: assets.code,
      nameAr: assets.nameAr,
      category: assets.category,
      roomName: rooms.nameAr,
      condition: assets.condition,
      quantity: assets.quantity,
      archivedAt: assets.archivedAt,
    })
    .from(assets)
    .leftJoin(rooms, eq(assets.roomId, rooms.id))
    .orderBy(asc(assets.code));
  return rows
    .filter((r) => !r.archivedAt)
    .filter((r) => !filters.search || (r.nameAr ?? "").includes(filters.search) || (r.code ?? "").includes(filters.search))
    .map((r) => ({
      code: r.code,
      nameAr: r.nameAr,
      category: r.category,
      roomName: r.roomName,
      condition: r.condition,
      quantity: r.quantity,
    }));
}

/* ─────────────────────────────── الموظفون ─────────────────────────────────── */

async function loadEmployees(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [];
  if (filters.search) where.push(ilike(people.fullName, likeTerm(filters.search)));
  if (filters.status) where.push(eq(people.employmentStatus, filters.status));
  const rows = await db.select().from(people).where(where.length ? and(...where) : undefined).orderBy(asc(people.fullName));
  // لا يُصدَّر أي معرّف هوية أو حقل حسّاس — الأعمدة مختارة صراحةً
  return rows.map((p) => ({
    fullName: p.fullName,
    employeeType: p.employeeType,
    jobTitle: p.jobTitle,
    orgUnit: p.orgUnit,
    status: p.employmentStatus ?? (p.active ? "على رأس العمل" : "غير نشط"),
  }));
}

async function loadEmployeeMissingData(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db.select().from(people).orderBy(asc(people.fullName));
  return rows
    .filter((p) => !filters.search || (p.fullName ?? "").includes(filters.search))
    .map((p) => {
      const missing: string[] = [];
      if (!p.jobTitle?.trim()) missing.push("المسمى الوظيفي");
      if (!p.employeeType?.trim()) missing.push("نوع المنسوب");
      if (!p.orgUnit?.trim()) missing.push("الوحدة");
      if (!p.jobNumber?.trim()) missing.push("الرقم الوظيفي");
      return { fullName: p.fullName, missing: missing.join("، ") };
    })
    .filter((r) => r.missing.length > 0);
}

/** v2.4 §12: صف مستقل لكل عضوية (موظف × لجنة × دور) — لا دمج للجان في خلية واحدة */
async function loadEmployeeCommittees(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db
    .select({
      personId: committeeMembers.personId,
      fullName: people.fullName,
      committeeName: committees.nameAr,
      kind: committees.kind,
      role: committeeMembers.role,
      effectiveTo: committeeMembers.effectiveTo,
    })
    .from(committeeMembers)
    .innerJoin(committees, eq(committeeMembers.committeeId, committees.id))
    .leftJoin(people, eq(committeeMembers.personId, people.id));
  const countByPerson = new Map<string, number>();
  for (const r of rows) {
    if (r.personId && !r.effectiveTo) countByPerson.set(r.personId, (countByPerson.get(r.personId) ?? 0) + 1);
  }
  return rows
    .filter((r) => !filters.search || (r.fullName ?? "").includes(filters.search) || (r.committeeName ?? "").includes(filters.search))
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "", "ar"))
    .map((r) => ({
      fullName: r.fullName,
      committeeName: r.committeeName,
      kind: r.kind,
      role: r.role,
      membership: r.effectiveTo ? `انتهت ${isoDate(r.effectiveTo)}` : "قائمة",
      committeeCount: r.personId ? (countByPerson.get(r.personId) ?? 0) : 0,
    }));
}

/* ────────────────────────── المخاطر والتقييم الخارجي ──────────────────────── */

async function loadRisks(filters: ReportFilters): Promise<ReportRow[]> {
  const rows = await db.select().from(programRisks).orderBy(asc(programRisks.code));
  return rows
    .filter((r) => !filters.search || (r.risk ?? "").includes(filters.search))
    .map((r) => ({
      code: r.code,
      risk: r.risk,
      likelihood: r.likelihood,
      impact: r.impact,
      classification: r.classification,
      treatment: r.treatment,
      owner: r.owner,
    }));
}

/**
 * سجل التحليل الرباعي — البيانات الرسمية من ورقة «التحليل الرباعي» في مصنف الخطة.
 *
 * الاستبعاد الاصطناعي عبر السنة التخطيطية: عناصر SWOT مرتبطة بالسنة كالمؤشرات والمخاطر،
 * فسنة العرض التجريبية تُخفي عناصرها معها بلا حاجة إلى تصنيف مستقل.
 */
async function loadSwot(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const where: (SQL | undefined)[] = [notSynthetic(planSwotItems.planYearId, excluded.planYears)];
  // «الحالة» في هذا التقرير هي نوع العنصر (قوة/ضعف/فرصة/تهديد)
  if (filters.status) where.push(eq(planSwotItems.category, filters.status));
  if (filters.search) {
    where.push(or(ilike(planSwotItems.item, likeTerm(filters.search)), ilike(planSwotItems.code, likeTerm(filters.search))));
  }
  const rows = await db
    .select({ swot: planSwotItems, yearName: planYears.nameAr })
    .from(planSwotItems)
    .innerJoin(planYears, eq(planYears.id, planSwotItems.planYearId))
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(asc(planSwotItems.sortOrder), asc(planSwotItems.code));
  return rows.map(({ swot, yearName }) => ({
    category: swot.category,
    code: swot.code,
    item: swot.item,
    implication: swot.implication,
    planYear: yearName,
  }));
}

async function loadSwotByCategory(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const rows = await db
    .select({ category: planSwotItems.category, count: sql<number>`count(*)::int` })
    .from(planSwotItems)
    .where(notSynthetic(planSwotItems.planYearId, excluded.planYears))
    .groupBy(planSwotItems.category);
  return rows
    .filter((r) => !filters.search || r.category.includes(filters.search))
    .map((r) => ({ category: r.category, count: r.count }));
}

async function loadPlanKpis(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const where: (SQL | undefined)[] = [notSynthetic(programKpis.id, excluded.kpis)];
  if (filters.search) {
    where.push(or(ilike(programKpis.nameAr, likeTerm(filters.search)), ilike(programKpis.code, likeTerm(filters.search))));
  }
  const rows = await db
    .select()
    .from(programKpis)
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(asc(programKpis.code));
  return rows.map((k) => ({
    code: k.code,
    nameAr: k.nameAr,
    baseline: k.baseline,
    target: k.target,
    periodicity: k.periodicity,
    owner: k.owner,
    dataSource: k.dataSource,
  }));
}

/**
 * v2.4 §7: تقرير حالة الأسبوع الحالي — صف لكل برنامج معتمد في السنة النشطة، بلقطة الأسبوع
 * المحفوظة أو «لم يتم التحديث هذا الأسبوع»، ومحورا التنفيذ والإقفال منفصلان. غياب التحديث
 * لا يُعرَض اكتمالاً أبداً.
 */
/**
 * تقرير المتابعة الأسبوعية — **يقرأ المصدر الواحد نفسه الذي تعرضه الشاشة** (§6.1).
 *
 * قبل v2.5.0 كان لهذا التقرير استعلامه المستقل، وكان يختلف عن الشاشة في ثلاثة أمور
 * جوهرية: يقرأ أسبوع اليوم دائماً متجاهلاً الأسبوع المختار، ويصنّف بالحقل الخام بدل
 * التجميع الصادق، ويعرض «نسبة الأسبوع» المُدخلة يدوياً كأنها تقدم البرنامج. فكان المدير
 * يرى رقمين للأسبوع نفسه. الآن التقرير عرض للقراءة والتصدير فوق `loadWeeklyFollowup`.
 */
async function loadPlanFollowups(filters: ReportFilters): Promise<ReportRow[]> {
  const { loadWeeklyFollowup } = await import("@/lib/plan/followup-service");
  const result = await loadWeeklyFollowup({ week: filters.week, filters });
  return result.rows.map((r) => ({
    seq: r.seq,
    programName: r.name,
    domain: r.domain,
    owner: r.owner,
    weekKey: result.week,
    weekStatus: r.weekStatus,
    group: r.group,
    // §6.4: التقدم المعتمد من سجل البرنامج — لا «نسبة أسبوع» مُدخلة يدوياً
    currentProgress: r.progress,
    executionStatus: r.executionStatus,
    lifecycle: r.lifecycle,
    lastFollowup: isoDate(r.lastFollowupAt),
    evidenceCount: r.evidenceCount,
    note: r.note,
    completedWork: r.completedWork,
    obstacles: r.obstacles,
    requiredAction: r.requiredAction,
    nextStep: r.nextStep,
    interventionNeeded: r.interventionNeeded ? "نعم" : "",
  }));
}

/** السجل التاريخي الكامل للمتابعات الأسبوعية (كان `plan-followups` قبل v2.4) */
async function loadPlanFollowupLog(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const where: (SQL | undefined)[] = [
    notSynthetic(programFollowups.id, excluded.followups),
    notSynthetic(programs.id, excluded.programs),
    ...dateRangeTs(programFollowups.createdAt, filters),
  ];
  const statusFilter = inArrayIf(programFollowups.executionStatus, filters.statuses);
  if (statusFilter) where.push(statusFilter);
  const programFilter = inArrayIf(programFollowups.programId, filters.programIds);
  if (programFilter) where.push(programFilter);
  if (filters.search) where.push(or(ilike(programs.name, likeTerm(filters.search)), ilike(programFollowups.note, likeTerm(filters.search))));
  const rows = await db
    .select({ f: programFollowups, programName: programs.name })
    .from(programFollowups)
    .innerJoin(programs, eq(programs.id, programFollowups.programId))
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(desc(programFollowups.weekKey), desc(programFollowups.createdAt));
  // §6.2: عمود `progress_snapshot` مهجور — لا يُصدَّر ولا يُعرض، وقيمه التاريخية باقية
  // في القاعدة كما هي (§18).
  return rows.map(({ f, programName }) => ({
    weekKey: f.weekKey,
    programName,
    executionStatus: normalizeWeeklyStatus(f.executionStatus),
    note: f.note,
    completedWork: f.completedWork,
    obstacles: f.obstacles,
    requiredAction: f.requiredAction,
    nextStep: f.nextStep,
    createdAt: isoDate(f.createdAt),
  }));
}

async function loadActionTasks(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const where: (SQL | undefined)[] = [notSynthetic(actionTasks.id, excluded.tasks), ...dateRangeTs(actionTasks.dueDate, filters)];
  if (filters.status) where.push(eq(actionTasks.status, filters.status));
  if (filters.search) where.push(ilike(actionTasks.title, likeTerm(filters.search)));
  const rows = await db
    .select({ t: actionTasks, ownerName: people.fullName })
    .from(actionTasks)
    .leftJoin(people, eq(people.id, actionTasks.ownerPersonId))
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(desc(actionTasks.createdAt));
  return rows.map(({ t, ownerName }) => ({
    title: t.title,
    owner: ownerName ?? t.ownerText,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    dueDate: isoDate(t.dueDate),
    sourceType: t.sourceType,
  }));
}

async function loadCalendarEvents(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [];
  if (filters.search) where.push(ilike(calendarEvents.nameAr, likeTerm(filters.search)));
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(asc(calendarEvents.sortOrder));
  return rows.map((e) => ({
    nameAr: e.nameAr,
    hijriFrom: e.hijriFrom,
    hijriTo: e.hijriTo,
    gregorianText: e.gregorianText,
    impact: e.impact,
    schoolAction: e.schoolAction,
  }));
}

/** سجل الملاحظات — العنوان والتصنيف فقط؛ لا يُصدَّر نص البلاغ ولا مرفقه الخاص */
async function loadFeedbackRegister(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(feedback.createdAt, filters)];
  if (filters.status) where.push(eq(feedback.status, filters.status));
  if (filters.search) where.push(or(ilike(feedback.title, likeTerm(filters.search)), ilike(feedback.ref, likeTerm(filters.search))));
  const rows = await db
    .select({
      ref: feedback.ref,
      module: feedback.module,
      category: feedback.category,
      severity: feedback.severity,
      title: feedback.title,
      status: feedback.status,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(desc(feedback.createdAt));
  return rows.map((r) => ({ ...r, createdAt: isoDate(r.createdAt) }));
}

async function loadImprovementPlans(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [];
  if (filters.status) where.push(eq(improvementPlans.status, filters.status));
  const rows = await db.select().from(improvementPlans).where(where.length ? and(...where) : undefined).orderBy(desc(improvementPlans.createdAt));
  return rows
    .filter((r) => !filters.search || (r.title ?? "").includes(filters.search))
    .map((r) => ({
      title: r.title,
      goals: r.goals,
      actions: r.actions,
      status: r.status,
      createdAt: isoDate(r.createdAt),
    }));
}

/* ──────────────────────── الوثائق والاستيراد والتدقيق ─────────────────────── */

async function loadDocuments(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(documents.issuedAt, filters)];
  if (filters.search) where.push(or(ilike(documents.title, likeTerm(filters.search)), ilike(documents.docNumber, likeTerm(filters.search))));
  const rows = await db.select().from(documents).where(where.length ? and(...where) : undefined).orderBy(desc(documents.issuedAt));
  // لا تُصدَّر لقطة HTML للوثيقة ولا معرّف ملفها — العنوان والرقم ورمز التحقق فقط
  return rows.map((d) => ({
    docNumber: d.docNumber,
    docType: d.docType,
    title: d.title,
    issuedAt: isoDate(d.issuedAt),
    verificationCode: d.verificationCode,
  }));
}

async function loadFiles(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(storedFiles.createdAt, filters)];
  if (filters.search) where.push(ilike(storedFiles.originalName, likeTerm(filters.search)));
  const rows = await db.select().from(storedFiles).where(where.length ? and(...where) : undefined).orderBy(desc(storedFiles.createdAt));
  // `storage_path` و`sha256` لا يُصدَّران أبداً — كشف مسار التخزين مخاطرة أمنية
  return rows.map((f) => ({
    originalName: f.originalName,
    mime: f.mime,
    size: f.size,
    createdAt: isoDate(f.createdAt),
  }));
}

async function loadImportBatches(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(importBatches.createdAt, filters)];
  if (filters.status) where.push(eq(importBatches.status, filters.status));
  const rows = await db.select().from(importBatches).where(where.length ? and(...where) : undefined).orderBy(desc(importBatches.createdAt));
  const counts = await db
    .select({ batchId: importRows.batchId, n: sql<number>`count(*)::int` })
    .from(importRows)
    .groupBy(importRows.batchId);
  const rowCount = new Map(counts.map((c) => [c.batchId, c.n]));
  return rows
    .filter((b) => !filters.search || (b.sourceFileName ?? "").includes(filters.search))
    .map((b) => ({
      importType: b.importType,
      fileName: b.sourceFileName,
      status: b.status,
      rowCount: rowCount.get(b.id) ?? 0,
      createdAt: isoDate(b.createdAt),
    }));
}

async function loadImportRowQuality(): Promise<ReportRow[]> {
  const rows = await db
    .select({ batchKind: importBatches.importType, state: importRows.status, count: sql<number>`count(*)::int` })
    .from(importRows)
    .innerJoin(importBatches, eq(importRows.batchId, importBatches.id))
    .groupBy(importBatches.importType, importRows.status);
  return rows;
}

async function loadAuditLog(filters: ReportFilters, exportsOnly: boolean): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(auditLog.createdAt, filters)];
  if (exportsOnly) where.push(eq(auditLog.action, "report.exported"));
  if (filters.search) where.push(or(ilike(auditLog.summary, likeTerm(filters.search)), ilike(auditLog.action, likeTerm(filters.search))));
  const rows = await db
    .select({
      action: auditLog.action,
      entityType: auditLog.entityType,
      summary: auditLog.summary,
      actor: users.displayName,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.createdAt))
    // سجل التدقيق قد يكون ضخماً — حد أعلى صريح يمنع مسحاً غير محدود
    .limit(MAX_EXPORT_ROWS);
  return rows.map((r): ReportRow =>
    exportsOnly
      ? { summary: r.summary, actor: r.actor, createdAt: isoDate(r.createdAt) }
      : { action: r.action, entityType: r.entityType, summary: r.summary, actor: r.actor, createdAt: isoDate(r.createdAt) },
  );
}

/* ──────────────────────────────── الموزّع ─────────────────────────────────── */

const LOADERS: Record<string, (f: ReportFilters) => Promise<ReportRow[]>> = {
  "programs-active": (f) => loadPrograms(f, "active"),
  "programs-completed": (f) => loadPrograms(f, "completed"),
  "programs-closed": (f) => loadPrograms(f, "closed"),
  "programs-archived": (f) => loadPrograms(f, "archived"),
  "programs-reopened": (f) => loadPrograms(f, "reopened"),
  "program-closure-history": loadClosureHistory,
  "programs-by-domain": loadProgramsByDomain,
  "programs-by-domain-summary": loadProgramsByDomainSummary,
  "programs-by-owner": loadProgramsByOwner,
  "programs-by-owner-summary": loadProgramsByOwnerSummary,
  "programs-without-evidence": loadProgramsWithoutEvidence,

  "evidence-register": loadEvidenceRegister,
  "evidence-by-type": loadEvidenceByType,
  "evidence-by-program": loadEvidenceByProgram,
  "evidence-file-types": loadFileTypes,

  "income-register": loadIncomeRegister,
  "expense-register": loadExpenseRegister,
  "item-allocations": loadItemAllocations,
  "allocation-utilization": loadAllocationUtilization,
  "missing-allocation": loadMissingAllocation,
  "over-budget": loadOverBudget,
  "missing-invoice": (f) => loadInvoiceReports(f, false),
  "invoice-register": (f) => loadInvoiceReports(f, true),
  "all-operations": loadAllOperations,
  "monthly-trend": loadMonthlyTrend,
  "finance-archived": loadFinanceArchived,

  "perf-planning-sessions": (f) => loadPerfSessions(f, "planning"),
  "perf-evaluations": (f) => loadPerfSessions(f, "evaluations"),
  "perf-incomplete": (f) => loadPerfSessions(f, "incomplete"),
  "perf-evidence-counts": (f) => loadPerfSessions(f, "evidence"),
  "perf-results": (f) => loadPerfResults(f, "results"),
  "perf-low-performers": (f) => loadPerfResults(f, "low"),
  "perf-strengths-weaknesses": (f) => loadPerfResults(f, "narrative"),
  "perf-distribution": loadPerfDistribution,

  "committee-register": loadCommitteeRegister,
  "committee-members": loadCommitteeMembers,
  "committee-tasks": loadCommitteeTasks,
  "committees-without-meetings": loadCommitteesWithoutMeetings,
  "committee-summary": loadCommitteeSummary,
  "committee-registry-detailed": loadCommitteeRegistryDetailed,
  "meetings-registry-detailed": loadMeetingsRegistryDetailed,

  "meetings-register": loadMeetings,
  "meeting-decisions": loadDecisions,

  "rooms-register": loadRooms,
  "facilities-register": loadFacilities,
  "maintenance-register": loadMaintenance,
  "assets-register": loadAssets,

  "employee-register": loadEmployees,
  "employee-missing-data": loadEmployeeMissingData,
  "employee-committees": loadEmployeeCommittees,

  "plan-kpis": loadPlanKpis,
  "plan-followups": loadPlanFollowups,
  "plan-followup-log": loadPlanFollowupLog,
  "action-tasks": loadActionTasks,
  "calendar-events": loadCalendarEvents,

  "risk-register": loadRisks,
  "swot-register": loadSwot,
  "swot-by-category": loadSwotByCategory,
  "improvement-plans": loadImprovementPlans,

  "feedback-register": loadFeedbackRegister,

  "documents-register": loadDocuments,
  "files-register": loadFiles,

  "import-batches": loadImportBatches,
  "import-row-quality": loadImportRowQuality,

  "audit-log": (f) => loadAuditLog(f, false),
  "export-audit": (f) => loadAuditLog(f, true),
};

/** هل لكل تقرير في السجل محمّل مطابق؟ يُستعمل في اختبار تكامل الفهرس */
export function loaderKeys(): string[] {
  return Object.keys(LOADERS);
}

/**
 * تشغيل تقرير: يتحقق من وجوده، يحمّل صفوفه، ثم يرتّبها ويقسّمها إلى صفحات.
 *
 * التفويض ليس هنا: يتحقق منه المستدعي (الصفحة أو مسار التصدير) عبر `requirePermission`
 * بالصلاحية المعلَنة في تعريف التقرير — حارس على حدود الخادم لا إخفاء زر.
 */
export async function runReport(reportKey: string, filters: ReportFilters): Promise<LoadedReport> {
  const def = reportByKey(reportKey);
  if (!def) throw new Error("تقرير غير معروف");
  const loader = LOADERS[reportKey];
  if (!loader) throw new Error("تقرير غير معروف");
  const rows = await loader(filters);
  return paginate(rows, filters, reportKey);
}

/** تشغيل تقرير للتصدير — بلا تقسيم صفحات، وبحد أعلى صريح للصفوف */
export async function runReportForExport(reportKey: string, filters: ReportFilters): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const def = reportByKey(reportKey);
  if (!def) throw new Error("تقرير غير معروف");
  const loader = LOADERS[reportKey];
  if (!loader) throw new Error("تقرير غير معروف");
  const all = await loader(filters);
  const sorted = paginate(all, { ...filters, page: 1, pageSize: MAX_EXPORT_ROWS }, reportKey).rows;
  return { rows: sorted.slice(0, MAX_EXPORT_ROWS), truncated: all.length > MAX_EXPORT_ROWS };
}

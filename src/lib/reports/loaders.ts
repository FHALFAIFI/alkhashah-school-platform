import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  programs,
  programClosureHistory,
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
import { isoWeekKey, NO_WEEKLY_UPDATE_LABEL } from "@/lib/plan/followup";
import { programLifecycle } from "@/lib/plan/lifecycle";
import { programsEvidenceSummary } from "@/lib/plan/program-service";
import { hijriTextToIso } from "@/lib/dates";
import { type ReportFilters, type ReportRow, reportByKey, isSortableColumn } from "./catalog";
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
  const evidence = await programsEvidenceSummary(rows.map((p) => p.id));
  const today = new Date().toISOString().slice(0, 10);

  let out = rows.map((p) => {
    const groupKey =
      groupBy === "domain"
        ? (p.domain ?? "").trim() || "بدون تصنيف"
        : (p.ownerPosition ?? "").trim() || "بدون مسؤول";
    const endIso = hijriTextToIso(p.hijriEnd);
    return {
      group: groupKey,
      seq: p.seq,
      name: p.name,
      other: groupBy === "domain" ? (p.ownerPosition ?? "").trim() || "بدون مسؤول" : (p.domain ?? "").trim() || "بدون تصنيف",
      approval: p.status,
      lifecycle: programLifecycle(p),
      executionStatus: p.executionStatus,
      progress: p.progress,
      hijriStart: p.hijriStart,
      hijriEnd: p.hijriEnd,
      evidenceCount: evidence.get(p.id)?.count ?? 0,
      delayed: endIso !== null && endIso < today && !p.completedAt && !p.closedAt ? "متأخر عن نهايته" : "",
    };
  });
  if (filters.status) out = out.filter((r) => r.approval === filters.status);
  if (filters.search) {
    const term = filters.search;
    out = out.filter((r) => String(r.name ?? "").includes(term) || r.group.includes(term) || r.other.includes(term));
  }
  // التجميع: ترتيب ثابت بالمجموعة ثم تسلسل البرنامج — كل برامج المجموعة متجاورة
  return out.sort((a, b) => a.group.localeCompare(b.group, "ar") || a.seq - b.seq);
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
 * v2.4 §4: المتبقي من مخصص البند بعد كل مصروف — تراكمي بترتيب زمني حتمي داخل كل بند
 * (التاريخ ثم وقت الإدخال ثم المعرف). `null` للمصروف بلا بند أو لبند بلا مخصص.
 */
function expenseRemainingAfter(
  lines: { id: string; allocated: number | null }[],
  expenses: { id: string; amount: string | null; financialItemId: string | null; archivedAt: Date | null; expenseDate: string | null; createdAt: Date | null }[],
): Map<string, number | null> {
  const allocationByItem = new Map(lines.map((l) => [l.id, l.allocated]));
  const spentMinorByItem = new Map<string, number>();
  const result = new Map<string, number | null>();
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
      result.set(r.id, null);
      continue;
    }
    const allocated = allocationByItem.get(r.financialItemId) ?? null;
    const cur = spentMinorByItem.get(r.financialItemId) ?? 0;
    const next = cur + toMinor(amountOrNull(r.amount) ?? 0);
    spentMinorByItem.set(r.financialItemId, next);
    result.set(r.id, allocated === null ? null : fromMinor(toMinor(allocated) - next));
  }
  return result;
}

async function loadExpenseRegister(filters: ReportFilters): Promise<ReportRow[]> {
  const f = await financeData();
  const remainingAfter = expenseRemainingAfter(f.lines, f.expenses);
  return f.expenses
    .filter((r) => !r.archivedAt)
    .filter((r) => inDateRange(r.expenseDate, filters))
    .filter((r) => !filters.itemId || r.financialItemId === filters.itemId)
    .filter((r) => !filters.search || (r.supplier ?? "").includes(filters.search) || (r.paymentReference ?? "").includes(filters.search))
    .map((r) => ({
      amount: amountOrNull(r.amount),
      expenseDate: r.expenseDate,
      itemName: r.itemName ?? (r.items ? `${r.items} (تاريخي)` : null),
      paymentReference: r.paymentReference,
      supplier: r.supplier,
      hasInvoice: r.hasInvoice ? "نعم" : "لا",
      remainingAfter: remainingAfter.get(r.id) ?? null,
    }));
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
    state: l.archived ? "مؤرشف" : l.overspent ? "تجاوز" : l.nearExhaustion ? "قارب الاستنفاد" : "ضمن المخصص",
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
      remainingAfter: remainingAfter.get(r.id) ?? null,
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

async function loadMaintenance(filters: ReportFilters): Promise<ReportRow[]> {
  const where: (SQL | undefined)[] = [...dateRangeTs(maintenanceIssues.createdAt, filters)];
  if (filters.status) where.push(eq(maintenanceIssues.status, filters.status));
  const rows = await db
    .select({
      title: maintenanceIssues.title,
      roomName: rooms.nameAr,
      priority: maintenanceIssues.priority,
      status: maintenanceIssues.status,
      createdAt: maintenanceIssues.createdAt,
    })
    .from(maintenanceIssues)
    .leftJoin(rooms, eq(maintenanceIssues.roomId, rooms.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(maintenanceIssues.createdAt));
  return rows
    .filter((r) => !filters.search || (r.title ?? "").includes(filters.search))
    .map((r) => ({ ...r, createdAt: isoDate(r.createdAt) }));
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
async function loadPlanFollowups(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const week = isoWeekKey();
  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];
  if (!activeYear) return [];
  const programRows = (
    await db
      .select()
      .from(programs)
      .where(
        and(
          eq(programs.planYearId, activeYear.id),
          notSynthetic(programs.id, excluded.programs),
          isNull(programs.archivedAt),
        ),
      )
      .orderBy(asc(programs.seq))
  ).filter((p) => p.status === "معتمد");
  const ids = programRows.map((p) => p.id);
  const weekFollowups = ids.length
    ? await db
        .select()
        .from(programFollowups)
        .where(and(inArray(programFollowups.programId, ids), eq(programFollowups.weekKey, week)))
    : [];
  const byProgram = new Map(weekFollowups.map((f) => [f.programId, f]));
  const evidence = await programsEvidenceSummary(ids);

  let rows = programRows.map((p) => {
    const f = byProgram.get(p.id);
    return {
      seq: p.seq,
      programName: p.name,
      domain: p.domain,
      owner: p.ownerPosition ?? "",
      weekStatus: f?.executionStatus ?? NO_WEEKLY_UPDATE_LABEL,
      weekProgress: f ? f.progressSnapshot : null,
      lifecycle: programLifecycle(p),
      currentProgress: p.progress,
      lastFollowup: p.lastReviewAt ? isoDate(p.lastReviewAt) : null,
      evidenceCount: evidence.get(p.id)?.count ?? 0,
      note: f?.note ?? "",
    };
  });
  if (filters.status) rows = rows.filter((r) => r.weekStatus === filters.status);
  if (filters.search) {
    const term = filters.search;
    rows = rows.filter(
      (r) =>
        String(r.programName ?? "").includes(term) ||
        String(r.domain ?? "").includes(term) ||
        String(r.owner ?? "").includes(term),
    );
  }
  return rows;
}

/** السجل التاريخي الكامل للمتابعات الأسبوعية (كان `plan-followups` قبل v2.4) */
async function loadPlanFollowupLog(filters: ReportFilters): Promise<ReportRow[]> {
  const excluded = await getExcludedIdSets();
  const where: (SQL | undefined)[] = [
    notSynthetic(programFollowups.id, excluded.followups),
    notSynthetic(programs.id, excluded.programs),
    ...dateRangeTs(programFollowups.createdAt, filters),
  ];
  if (filters.status) where.push(eq(programFollowups.executionStatus, filters.status));
  if (filters.search) where.push(or(ilike(programs.name, likeTerm(filters.search)), ilike(programFollowups.note, likeTerm(filters.search))));
  const rows = await db
    .select({ f: programFollowups, programName: programs.name })
    .from(programFollowups)
    .innerJoin(programs, eq(programs.id, programFollowups.programId))
    .where(where.filter(Boolean).length ? and(...where) : undefined)
    .orderBy(desc(programFollowups.weekKey), desc(programFollowups.createdAt));
  return rows.map(({ f, programName }) => ({
    weekKey: f.weekKey,
    programName,
    executionStatus: f.executionStatus,
    progressSnapshot: f.progressSnapshot,
    note: f.note,
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

  "committee-register": loadCommitteeRegister,
  "committee-members": loadCommitteeMembers,
  "committee-tasks": loadCommitteeTasks,
  "committees-without-meetings": loadCommitteesWithoutMeetings,

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

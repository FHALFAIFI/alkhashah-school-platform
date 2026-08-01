import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  programs,
  planYears,
  maintenanceIssues,
  inspectionFindings,
  inspections,
  rooms,
  evidenceItems,
  documents,
  storedFiles,
  perfCycles,
} from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { computeRoomReadiness } from "@/lib/building/readiness";
import { isOpenIssueStatus } from "@/lib/building/maintenance-lifecycle";
import { getSchoolFinance } from "@/lib/finance/service";
import { FILE_PENDING } from "@/lib/auth/roles";
import { hijriTextToIso, todayIso } from "@/lib/dates";

/**
 * مؤشرات لوحة المتابعة (v2.3 §13) — أرقام حيّة كل واحد منها يقود إلى سجلاته:
 * البرامج بدورة حياتها، البلاغات، ملاحظات الفحص، الجاهزية، المالية، الاعتمادات
 * المعلقة، والمواعيد القادمة. حسابات حتمية من الخدمات الموحدة نفسها.
 */

export type MonitoringCard = {
  key: string;
  label: string;
  value: string;
  href: string;
  tone?: "good" | "bad" | "warn" | "plain";
  hint?: string;
};

export type UpcomingItem = { title: string; dateIso: string; href: string };

export type DashboardMetrics = {
  cards: MonitoringCard[];
  upcoming: UpcomingItem[];
};

export async function loadDashboardMetrics(opts: {
  canSeeFinance: boolean;
  canSeeIndividualPerf: boolean;
}): Promise<DashboardMetrics> {
  const ex = await getExcludedIdSets();
  const today = todayIso();
  const soonIso = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة")).limit(1);

  const [allPrograms, issues, findings, allRooms, allInspections, recentEvidence, recentDocs, pendingFiles] =
    await Promise.all([
      activeYear
        ? db
            .select()
            .from(programs)
            .where(and(eq(programs.planYearId, activeYear.id), notSynthetic(programs.id, ex.programs), isNull(programs.archivedAt)))
        : Promise.resolve([]),
      db.select().from(maintenanceIssues).where(notSynthetic(maintenanceIssues.id, ex.maintenance)),
      db.select().from(inspectionFindings),
      db.select().from(rooms).where(eq(rooms.active, true)),
      db.select().from(inspections).orderBy(desc(inspections.inspectionDate)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(evidenceItems)
        .where(and(isNull(evidenceItems.archivedAt), gte(evidenceItems.createdAt, new Date(Date.now() - 7 * 86_400_000)))),
      db
        .select({ n: sql<number>`count(*)` })
        .from(documents)
        .where(gte(documents.issuedAt, new Date(Date.now() - 7 * 86_400_000))),
      db.select({ n: sql<number>`count(*)` }).from(storedFiles).where(eq(storedFiles.acceptanceStatus, FILE_PENDING)),
    ]);

  // ── البرامج بدورة الحياة الثلاثية + المتأخر والقادم ────────────────────
  const open = allPrograms.filter((p) => !p.closedAt);
  const inProgress = open.filter((p) => !p.completedAt);
  const completed = open.filter((p) => p.completedAt);
  const closed = allPrograms.filter((p) => p.closedAt);
  const delayed = inProgress.filter((p) => {
    const endIso = hijriTextToIso(p.hijriEnd);
    return endIso !== null && endIso < today;
  });

  const upcoming: UpcomingItem[] = [];
  for (const p of inProgress) {
    const startIso = hijriTextToIso(p.hijriStart);
    if (startIso && startIso >= today && startIso <= soonIso) {
      upcoming.push({ title: `بداية برنامج: ${p.name}`, dateIso: startIso, href: `/plan/${p.id}` });
    }
    const endIso = hijriTextToIso(p.hijriEnd);
    if (endIso && endIso >= today && endIso <= soonIso) {
      upcoming.push({ title: `نهاية برنامج: ${p.name}`, dateIso: endIso, href: `/plan/${p.id}` });
    }
  }

  // ── الصيانة والفحص والجاهزية ───────────────────────────────────────────
  const openIssues = issues.filter((i) => isOpenIssueStatus(i.status));
  const awaitingResponse = issues.filter((i) => i.status === "تم الإرسال");
  const openFindings = findings.filter((f) => f.status === "يحتاج معالجة");
  for (const f of openFindings) {
    if (f.targetDate && f.targetDate >= today && f.targetDate <= soonIso) {
      upcoming.push({ title: `موعد معالجة: ${f.label}`, dateIso: f.targetDate, href: `/building/rooms/${f.roomId}` });
    }
  }

  const inspectedRooms = allRooms.map((room) => {
    const latest = allInspections.find((i) => i.roomId === room.id) ?? null;
    return computeRoomReadiness({
      latestInspection: latest ? { results: latest.results ?? [], templateSnapshot: latest.templateSnapshot } : null,
    });
  });
  const withInspection = inspectedRooms.filter((r) => r.statusAr !== "لم يبدأ");
  const readyRooms = withInspection.filter((r) => r.statusAr === "جاهز").length;
  const readinessPercent =
    withInspection.length > 0 ? Math.round((readyRooms / withInspection.length) * 100) : null;

  const cards: MonitoringCard[] = [
    { key: "in-progress", label: "برامج قيد التنفيذ", value: String(inProgress.length), href: "/plan?حالة=قيد التنفيذ" },
    { key: "completed", label: "برامج مكتملة", value: String(completed.length), href: "/plan?حالة=مكتمل", tone: "good" },
    { key: "closed", label: "برامج مغلقة", value: String(closed.length), href: "/plan?حالة=مغلق" },
    {
      key: "delayed",
      label: "برامج متجاوزة نهايتها",
      value: String(delayed.length),
      href: "/plan?حالة=قيد التنفيذ",
      tone: delayed.length > 0 ? "warn" : "good",
      hint: "قيد التنفيذ بعد تاريخ نهايتها المجدول",
    },
    {
      key: "open-issues",
      label: "بلاغات صيانة قائمة",
      value: String(openIssues.length),
      href: "/building/maintenance",
      tone: openIssues.length > 0 ? "warn" : "good",
    },
    {
      key: "awaiting-response",
      label: "بلاغات بانتظار رد الجهة",
      value: String(awaitingResponse.length),
      href: "/building/maintenance",
      tone: awaitingResponse.length > 0 ? "warn" : "plain",
    },
    {
      key: "open-findings",
      label: "ملاحظات فحص تحتاج معالجة",
      value: String(openFindings.length),
      href: "/building/inspections",
      tone: openFindings.some((f) => f.critical) ? "bad" : openFindings.length > 0 ? "warn" : "good",
      hint: openFindings.some((f) => f.critical) ? "منها بنود حرجة" : undefined,
    },
    {
      key: "readiness",
      label: "جاهزية الغرف المفحوصة",
      value: readinessPercent === null ? "—" : `${readinessPercent}٪`,
      href: "/building/inspections",
      tone: readinessPercent !== null && readinessPercent < 70 ? "warn" : "plain",
      hint: withInspection.length === 0 ? "لا فحوص بعد" : `${readyRooms} جاهزة من ${withInspection.length}`,
    },
    {
      key: "pending-files",
      label: "ملفات بانتظار اعتماد المدير",
      value: String(Number(pendingFiles[0]?.n ?? 0)),
      href: "/evidence",
      tone: Number(pendingFiles[0]?.n ?? 0) > 0 ? "warn" : "good",
    },
    { key: "recent-evidence", label: "شواهد آخر 7 أيام", value: String(Number(recentEvidence[0]?.n ?? 0)), href: "/evidence" },
    { key: "recent-docs", label: "وثائق صدرت آخر 7 أيام", value: String(Number(recentDocs[0]?.n ?? 0)), href: "/documents" },
  ];

  // ── المالية (لمن يملك budget.read) ─────────────────────────────────────
  if (opts.canSeeFinance && activeYear) {
    const finance = await getSchoolFinance({ planYearId: activeYear.id });
    const warnings = finance.summary.overAllocationCount + finance.summary.nearExhaustionCount;
    cards.push(
      {
        key: "cash",
        label: "الرصيد النقدي",
        value: `${finance.summary.cashBalance.toLocaleString("ar-SA")} ريال`,
        href: "/budget",
        tone: finance.summary.cashBalance < 0 ? "bad" : "good",
      },
      {
        key: "remaining",
        label: "المتبقي من مخصصات البنود",
        value: `${finance.summary.totalRemaining.toLocaleString("ar-SA")} ريال`,
        href: "/budget",
        tone: finance.summary.totalRemaining < 0 ? "bad" : "plain",
      },
      {
        key: "budget-warnings",
        label: "تنبيهات البنود (تجاوز/اقتراب)",
        value: String(warnings),
        href: "/reports?category=finance&report=over-budget",
        tone: finance.summary.overAllocationCount > 0 ? "bad" : warnings > 0 ? "warn" : "good",
      },
    );
  }

  // ── الأداء (D-013: التفاصيل الفردية لمن يملك صلاحيتها فقط) ─────────────
  if (opts.canSeeIndividualPerf) {
    const cycles = await db.select().from(perfCycles);
    const activeCycles = cycles.filter((c) => !ex.people.has(c.personId));
    const notCompleted = activeCycles.filter((c) => c.status !== "مكتملة" && c.status !== "مقفلة").length;
    cards.push({
      key: "perf-action",
      label: "دورات تقييم لم تكتمل",
      value: String(notCompleted),
      href: "/performance/analytics",
      tone: notCompleted > 0 ? "warn" : "good",
      hint: "التفاصيل ومواطن الضعف في لوحة الأداء العام",
    });
  }

  upcoming.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  return { cards, upcoming: upcoming.slice(0, 8) };
}

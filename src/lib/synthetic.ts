import "server-only";
import { inArray, notInArray, like, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import {
  importBatches,
  people,
  programs,
  planYears,
  committees,
  committeeMembers,
  meetings,
  meetingOutcomes,
  perfCycles,
  perfSessions,
  documents,
  evidenceItems,
  evidenceLinks,
  actionTasks,
  maintenanceIssues,
} from "@/db/schema";

/**
 * تصنيف السجلات الاصطناعية (تجريبية آلية / بذرة العرض) بأدلة بنيوية — لا بالاسم وحده.
 *
 * الإشارات البنيوية (أساسية):
 *  - دفعة استيراد اسمها ملفها يحوي «تجريبي» → أشخاصها/برامجها اصطناعية (provenance).
 *  - سنة تخطيطية مفتاحها يبدأ بـ demo → برامجها اصطناعية (بذرة العرض).
 *  - انتشار عبر المفاتيح الأجنبية: دورات/جلسات لأشخاص اصطناعيين، لجان كل أعضائها
 *    اصطناعيون، اجتماعاتها ونتائجها، المهام والوثائق والشواهد المرتبطة بها.
 *
 * الاسم «تجريبي» يُستعمل كإشارة مؤيِّدة فقط ويُدرج المشتبَه به بالاسم وحده في دلو منفصل
 * «يحتاج تأكيداً يدوياً»، ولا يدخل في الاستبعاد أو الأرشفة التلقائية.
 *
 * البرامج الرسمية (26 برنامجاً) ودفعة فارس لا تحمل أي إشارة بنيوية فتبقى ظاهرة وآمنة.
 */

export type SyntheticEntityType =
  | "person"
  | "program"
  | "committee"
  | "meeting"
  | "perf_cycle"
  | "perf_session"
  | "task"
  | "document"
  | "evidence"
  | "maintenance";

export type SyntheticCandidate = {
  entityType: SyntheticEntityType;
  id: string;
  label: string;
  /** سبب عربي بنيوي لكل مرشح — يظهر في المعاينة */
  reason: string;
};

export type SyntheticIdSets = {
  people: Set<string>;
  programs: Set<string>;
  committees: Set<string>;
  meetings: Set<string>;
  perfCycles: Set<string>;
  perfSessions: Set<string>;
  tasks: Set<string>;
  documents: Set<string>;
  evidence: Set<string>;
  maintenance: Set<string>;
};

export type SyntheticClassification = {
  /** دفعات الاستيراد الاصطناعية (اسم ملفها يحوي «تجريبي») */
  syntheticBatchIds: string[];
  ids: SyntheticIdSets;
  /** المرشحون المؤكدون بنيوياً (أساس الاستبعاد والأرشفة) */
  candidates: SyntheticCandidate[];
  /** مشتبَه بهم بالاسم وحده — لا يُستبعدون ولا يؤرشفون تلقائياً */
  nameOnlySuspects: SyntheticCandidate[];
  counts: Record<SyntheticEntityType, number>;
};

const NAME_MARKER = "%تجريبي%";

/** inArray آمن مع مصفوفة فارغة (يعيد شرطاً كاذباً بدل خطأ SQL) */
function safeIn(col: AnyColumn, ids: string[]): SQL {
  return ids.length > 0 ? inArray(col, ids) : sql`false`;
}

function emptySets(): SyntheticIdSets {
  return {
    people: new Set(),
    programs: new Set(),
    committees: new Set(),
    meetings: new Set(),
    perfCycles: new Set(),
    perfSessions: new Set(),
    tasks: new Set(),
    documents: new Set(),
    evidence: new Set(),
    maintenance: new Set(),
  };
}

/**
 * يحسب التصنيف الكامل بأدلة بنيوية. للقراءة فقط — لا يعدّل أي سجل.
 */
export async function classifySynthetic(): Promise<SyntheticClassification> {
  // 1) المراسي البنيوية
  const synthBatches = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(like(importBatches.sourceFileName, NAME_MARKER));
  const syntheticBatchIds = synthBatches.map((b) => b.id);

  const demoYears = await db
    .select({ id: planYears.id })
    .from(planYears)
    .where(like(planYears.key, "demo%"));
  const demoYearIds = demoYears.map((y) => y.id);

  // 2) أشخاص اصطناعيون (provenance الدفعة)
  const synthPeople =
    syntheticBatchIds.length > 0
      ? await db
          .select({ id: people.id, name: people.fullName })
          .from(people)
          .where(safeIn(people.importBatchId, syntheticBatchIds))
      : [];
  const peopleIds = synthPeople.map((p) => p.id);
  const peopleSet = new Set(peopleIds);

  // 3) برامج اصطناعية (دفعة اصطناعية أو سنة عرض)
  const synthPrograms = await db
    .select({ id: programs.id, name: programs.name, batchId: programs.importBatchId, yearId: programs.planYearId })
    .from(programs)
    .where(
      or(
        safeIn(programs.importBatchId, syntheticBatchIds),
        safeIn(programs.planYearId, demoYearIds),
      ),
    );
  const programIds = synthPrograms.map((p) => p.id);

  // 4) دورات وجلسات الأداء لأشخاص اصطناعيين
  const synthCycles =
    peopleIds.length > 0
      ? await db.select({ id: perfCycles.id, personId: perfCycles.personId }).from(perfCycles).where(safeIn(perfCycles.personId, peopleIds))
      : [];
  const cycleIds = synthCycles.map((c) => c.id);
  const synthSessions =
    cycleIds.length > 0
      ? await db.select({ id: perfSessions.id }).from(perfSessions).where(safeIn(perfSessions.cycleId, cycleIds))
      : [];
  const sessionIds = synthSessions.map((s) => s.id);

  // 5) لجان: سنة عرض، أو كل أعضائها أشخاص اصطناعيون (بنيوي — ليس الاسم)
  const allCommittees = await db
    .select({ id: committees.id, name: committees.nameAr, yearId: committees.planYearId })
    .from(committees);
  const memberRows = await db
    .select({ committeeId: committeeMembers.committeeId, personId: committeeMembers.personId })
    .from(committeeMembers);
  const membersByCommittee = new Map<string, string[]>();
  for (const m of memberRows) {
    const arr = membersByCommittee.get(m.committeeId) ?? [];
    arr.push(m.personId);
    membersByCommittee.set(m.committeeId, arr);
  }
  const synthCommittees: { id: string; name: string; reason: string }[] = [];
  for (const c of allCommittees) {
    if (demoYearIds.includes(c.yearId)) {
      synthCommittees.push({ id: c.id, name: c.name, reason: "لجنة ضمن سنة تخطيطية للعرض (demo)" });
      continue;
    }
    const members = membersByCommittee.get(c.id) ?? [];
    if (members.length > 0 && members.every((pid) => peopleSet.has(pid))) {
      synthCommittees.push({
        id: c.id,
        name: c.name,
        reason: `كل أعضاء اللجنة (${members.length}) أشخاص اصطناعيون من دفعة استيراد اختبارية`,
      });
    }
  }
  const committeeIds = synthCommittees.map((c) => c.id);

  // 6) اجتماعات ونتائج اللجان الاصطناعية
  const synthMeetings =
    committeeIds.length > 0
      ? await db.select({ id: meetings.id, title: meetings.title }).from(meetings).where(safeIn(meetings.committeeId, committeeIds))
      : [];
  const meetingIds = synthMeetings.map((m) => m.id);
  const outcomeRows =
    meetingIds.length > 0
      ? await db.select({ id: meetingOutcomes.id }).from(meetingOutcomes).where(safeIn(meetingOutcomes.meetingId, meetingIds))
      : [];
  const outcomeIds = outcomeRows.map((o) => o.id);

  // 7) مهام مصدرها كيان اصطناعي (نتيجة اجتماع/برنامج/جلسة أداء)
  const allTasks = await db
    .select({ id: actionTasks.id, title: actionTasks.title, sourceType: actionTasks.sourceType, sourceId: actionTasks.sourceId, ownerPersonId: actionTasks.ownerPersonId })
    .from(actionTasks);
  const outcomeSet = new Set(outcomeIds);
  const programSet = new Set(programIds);
  const sessionSet = new Set(sessionIds);
  const synthTasks = allTasks.filter(
    (t) =>
      (t.sourceType === "meeting_outcome" && t.sourceId && outcomeSet.has(t.sourceId)) ||
      (t.sourceType === "program" && t.sourceId && programSet.has(t.sourceId)) ||
      (t.sourceType === "perf_session" && t.sourceId && sessionSet.has(t.sourceId)) ||
      (t.ownerPersonId != null && peopleSet.has(t.ownerPersonId)),
  );
  const taskIds = synthTasks.map((t) => t.id);

  // 8) وثائق تشير إلى كيان اصطناعي
  const entitySetByType: Record<string, Set<string>> = {
    program: programSet,
    committee: new Set(committeeIds),
    meeting: new Set(meetingIds),
    perf_cycle: new Set(cycleIds),
    perf_session: sessionSet,
    person: peopleSet,
  };
  const allDocs = await db
    .select({ id: documents.id, title: documents.title, entityType: documents.entityType, entityId: documents.entityId })
    .from(documents);
  const synthDocs = allDocs.filter(
    (d) => d.entityType != null && d.entityId != null && entitySetByType[d.entityType]?.has(d.entityId),
  );
  const documentIds = synthDocs.map((d) => d.id);

  // 9) شواهد مرتبطة بكيان اصطناعي
  const allLinks = await db
    .select({ evidenceId: evidenceLinks.evidenceId, entityType: evidenceLinks.entityType, entityId: evidenceLinks.entityId })
    .from(evidenceLinks);
  const evidenceIdSet = new Set<string>();
  for (const l of allLinks) {
    if (entitySetByType[l.entityType]?.has(l.entityId)) evidenceIdSet.add(l.evidenceId);
  }
  const evidenceIds = [...evidenceIdSet];
  const evLabels =
    evidenceIds.length > 0
      ? await db.select({ id: evidenceItems.id, title: evidenceItems.title }).from(evidenceItems).where(safeIn(evidenceItems.id, evidenceIds))
      : [];

  // 10) بلاغات صيانة بمكلف اصطناعي (الغرف بلا مرسى بنيوي — تترك للمراجعة اليدوية)
  const allMaint = await db
    .select({ id: maintenanceIssues.id, title: maintenanceIssues.title, ownerPersonId: maintenanceIssues.ownerPersonId })
    .from(maintenanceIssues);
  const synthMaint = allMaint.filter((m) => m.ownerPersonId != null && peopleSet.has(m.ownerPersonId));
  const maintenanceIds = synthMaint.map((m) => m.id);

  // تجميع المرشحين مع الأسباب
  const candidates: SyntheticCandidate[] = [
    ...synthPeople.map((p) => ({ entityType: "person" as const, id: p.id, label: p.name, reason: "شخص من دفعة استيراد اختبارية (اسم ملفها يحوي «تجريبي»)" })),
    ...synthPrograms.map((p) => ({
      entityType: "program" as const,
      id: p.id,
      label: p.name,
      reason: p.batchId && syntheticBatchIds.includes(p.batchId)
        ? "برنامج من دفعة استيراد اختبارية"
        : "برنامج ضمن سنة تخطيطية للعرض (demo)",
    })),
    ...synthCommittees.map((c) => ({ entityType: "committee" as const, id: c.id, label: c.name, reason: c.reason })),
    ...synthMeetings.map((m) => ({ entityType: "meeting" as const, id: m.id, label: m.title ?? "اجتماع", reason: "اجتماع للجنة اصطناعية" })),
    ...synthCycles.map((c) => ({ entityType: "perf_cycle" as const, id: c.id, label: "دورة أداء", reason: "دورة أداء لشخص اصطناعي" })),
    ...synthSessions.map((s) => ({ entityType: "perf_session" as const, id: s.id, label: "جلسة أداء", reason: "جلسة ضمن دورة أداء اصطناعية" })),
    ...synthTasks.map((t) => ({ entityType: "task" as const, id: t.id, label: t.title, reason: "مهمة مصدرها كيان اصطناعي" })),
    ...synthDocs.map((d) => ({ entityType: "document" as const, id: d.id, label: d.title, reason: "وثيقة صادرة عن كيان اصطناعي" })),
    ...evLabels.map((e) => ({ entityType: "evidence" as const, id: e.id, label: e.title, reason: "شاهد مرتبط بكيان اصطناعي" })),
    ...synthMaint.map((m) => ({ entityType: "maintenance" as const, id: m.id, label: m.title, reason: "بلاغ صيانة بمكلف اصطناعي" })),
  ];

  const ids: SyntheticIdSets = {
    people: peopleSet,
    programs: programSet,
    committees: new Set(committeeIds),
    meetings: new Set(meetingIds),
    perfCycles: new Set(cycleIds),
    perfSessions: sessionSet,
    tasks: new Set(taskIds),
    documents: new Set(documentIds),
    evidence: new Set(evidenceIds),
    maintenance: new Set(maintenanceIds),
  };

  // المشتبَه بهم بالاسم وحده (بلا مرسى بنيوي) — لا يُستبعدون
  const nameOnlySuspects = await collectNameOnlySuspects(ids);

  const counts = {
    person: peopleSet.size,
    program: programSet.size,
    committee: ids.committees.size,
    meeting: ids.meetings.size,
    perf_cycle: ids.perfCycles.size,
    perf_session: ids.perfSessions.size,
    task: ids.tasks.size,
    document: ids.documents.size,
    evidence: ids.evidence.size,
    maintenance: ids.maintenance.size,
  } as Record<SyntheticEntityType, number>;

  return { syntheticBatchIds, ids, candidates, nameOnlySuspects, counts };
}

/** سجلات اسمها يحوي «تجريبي» لكنها بلا مرسى بنيوي — تعرض للمراجعة اليدوية فقط */
async function collectNameOnlySuspects(ids: SyntheticIdSets): Promise<SyntheticCandidate[]> {
  const suspects: SyntheticCandidate[] = [];
  const namedPeople = await db.select({ id: people.id, name: people.fullName }).from(people).where(like(people.fullName, NAME_MARKER));
  for (const p of namedPeople) if (!ids.people.has(p.id)) suspects.push({ entityType: "person", id: p.id, label: p.name, reason: "الاسم يحوي «تجريبي» بلا دليل بنيوي — يحتاج تأكيداً يدوياً" });
  const namedPrograms = await db.select({ id: programs.id, name: programs.name }).from(programs).where(like(programs.name, NAME_MARKER));
  for (const p of namedPrograms) if (!ids.programs.has(p.id)) suspects.push({ entityType: "program", id: p.id, label: p.name, reason: "الاسم يحوي «تجريبي» بلا دليل بنيوي — يحتاج تأكيداً يدوياً" });
  const namedCommittees = await db.select({ id: committees.id, name: committees.nameAr }).from(committees).where(like(committees.nameAr, NAME_MARKER));
  for (const c of namedCommittees) if (!ids.committees.has(c.id)) suspects.push({ entityType: "committee", id: c.id, label: c.name, reason: "الاسم يحوي «تجريبي» بلا دليل بنيوي — يحتاج تأكيداً يدوياً" });
  return suspects;
}

/**
 * هل يُفعَّل استبعاد الاصطناعي في القراءة؟ مفعّل افتراضياً (التطوير/الإنتاج) ويُعطَّل
 * صراحةً في بيئة اختبار الواجهة (MADRASA_INCLUDE_SYNTHETIC=1) حيث بيانات السيناريو
 * اصطناعية بالتصميم ويجب أن تظهر للتحقق من سير العمل.
 */
export function syntheticExclusionEnabled(): boolean {
  return process.env.MADRASA_INCLUDE_SYNTHETIC !== "1";
}

/** مجموعات المعرفات المستبعدة — فارغة عند تعطيل الاستبعاد */
export async function getExcludedIdSets(): Promise<SyntheticIdSets> {
  if (!syntheticExclusionEnabled()) return emptySets();
  const { ids } = await classifySynthetic();
  return ids;
}

/** يصفّي قائمة عناصر مجلوبة مسبقاً حسب مجموعة معرفات مستبعدة */
export function filterOutSynthetic<T extends { id: string }>(rows: T[], excluded: Set<string>): T[] {
  if (excluded.size === 0) return rows;
  return rows.filter((r) => !excluded.has(r.id));
}

/**
 * شرط SQL «ليس اصطناعياً» لعمود معرّف — يُدمج في .where().
 * يعيد undefined عند خلو المجموعة (لا تصفية) فيتجاهله drizzle.
 */
export function notSynthetic(col: AnyColumn, excluded: Set<string>): SQL | undefined {
  return excluded.size > 0 ? notInArray(col, [...excluded]) : undefined;
}

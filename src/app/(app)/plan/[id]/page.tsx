import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import {
  programs, programDeliverables, programChangeRequests, programRoadmapCells, programFollowups,
  programClosureHistory, programEditHistory, users,
} from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { evidenceForEntity } from "@/lib/evidence";
import { programEvidenceSummary } from "@/lib/plan/program-service";
import { evidenceCountPhrase } from "@/lib/plan/evidence-summary";
import { isFollowupDue, FOLLOWUP_STATUSES } from "@/lib/plan/followup";
import { programStatusLabel } from "@/lib/plan/status-labels";
import { programLifecycle, nextLifecycleAction, PROGRAM_LIFECYCLE } from "@/lib/plan/lifecycle";
import { getVersions } from "@/lib/versioning";
import {
  EDITABLE_FIELD_KEYS,
  EDITABLE_PROGRAM_FIELDS,
  EDIT_HISTORY_LABEL,
  EDITED_AFTER_APPROVAL_MARKER,
  MULTILINE_PROGRAM_FIELDS,
  editWarningsFor,
  normalizeValue,
  reasonRequiredFor,
} from "@/lib/plan/program-edit";
import { PageHeader, Card, Badge, ProgressBar, LinkButton, WorkflowSteps, DualDate, Table } from "@/components/ui";
import { dualDisplay } from "@/lib/dates";
import { orFallback, formatMoney, numOrNull } from "@/lib/format";
import { FollowupDueBadge } from "../followup-badge";
import {
  ApproveProgramButton, ReopenForm, ChangeRequestForm,
  ChangeRequestDecision, ProgramExecutionForm,
  ArchiveProgramForm, UnarchiveProgramButton,
  CloseProgramForm, ReopenClosedProgramForm,
  CompleteProgramForm, ResumeProgramForm, EditProgramForm,
} from "./program-ui";
import { EvidencePanel } from "@/components/evidence-panel";

export const dynamic = "force-dynamic";

export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePermission("plan.read");
  const { id } = await params;
  // v2.5.0 §5.1: فتح نموذج التعديل مباشرةً من أي نقطة دخول (طابور الاعتماد، القوائم،
  // ترويسة الصفحة) — لا بحث عن زر داخل الصفحة
  const openEditor = (await searchParams)["تعديل"] === "1";
  const excluded = await getExcludedIdSets();
  const [program] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.id, id), notSynthetic(programs.id, excluded.programs)));
  if (!program) notFound();

  const [deliverables, changeRequests, roadmap, evidence, evidenceSummary, versions, followups, closureHistory, editHistory] = await Promise.all([
    db.select().from(programDeliverables).where(eq(programDeliverables.programId, id)),
    db.select().from(programChangeRequests).where(eq(programChangeRequests.programId, id)),
    db.select().from(programRoadmapCells).where(eq(programRoadmapCells.programId, id)).orderBy(asc(programRoadmapCells.sortOrder)),
    evidenceForEntity("program", id),
    programEvidenceSummary(id),
    getVersions("program", id),
    db.select().from(programFollowups).where(eq(programFollowups.programId, id)).orderBy(desc(programFollowups.createdAt)).limit(8),
    db.select().from(programClosureHistory).where(eq(programClosureHistory.programId, id)).orderBy(desc(programClosureHistory.at)),
    db.select().from(programEditHistory).where(eq(programEditHistory.programId, id)).orderBy(desc(programEditHistory.at)),
  ]);

  // البرنامج نفسه وحدة التنفيذ (D-024): التقدم والحالة مقروءان مباشرةً من سجل البرنامج،
  // لا من أنشطة موزونة. الشواهد معلوماتية فقط بلا هدف أو نسبة جاهزية (D-025).
  // البرنامج المؤرشف (v2.1 §A1) للقراءة فقط — لا تحديث تنفيذ حتى يُسترجع.
  const isArchived = Boolean(program.archivedAt);
  // البرنامج المغلق نهائياً (v2.2 §A2) للقراءة فقط أيضاً — لا تحديث تنفيذ حتى يُعاد فتحه.
  const isClosed = Boolean(program.closedAt);
  // سير العمل ثلاثي الحالات: «قيد التنفيذ» / «مكتمل» / «مغلق» — مشتق من العمودين الزمنيين
  const lifecycle = programLifecycle(program);
  const isCompleted = lifecycle === PROGRAM_LIFECYCLE.completed;
  // v2.4.1 §1.6: الإقفال وإقفال السنة لم يعودا يمنعان تحديث التنفيذ — يلزمه سبب مكتوب.
  // الأرشفة وحدها تبقى مستثناة: هي إخفاء مقصود يُستعاد بإجراء واحد ظاهر قبل أي تحرير.
  const canWrite = user.permissions.has("plan.write") && !isArchived;
  const executionReasonRequired = isClosed || isCompleted || program.status === "مقفل";
  const canApprove = user.permissions.has("plan.approve");

  // أسماء المسؤولين عن تحولات الحالة (آخر مسؤول + منفّذو سجل التحولات)
  const actorIds = [
    ...new Set(
      [program.completedBy, program.closedBy, program.reopenedBy, ...closureHistory.map((h) => h.actorId)]
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const actorRows = actorIds.length
    ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, actorIds))
    : [];
  const actorName = (uid: string | null) => actorRows.find((u) => u.id === uid)?.displayName ?? null;
  // آخر مسؤول = منفّذ أحدث تحول في السجل (السجل مرتب تنازلياً)، وإلا مسؤول الحالة الراهنة
  const lastResponsible =
    actorName(closureHistory[0]?.actorId ?? null) ??
    actorName(program.closedBy) ??
    actorName(program.completedBy) ??
    null;
  /* v2.4.1 §1.6: التعديل مسموح في كل حالات دورة الحياة.
   * الشرط الوحيد الباقي هو الصلاحية — لا الحالة. البرنامج المؤرشف يبقى مستثنى لأن
   * الأرشفة إخفاء مقصود يُستعاد بإجراء واحد ظاهر، لا حالة عمل تُعدَّل بداخلها. */
  const canEdit = user.permissions.has("plan.write") && !isArchived;
  const editState = { approvalStatus: program.status, lifecycle };
  const editWarnings = editWarningsFor(editState);
  const editReasonRequired = reasonRequiredFor(editState);
  const editableValues = EDITABLE_FIELD_KEYS.map((key) => ({
    key,
    label: EDITABLE_PROGRAM_FIELDS[key],
    value: normalizeValue((program as unknown as Record<string, unknown>)[key]),
    // الحقول السردية الطويلة في مربع نص متعدد الأسطر — الباقي حقل سطر واحد
    multiline: MULTILINE_PROGRAM_FIELDS.has(key),
  }));
  const editedAfterApproval = editHistory.some(
    (h) => h.approvalStatusAtEdit !== "مسودة" || h.lifecycleAtEdit !== PROGRAM_LIFECYCLE.active,
  );

  // سجلات مرتبطة تحدد صياغة تأكيد الأرشفة (إخفاء مع الاحتفاظ بالسجلات التاريخية)
  const hasLinkedData =
    evidence.length > 0 || deliverables.length > 0 || roadmap.length > 0 || followups.length > 0 || changeRequests.length > 0;

  /** مراحل سير عمل البرنامج: الإعداد ← الاعتماد ← التنفيذ والمتابعة ← الإقفال */
  const workflowCurrent =
    program.status === "مقفل" || isClosed ? 4 : program.status === "معتمد" ? 2 : 0;
  const followupDue = program.status === "معتمد" && isFollowupDue(program.lastReviewAt);

  const infoRows: [string, string | null][] = [
    ["المجال", program.domain],
    ["الهدف العام", program.generalGoal],
    ["الهدف الخاص", program.specificGoal],
    ["مبررات التنفيذ", program.rationale],
    ["الفئة المستهدفة", program.targetGroup],
    ["آلية التنفيذ", program.mechanism],
    ["فترة التنفيذ", program.periodText],
    ["مسؤول التنفيذ", program.ownerPosition],
    ["المشاركون", program.participants],
    ["مؤشر النجاح", program.kpiText],
    ["المستهدف", program.targetText],
    ["خط الأساس", program.baselineText],
    ["المخرج المطلوب", program.deliverableText],
    ["الشواهد المطلوبة", program.evidenceText],
    ["متابعة التنفيذ", program.followupText],
    ["الأثر المتوقع", program.expectedImpact],
    ["الأولوية", program.priority],
    ["الميزانية", numOrNull(program.budget) !== null ? `${formatMoney(program.budget)} ريال` : null],
    ["تاريخ البدء", program.hijriStart ? `${program.hijriStart}هـ` : null],
    ["تاريخ الانتهاء", program.hijriEnd ? `${program.hijriEnd}هـ` : null],
    ["فترات التوقف", program.pausePeriods],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${program.seq}. ${orFallback(program.name)}`}
        subtitle={orFallback(program.domain, "بدون تصنيف")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isArchived && <Badge value="مؤرشف" />}
            <Badge value={lifecycle} />
            <Badge value={programStatusLabel(program.status)} />
            {/* v2.5.0 §5.1: «تعديل البرنامج» إجراء رئيسي في أعلى الصفحة — لا زر ثانوي
                داخل بطاقة في منتصفها. شكوى المدير على v2.4.1 لم تكن أن التعديل ممنوع
                (لم يكن)، بل أنه غير ظاهر. الرابط يفتح النموذج مباشرةً عبر `?تعديل=1`. */}
            {canEdit && (
              <LinkButton href={`/plan/${id}?تعديل=1#edit`}>تعديل البرنامج</LinkButton>
            )}
            {/* v2.4 §10: نقطة وصول ظاهرة للطباعة — التقرير وبطاقة البرنامج من صفحة واحدة */}
            {user.permissions.has("reports.generate") && (
              <LinkButton href={`/plan/${id}/report`} variant="secondary">طباعة بطاقة البرنامج</LinkButton>
            )}
          </div>
        }
      />

      {isArchived && (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-amber-900">هذا البرنامج مؤرشف — مخفي من القوائم والتقارير التشغيلية</p>
              <p className="mt-1 text-xs text-amber-700">
                سجلاته التاريخية محفوظة كاملة.
                {program.archivedReason ? ` سبب الأرشفة: ${program.archivedReason}` : ""}
              </p>
            </div>
            {canApprove && <UnarchiveProgramButton programId={id} />}
          </div>
        </Card>
      )}

      {isClosed && (
        <Card className="border-gray-300 bg-gray-50">
          <div className="min-w-0">
            <p className="font-medium text-gray-800">هذا البرنامج مغلق نهائياً — للقراءة فقط ومرفوع من القوائم التشغيلية</p>
            <p className="mt-1 text-xs text-gray-600">
              لا تعديل ولا متابعة حتى يُعاد فتحه. السجل كامل ومحفوظ: الشواهد والوثائق والمراجع
              المالية والملاحظات والتقارير كما هي، ويبقى البرنامج متاحاً للعرض والطباعة والتصدير
              في التقارير والعروض التاريخية.
              {program.closureNote ? ` ملاحظة الإقفال: ${program.closureNote}` : ""}
            </p>
          </div>
        </Card>
      )}

      {isCompleted && !isArchived && (
        <Card className="border-emerald-200 bg-emerald-50">
          <div className="min-w-0">
            <p className="font-medium text-emerald-900">هذا البرنامج مكتمل</p>
            <p className="mt-1 text-xs text-emerald-800">
              يبقى قابلاً للتحرير وإضافة الشواهد والوثائق حتى إقفاله نهائياً، ويظهر في عروض
              وتقارير البرامج المكتملة.
              {program.completionNote ? ` ملاحظة الاكتمال: ${program.completionNote}` : ""}
            </p>
          </div>
        </Card>
      )}

      <Card>
        <WorkflowSteps steps={["الإعداد", "الاعتماد", "التنفيذ والمتابعة", "الإقفال"]} current={workflowCurrent} />
        <div className="mt-3 border-t border-sand-100 pt-3 text-sm">
          {program.status === "مسودة" && (
            canApprove ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-gray-700">الخطوة التالية: راجع بيانات البرنامج ثم اعتمده</span>
                <ApproveProgramButton programId={id} />
              </div>
            ) : (
              <p className="text-gray-700">
                <span className="font-medium">الخطوة التالية:</span> البرنامج قيد الإعداد — بانتظار اعتماد المدير
              </p>
            )
          )}
          {program.status === "معتمد" && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-gray-700">الخطوة التالية: سجّل المتابعة الأسبوعية وحدّث نسبة الإنجاز</span>
              {followupDue && <FollowupDueBadge />}
              <LinkButton href="/plan/followup">المتابعة الأسبوعية</LinkButton>
            </div>
          )}
          {program.status === "مقفل" && (
            <p className="text-gray-500">السنة مقفلة — البرنامج مؤرشف للقراءة فقط ولا تقبل تعديلات أو متابعات</p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">نسبة الإنجاز</h2>
          <ProgressBar value={program.progress} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">حالة التنفيذ</h2>
          <Badge value={program.executionStatus} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">الاعتماد</h2>
          {program.status === "مسودة" && canApprove ? (
            <ApproveProgramButton programId={id} />
          ) : program.status === "معتمد" && canApprove ? (
            <ReopenForm programId={id} />
          ) : (
            <p className="text-sm text-gray-500">{program.status === "مقفل" ? "السنة مقفلة — قراءة فقط" : "بانتظار الاعتماد"}</p>
          )}
        </Card>
      </div>

      {canWrite && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">تحديث تقدم البرنامج وحالته</h2>
          <p className="mb-3 text-xs text-gray-500">
            البرنامج نفسه وحدة التنفيذ والمتابعة — أدخل نسبة الإنجاز الحالية وحالة التنفيذ مباشرةً.
          </p>
          <ProgramExecutionForm
            programId={id}
            progress={program.progress}
            executionStatus={program.executionStatus}
            reasonRequired={executionReasonRequired}
          />
        </Card>
      )}

      <Card id="edit">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">بطاقة البرنامج (القيم الرسمية من المصدر)</h2>
          {/* v2.4.1 §1.6: التعديل متاح في كل حالة — مسودة ومعتمد ومكتمل ومغلق */}
          {canEdit && (
            <EditProgramForm
              programId={id}
              values={editableValues}
              warnings={editWarnings}
              reasonRequired={editReasonRequired}
              updatedToken={program.updatedAt.toISOString()}
              initiallyOpen={openEditor}
            />
          )}
        </div>
        {editedAfterApproval && (
          <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            {EDITED_AFTER_APPROVAL_MARKER} — {editHistory.length} تغييراً مسجَّلاً. علامة معلوماتية
            لا تمنع أي إجراء ولا تغيّر حالة الاعتماد.
          </p>
        )}
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          {infoRows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-32 shrink-0 font-medium text-gray-500">{k}:</dt>
              <dd className="text-gray-800">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* v2.4.1 §1.6: سجل التغييرات — قيمة سابقة وجديدة وحالة البرنامج وقت التعديل وسببه */}
      {editHistory.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">{EDIT_HISTORY_LABEL} ({editHistory.length})</h2>
          <Table headers={["الحقل", "القيمة السابقة", "القيمة الجديدة", "حالة البرنامج", "السبب", "بواسطة", "التاريخ"]}>
            {editHistory.map((h) => (
              <tr key={h.id}>
                <td className="px-3 py-2 font-medium">{h.fieldLabel}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{h.oldValue ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{h.newValue ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{h.approvalStatusAtEdit} · {h.lifecycleAtEdit}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{h.reason ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{actorName(h.actorId) ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{h.at.toLocaleDateString("ar-SA-u-nu-latn")}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {deliverables.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">المخرجات</h2>
          <div className="space-y-2">
            {deliverables.map((d) => (
              <div key={d.id} className="rounded-lg border border-sand-200 p-3">
                <div className="font-medium">{d.mainOutput}</div>
                <div className="mt-1 text-xs text-gray-500">
                  الشواهد المقبولة: {d.acceptedEvidence ?? "—"} · موعد التسليم: {d.dueText ?? "—"}
                  {d.packageNumber ? ` · ${d.packageNumber}` : ""}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div id="evidence" className="scroll-mt-20">
        <Card className="mb-4">
          <h2 className="mb-1 font-bold text-brand-900">شواهد البرنامج</h2>
          <p className="text-sm text-gray-700">
            {evidenceCountPhrase(evidenceSummary.count)}
            {evidenceSummary.latestAt && (
              <span className="text-gray-500">
                {" "}· آخر رفع: {evidenceSummary.latestAt.toLocaleDateString("ar-SA-u-nu-latn")}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-400">عدد الشواهد معلوماتي فقط ولا يحدد إمكانية إكمال البرنامج.</p>
        </Card>

        <EvidencePanel
          entityType="program"
          entityId={id}
          items={evidence.map((e) => ({ id: e.item.id, title: e.item.title, kind: e.item.kind, role: e.item.role, fileId: e.item.fileId }))}
          // البرنامج المغلق نهائياً للقراءة فقط — الشواهد تُعرض وتبقى محفوظة، ولا تُضاف/تُعدَّل.
          // البرنامج «المكتمل» يقبل إضافة الشواهد كالمعتاد.
          canWrite={user.permissions.has("evidence.write") && !isClosed}
        />
      </div>

      {roadmap.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">خارطة التنفيذ السنوية</h2>
          <div className="flex flex-wrap gap-2">
            {roadmap.map((c) => (
              <div key={c.id} className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs">
                <div className="text-gray-500">{c.periodLabel}</div>
                <div className="font-medium">{c.phase}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div id="followups" className="scroll-mt-20">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">المتابعة الأسبوعية</h2>
          <LinkButton href="/plan/followup" variant="secondary">صفحة المتابعة الأسبوعية</LinkButton>
        </div>
        {program.status === "مسودة" && (
          // معاينة ثابتة معطّلة لنموذج المتابعة — يراها المدير قبل الاعتماد دون أي إدخال أو حفظ.
          // لا فعل خادم مرتبط ولا حقول قابلة للإرسال؛ النموذج الفعلي يظهر في «/plan/followup» بعد الاعتماد.
          <div className="mb-3 rounded-lg border border-dashed border-sand-300 bg-sand-50/60 p-3">
            <p className="mb-2 text-xs font-medium text-gray-500">
              معاينة نموذج المتابعة الأسبوعية — يُفعَّل بعد اعتماد البرنامج (غير قابل للإدخال الآن)
            </p>
            <div className="flex flex-wrap items-end gap-2 opacity-60">
              <div className="min-w-0 flex-1 basis-56">
                <label className="mb-1 block text-xs text-gray-500">متابعة هذا الأسبوع</label>
                <input disabled placeholder="ماذا أنجز؟ وما العوائق؟" className="w-full min-w-0 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm" />
              </div>
              <div className="basis-36">
                <label className="mb-1 block text-xs text-gray-500">حالة التنفيذ</label>
                <select disabled className="w-full min-w-0 rounded-lg border border-gray-300 bg-gray-100 px-2 py-1.5 text-sm">
                  {FOLLOWUP_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <span className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-400">تسجيل المتابعة</span>
            </div>
          </div>
        )}
        {followups.length === 0 ? (
          <p className="text-sm text-gray-400">
            {program.status === "معتمد"
              ? "لا متابعات مسجلة بعد — سجل أول متابعة أسبوعية من صفحة المتابعة"
              : "تسجل المتابعات الأسبوعية بعد اعتماد البرنامج"}
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            {followups.map((f) => (
              <div key={f.id} className="rounded-lg border border-sand-200 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs tabular-nums text-gray-500">{f.weekKey}</span>
                  <Badge value={f.executionStatus} />
                  <span className="text-xs text-gray-400">
                    {f.createdAt.toLocaleDateString("ar-SA-u-nu-latn")} · التقدم حينها: {f.progressSnapshot}٪
                  </span>
                </div>
                <p className="mt-1 text-gray-700">{f.note}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>

      <div id="change-requests" className="scroll-mt-20">
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">طلبات التغيير</h2>
        {program.status !== "مسودة" && program.status !== "مقفل" && (
          <ChangeRequestForm programId={id} />
        )}
        {program.status === "مسودة" && (
          // معاينة ثابتة معطّلة لنموذج طلب التغيير — مسودة البرنامج تُحرَّر مباشرة، وطلب التغيير
          // الموثق يُفعَّل بعد الاعتماد. لا فعل خادم مرتبط ولا حقول قابلة للإرسال.
          <div className="rounded-lg border border-dashed border-sand-300 bg-sand-50/60 p-3">
            <p className="mb-2 text-xs font-medium text-gray-500">
              معاينة نموذج طلب التغيير — يُفعَّل بعد الاعتماد (المسودة تُحرَّر مباشرة؛ الطلب الموثق للبرامج المعتمدة)
            </p>
            <div className="flex flex-wrap items-end gap-2 opacity-60">
              <div>
                <label className="block text-xs text-gray-500">الحقل</label>
                <select disabled className="rounded border border-gray-300 bg-gray-100 px-2 py-1.5 text-sm"><option>الهدف الخاص</option></select>
              </div>
              <div className="min-w-0 flex-1 basis-52">
                <label className="block text-xs text-gray-500">القيمة الجديدة</label>
                <input disabled className="w-full min-w-0 rounded border border-gray-300 bg-gray-100 px-2 py-1.5 text-sm" />
              </div>
              <div className="min-w-0 flex-1 basis-52">
                <label className="block text-xs text-gray-500">السبب (إلزامي)</label>
                <input disabled className="w-full min-w-0 rounded border border-gray-300 bg-gray-100 px-2 py-1.5 text-sm" />
              </div>
              <span className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-400">طلب تغيير</span>
            </div>
          </div>
        )}
        {changeRequests.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">لا طلبات تغيير — تعديل برنامج معتمد يتم حصراً عبر طلب تغيير موثق</p>
        ) : (
          <div className="mt-3 space-y-2">
            {changeRequests.map((cr) => (
              <div key={cr.id} className="rounded-lg border border-sand-200 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{cr.fieldLabel}</span>
                  <Badge value={cr.status} />
                </div>
                <div className="mt-1 grid gap-1 text-xs text-gray-600 md:grid-cols-2">
                  <div><span className="text-gray-400">القيمة القديمة:</span> {cr.oldValue || "—"}</div>
                  <div><span className="text-gray-400">القيمة الجديدة:</span> {cr.newValue}</div>
                </div>
                <div className="mt-1 text-xs text-gray-500">السبب: {cr.reason}</div>
                {cr.status === "قيد الاعتماد" && canApprove && <ChangeRequestDecision requestId={cr.id} />}
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>

      {versions.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">سجل النسخ</h2>
          <div className="space-y-1 text-sm">
            {versions.map((v) => (
              <div key={v.id} className="flex flex-wrap gap-2 text-gray-600">
                <span className="tabular-nums">نسخة {v.version}</span>
                <span>·</span>
                <span>{v.action === "approved" ? "اعتماد" : v.action === "reopened" ? "إعادة فتح" : "تحديث"}</span>
                {v.reason && <span className="text-gray-400">— {v.reason}</span>}
                <span className="text-xs text-gray-400">{v.createdAt.toLocaleDateString("ar-SA-u-nu-latn")}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* سير عمل البرنامج ثلاثي الحالات: «قيد التنفيذ» ← «مكتمل» ← «مغلق» — منفصل عن
          الأرشفة (الحذف الناعم) وعن اعتماد الحزمة وعن إقفال السنة */}
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">حالة البرنامج</h2>
        <dl className="mb-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          <div className="flex items-center gap-2">
            <dt className="w-32 shrink-0 font-medium text-gray-500">الحالة الحالية:</dt>
            <dd><Badge value={lifecycle} /></dd>
          </div>
          {program.completedAt && (
            <div className="flex items-center gap-2">
              <dt className="w-32 shrink-0 font-medium text-gray-500">تاريخ الاكتمال:</dt>
              <dd className="text-gray-800">
                {(() => { const d = dualDisplay(program.completedAt, "employee"); return d ? <DualDate primary={d.primary} secondary={d.secondary} /> : "—"; })()}
              </dd>
            </div>
          )}
          {program.closedAt && (
            <div className="flex items-center gap-2">
              <dt className="w-32 shrink-0 font-medium text-gray-500">تاريخ الإقفال:</dt>
              <dd className="text-gray-800">
                {(() => { const d = dualDisplay(program.closedAt, "employee"); return d ? <DualDate primary={d.primary} secondary={d.secondary} /> : "—"; })()}
              </dd>
            </div>
          )}
          {lastResponsible && (
            <div className="flex items-center gap-2">
              <dt className="w-32 shrink-0 font-medium text-gray-500">آخر مسؤول:</dt>
              <dd className="text-gray-800">{lastResponsible}</dd>
            </div>
          )}
          {!isArchived && (
            <div className="flex items-center gap-2">
              <dt className="w-32 shrink-0 font-medium text-gray-500">الإجراء المتاح:</dt>
              <dd className="text-gray-800">{nextLifecycleAction(program)}</dd>
            </div>
          )}
        </dl>

        {!isArchived && (
          <div className="space-y-4 border-t border-sand-100 pt-3">
            {lifecycle === PROGRAM_LIFECYCLE.active && canWrite && (
              <CompleteProgramForm programId={id} programName={orFallback(program.name)} />
            )}
            {isCompleted && canApprove && (
              <CloseProgramForm programId={id} programName={orFallback(program.name)} />
            )}
            {isCompleted && canWrite && (
              <ResumeProgramForm programId={id} programName={orFallback(program.name)} />
            )}
            {isClosed && canApprove && (
              <ReopenClosedProgramForm programId={id} programName={orFallback(program.name)} />
            )}
          </div>
        )}

        {closureHistory.length > 0 && (
          <div className="mt-4 border-t border-sand-100 pt-3">
            <h3 className="mb-2 text-xs font-bold text-gray-600">سجل تحولات الحالة</h3>
            <ul className="space-y-1 text-xs text-gray-600">
              {closureHistory.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <Badge value={h.action} />
                  {h.fromStatus && h.toStatus && (
                    <span className="text-gray-500">{h.fromStatus} ← {h.toStatus}</span>
                  )}
                  <span className="tabular-nums text-gray-400">
                    {h.at.toLocaleDateString("ar-SA-u-nu-latn")}
                  </span>
                  {actorName(h.actorId) && <span className="text-gray-500">· {actorName(h.actorId)}</span>}
                  {h.note && <span className="text-gray-500">— {h.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {canApprove && !isArchived && (
        <Card className="border-red-100">
          <h2 className="mb-2 font-bold text-red-700">أرشفة البرنامج (حذف)</h2>
          <ArchiveProgramForm programId={id} programName={orFallback(program.name)} hasLinkedData={hasLinkedData} />
        </Card>
      )}
    </div>
  );
}

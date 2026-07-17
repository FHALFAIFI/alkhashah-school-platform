import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import {
  programs, programMilestones, programDeliverables, programChangeRequests, programRoadmapCells, programFollowups,
} from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { evidenceForEntity } from "@/lib/evidence";
import { computePackageReadiness } from "@/lib/plan/progress";
import { isFollowupDue } from "@/lib/plan/followup";
import { getVersions } from "@/lib/versioning";
import { PageHeader, Card, Badge, ProgressBar, LinkButton, WorkflowSteps } from "@/components/ui";
import { FollowupDueBadge } from "../followup-badge";
import {
  MilestoneRow, AddMilestoneForm, ApproveProgramButton, ReopenForm, ChangeRequestForm,
  ChangeRequestDecision, ApprovePackageButton,
} from "./program-ui";
import { EvidencePanel } from "@/components/evidence-panel";
import { AskAssistant } from "@/components/assistant/ask-assistant";

export const dynamic = "force-dynamic";

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("plan.read");
  const { id } = await params;
  const excluded = await getExcludedIdSets();
  const [program] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.id, id), notSynthetic(programs.id, excluded.programs)));
  if (!program) notFound();

  const [milestones, deliverables, changeRequests, roadmap, evidence, versions, followups] = await Promise.all([
    db.select().from(programMilestones).where(eq(programMilestones.programId, id)).orderBy(asc(programMilestones.sortOrder)),
    db.select().from(programDeliverables).where(eq(programDeliverables.programId, id)),
    db.select().from(programChangeRequests).where(eq(programChangeRequests.programId, id)),
    db.select().from(programRoadmapCells).where(eq(programRoadmapCells.programId, id)).orderBy(asc(programRoadmapCells.sortOrder)),
    evidenceForEntity("program", id),
    getVersions("program", id),
    db.select().from(programFollowups).where(eq(programFollowups.programId, id)).orderBy(desc(programFollowups.createdAt)).limit(8),
  ]);

  const canWrite = user.permissions.has("plan.write") && program.status === "مسودة";
  const canApprove = user.permissions.has("plan.approve");
  const totalWeight = milestones.reduce((s, m) => s + m.weight, 0);
  const evidenceRoles = evidence.map((e) => e.item.role ?? "").filter(Boolean);

  /** مراحل سير عمل البرنامج: الإعداد ← الاعتماد ← التنفيذ والمتابعة ← الإقفال */
  const weightsReady = milestones.length > 0 && totalWeight === 100;
  const workflowCurrent =
    program.status === "مقفل" ? 4 : program.status === "معتمد" ? 2 : weightsReady ? 1 : 0;
  const packagesWithGaps = deliverables.filter(
    (d) => computePackageReadiness({ requiresExternal: d.requiresExternal, evidenceRoles }).missing.length > 0,
  ).length;
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
    ["الميزانية", program.budget ? `${program.budget} ريال` : "0"],
    ["تاريخ البدء", program.hijriStart ? `${program.hijriStart}هـ` : null],
    ["تاريخ الانتهاء", program.hijriEnd ? `${program.hijriEnd}هـ` : null],
    ["فترات التوقف", program.pausePeriods],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${program.seq}. ${program.name}`}
        subtitle={program.domain}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={program.status} />
            {user.permissions.has("ai.use") && <AskAssistant type="program" id={id} label={`برنامج: ${program.name}`} />}
            <LinkButton href={`/plan/${id}/report`} variant="secondary">تقرير البرنامج</LinkButton>
          </div>
        }
      />

      <Card>
        <WorkflowSteps steps={["الإعداد", "الاعتماد", "التنفيذ والمتابعة", "الإقفال"]} current={workflowCurrent} />
        <div className="mt-3 border-t border-sand-100 pt-3 text-sm">
          {program.status === "مسودة" && !weightsReady && (
            <p className="text-amber-700">
              <span className="font-medium">الخطوة التالية:</span>{" "}
              {milestones.length === 0
                ? "أضف معالم موزونة ثم اضبط أوزانها لتساوي 100"
                : "اضبط أوزان المعالم لتساوي 100"}{" "}
              <span className="text-xs text-amber-600">(المجموع الحالي: {totalWeight}٪)</span>
            </p>
          )}
          {program.status === "مسودة" && weightsReady && (
            canApprove ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-gray-700">الخطوة التالية: البرنامج جاهز للاعتماد</span>
                <ApproveProgramButton programId={id} disabled={false} totalWeight={totalWeight} />
              </div>
            ) : (
              <p className="text-gray-700">
                <span className="font-medium">الخطوة التالية:</span> البرنامج جاهز — بانتظار اعتماد المدير
              </p>
            )
          )}
          {program.status === "معتمد" && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-gray-700">الخطوة التالية: سجل المتابعة الأسبوعية</span>
              {followupDue && <FollowupDueBadge />}
              <LinkButton href="/plan/followup">المتابعة الأسبوعية</LinkButton>
              {packagesWithGaps > 0 && (
                <a href="#evidence" className="text-xs text-amber-700 underline">
                  {packagesWithGaps === 1 ? "حزمة شواهد واحدة ناقصة" : `${packagesWithGaps} حزم شواهد ناقصة`} — أكمل الشواهد المطلوبة
                </a>
              )}
            </div>
          )}
          {program.status === "مقفل" && (
            <p className="text-gray-500">السنة مقفلة — البرنامج مؤرشف للقراءة فقط ولا تقبل تعديلات أو متابعات</p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">الإنجاز الكلي (من المعالم الموزونة)</h2>
          <ProgressBar value={program.progress} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">حالة التنفيذ</h2>
          <Badge value={program.executionStatus} />
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">الاعتماد</h2>
          {program.status === "مسودة" && canApprove ? (
            <ApproveProgramButton programId={id} disabled={milestones.length > 0 && totalWeight !== 100} totalWeight={totalWeight} />
          ) : program.status === "معتمد" && canApprove ? (
            <ReopenForm programId={id} />
          ) : (
            <p className="text-sm text-gray-500">{program.status === "مقفل" ? "السنة مقفلة — قراءة فقط" : "بانتظار الاعتماد"}</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">بطاقة البرنامج (القيم الرسمية من المصدر)</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          {infoRows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-32 shrink-0 font-medium text-gray-500">{k}:</dt>
              <dd className="text-gray-800">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-brand-900">المعالم الموزونة — أساس حساب التقدم</h2>
          <span className={`text-sm ${totalWeight === 100 ? "text-emerald-600" : "text-amber-600"}`}>
            مجموع الأوزان: {totalWeight}٪ {totalWeight !== 100 && "(يجب أن يساوي 100٪ قبل الاعتماد)"}
          </span>
        </div>
        <div className="space-y-2">
          {milestones.map((m) => (
            <MilestoneRow key={m.id} milestone={m} editable={user.permissions.has("plan.write")} draftMode={program.status === "مسودة"} />
          ))}
          {milestones.length === 0 && <p className="text-sm text-gray-400">لا معالم — أضف معالم موزونة لحساب التقدم</p>}
        </div>
        {canWrite && <AddMilestoneForm programId={id} />}
      </Card>

      <div id="evidence" className="scroll-mt-20">
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">المخرجات وحزمة الشواهد</h2>
        {deliverables.map((d) => {
          const { readiness, missing } = computePackageReadiness({
            requiresExternal: d.requiresExternal,
            evidenceRoles,
          });
          return (
            <div key={d.id} className="mb-3 rounded-lg border border-sand-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{d.mainOutput}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    الشواهد المقبولة: {d.acceptedEvidence ?? "—"} · موعد التسليم: {d.dueText ?? "—"} · {d.packageNumber}
                  </div>
                  {missing.length > 0 && (
                    <div className="mt-1 text-xs text-amber-600">ينقص الحزمة: شاهد {missing.join("، شاهد ")}</div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <ProgressBar value={readiness} />
                  <Badge value={d.packageStatus} />
                  {canApprove && d.packageDecision !== "معتمد" && readiness === 100 && (
                    <ApprovePackageButton deliverableId={d.id} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {deliverables.length === 0 && <p className="text-sm text-gray-400">لا مخرجات مسجلة</p>}
      </Card>
      </div>

      <EvidencePanel
        entityType="program"
        entityId={id}
        items={evidence.map((e) => ({ id: e.item.id, title: e.item.title, kind: e.item.kind, role: e.item.role, fileId: e.item.fileId }))}
        canWrite={user.permissions.has("evidence.write")}
      />

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
    </div>
  );
}

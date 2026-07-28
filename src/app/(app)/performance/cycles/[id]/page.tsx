import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people, improvementPlans, documents } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton, ProgressBar, WorkflowSteps } from "@/components/ui";
import { AskAssistant } from "@/components/assistant/ask-assistant";
import { cycleProgress, weakIndicators } from "@/lib/performance/scoring";
import { NewSessionForm, ImprovementPlanForm, PlanStatusControl } from "./cycle-ui";
import { dualDisplay, todayIso } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("performance.read", "performance.individual.read");
  const { id } = await params;
  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, id));
  if (!cycle) notFound();

  const [person] = await db.select().from(people).where(eq(people.id, cycle.personId));
  const sessions = await db.select().from(perfSessions).where(eq(perfSessions.cycleId, id)).orderBy(asc(perfSessions.createdAt));
  const allRatings = await db.select().from(perfRatings);
  const plans = await db.select().from(improvementPlans).where(eq(improvementPlans.cycleId, id));

  const snapshot = cycle.modelSnapshot as {
    model: { nameAr: string; official: boolean };
    indicators: { id: string; nameAr: string; weight: string; requiresEvidence: boolean }[];
  };
  const weightById = new Map(snapshot.indicators.map((i) => [i.id, Number(i.weight)]));

  // D-028: نمرر نوع الجلسة ليُستثنى «التخطيط» من كل حساب تقييمي داخل cycleProgress
  const sessionRatings = sessions.map((s) => ({
    sessionType: s.sessionType,
    sessionDate: s.sessionDate,
    createdAt: s.createdAt,
    ratings: allRatings
      .filter((r) => r.sessionId === s.id)
      .map((r) => ({ indicatorId: r.indicatorId, weight: weightById.get(r.indicatorId) ?? 0, rating: r.rating })),
  }));
  const progress = cycleProgress(sessionRatings);
  const weak = weakIndicators(progress.entries);
  const weakNames = snapshot.indicators.filter((i) => weak.includes(i.id)).map((i) => orFallback(i.nameAr));

  const visits = sessions.filter((s) => s.sessionType === "زيارة").length;
  const followups = sessions.filter((s) => s.sessionType === "متابعة").length;
  const canWrite = user.permissions.has("performance.write") && cycle.status !== "مقفلة";

  const context = cycle.cycleType === "معلم" ? "teacher" : "employee";
  const startDisplay = cycle.startDate ? dualDisplay(cycle.startDate, context) : null;
  const endDisplay = cycle.endDate ? dualDisplay(cycle.endDate, context) : null;

  // مؤشر المرحلة: يشتق من الجلسات أحادية الانعقاد (تخطيط/منتصف/نهائي)
  const doneStates = new Set(["مكتملة", "مقفلة"]);
  const stageSessions = [
    { type: "تخطيط", label: "التخطيط", session: sessions.find((s) => s.sessionType === "تخطيط"), deadline: cycle.planningDeadline },
    { type: "منتصف", label: "منتصف العام", session: sessions.find((s) => s.sessionType === "منتصف"), deadline: cycle.midDeadline },
    { type: "نهائي", label: "التقييم النهائي", session: sessions.find((s) => s.sessionType === "نهائي"), deadline: cycle.finalDeadline },
  ];
  const finalSession = stageSessions[2].session;
  const finalLocked = !!finalSession && finalSession.status === "مقفلة";
  const firstIncomplete = stageSessions.findIndex((st) => !st.session || !doneStates.has(st.session.status));
  const currentStep = finalLocked ? 4 : firstIncomplete === -1 ? 3 : firstIncomplete;
  const nextStage = stageSessions.find((st) => !st.session || !doneStates.has(st.session.status));
  const finalReportDoc = finalLocked && finalSession?.reportDocId
    ? (await db.select().from(documents).where(eq(documents.id, finalSession.reportDocId)))[0]
    : null;
  const today = todayIso();
  const employeeDeadlines = cycle.cycleType === "موظف"
    ? stageSessions.filter((st) => st.deadline)
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`دورة أداء: ${person.fullName}`}
        subtitle={`${cycle.cycleType} — ${orFallback(snapshot.model.nameAr)} — ${orDash(cycle.yearKey)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={cycle.status} />
            {user.permissions.has("ai.use") && (
              <AskAssistant type="performance" id={id} label={`دورة أداء: ${person.fullName} (${cycle.yearKey})`} />
            )}
          </div>
        }
      />

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">مرحلة الدورة</h2>
        <WorkflowSteps steps={["تخطيط", "منتصف العام", "التقييم النهائي", "الاكتمال"]} current={currentStep} />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-sand-100 pt-3">
          {finalLocked ? (
            <>
              <Badge value="مكتملة" />
              <span className="text-sm text-gray-600">الدورة مكتملة — أقفل التقييم النهائي بتقرير موقع.</span>
              {finalReportDoc?.pdfFileId ? (
                <a href={`/api/files/${finalReportDoc.pdfFileId}`} className="text-sm text-brand-700 underline">
                  تنزيل تقرير التقييم النهائي ({finalReportDoc.docNumber})
                </a>
              ) : (
                finalSession && (
                  <LinkButton href={`/performance/cycles/${id}/sessions/${finalSession.id}`} variant="secondary">
                    فتح التقييم النهائي
                  </LinkButton>
                )
              )}
            </>
          ) : nextStage ? (
            nextStage.session ? (
              <>
                <span className="text-sm text-gray-600">الإجراء التالي:</span>
                <LinkButton href={`/performance/cycles/${id}/sessions/${nextStage.session.id}`}>
                  أكمل جلسة {nextStage.type}
                </LinkButton>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-600">الإجراء التالي:</span>
                <LinkButton href="#sessions">أنشئ جلسة {nextStage.label}</LinkButton>
              </>
            )
          ) : (
            <span className="text-sm text-gray-600">أقفل التقييم النهائي لإكمال الدورة.</span>
          )}
        </div>
        {employeeDeadlines.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-sand-100 pt-3 sm:grid-cols-3">
            {employeeDeadlines.map((st) => {
              const d = dualDisplay(st.deadline!, "employee");
              const late = today > st.deadline! && (!st.session || !doneStates.has(st.session.status));
              return (
                <div key={st.type} className="rounded-lg bg-sand-50 p-2 text-sm">
                  <div className="text-xs text-gray-500">موعد {st.label}</div>
                  <div className="mt-0.5 font-medium tabular-nums">{d?.primary}</div>
                  <div className="text-xs text-gray-400 tabular-nums">{d?.secondary}</div>
                  {late && (
                    <div className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">متأخر عن الموعد</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <div className="text-xs text-gray-500">بداية الدورة</div>
          <div className="mt-1 text-sm font-medium tabular-nums">{startDisplay?.primary ?? "—"}</div>
          <div className="text-xs text-gray-400 tabular-nums">{startDisplay?.secondary}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">نهاية الدورة</div>
          <div className="mt-1 text-sm font-medium tabular-nums">{endDisplay?.primary ?? "—"}</div>
          <div className="text-xs text-gray-400 tabular-nums">{endDisplay?.secondary}</div>
        </Card>
        <Card>
          <div className="text-xs text-gray-500">نتيجة الدورة (أحدث تقدير لكل مؤشر)</div>
          {/* D-028: جلسة التخطيط لا تُحتسب — إن لم توجد تقديرات تقييمية بعد نعرض حالة لا 0٪ */}
          {progress.evaluated ? (
            <>
              <div className="mt-1 text-lg font-bold text-brand-900 tabular-nums">{progress.result.toFixed(2)}٪</div>
              <ProgressBar value={progress.coverage * 100} />
            </>
          ) : (
            <div className="mt-1 text-sm font-medium text-gray-500">لم يبدأ التقييم بعد</div>
          )}
        </Card>
        <Card>
          <div className="text-xs text-gray-500">الزيارات الصفية / المتابعات</div>
          <div className="mt-1 text-lg font-bold text-brand-900 tabular-nums">
            {visits} / {followups}
            <span className="text-xs font-normal text-gray-400"> (المستهدف {cycle.followupTarget})</span>
          </div>
        </Card>
      </div>

      <div id="sessions" className="scroll-mt-20">
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الجلسات ({sessions.length})</h2>
        <p className="mb-3 text-xs text-gray-400">
          التخطيط ومراجعة المنتصف والتقييم النهائي مرة واحدة لكل منها؛ الزيارات الصفية غير محدودة؛ المتابعات بمستهدف سنوي قابل للضبط.
        </p>
        {sessions.length > 0 && (
          <Table headers={["النوع", "التاريخ", "النتيجة", "التغطية", "الحالة", ""]}>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 font-medium">{s.sessionType}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{s.sessionDate ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {s.sessionType === "تخطيط"
                    ? <span className="text-xs text-gray-400">تخطيط — لا يُحتسب</span>
                    : s.sessionResult ? `${Number(s.sessionResult).toFixed(2)}٪` : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{s.coverage ? `${Math.round(Number(s.coverage) * 100)}٪` : "—"}</td>
                <td className="px-3 py-2"><Badge value={s.status} /></td>
                <td className="px-3 py-2">
                  <LinkButton href={`/performance/cycles/${id}/sessions/${s.id}`} variant="secondary">فتح</LinkButton>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite && <NewSessionForm cycleId={id} />}
      </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">خطط التحسين</h2>
        {weakNames.length > 0 && plans.length === 0 && (
          <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            اقتراح: توجد مؤشرات بتقدير ضعيف ({weakNames.join("، ")}) — قد ترغب في إنشاء خطة تحسين. القرار يدوي لك ولا يفرضه النظام.
          </div>
        )}
        {plans.length > 0 && (
          <ul className="mb-3 space-y-2">
            {plans.map((p) => (
              <li key={p.id} className="rounded-lg border border-sand-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{orFallback(p.title)}</span>
                  <span className="flex items-center gap-2">
                    <Badge value={p.status} />
                    {canWrite && p.status !== "مكتملة" && <PlanStatusControl planId={p.id} status={p.status} />}
                  </span>
                </div>
                {p.goals && <p className="mt-1 text-xs text-gray-500">الأهداف: {p.goals}</p>}
                {p.actions && <p className="text-xs text-gray-500">التوصيات: {p.actions}</p>}
              </li>
            ))}
          </ul>
        )}
        {canWrite && <ImprovementPlanForm cycleId={id} suggested={weakNames.length > 0} />}
      </Card>

      <Card>
        <h2 className="mb-2 font-bold text-brand-900">المؤشرات (لقطة النموذج المجمدة عند إنشاء الدورة)</h2>
        <Table headers={["م", "المؤشر", "الوزن", "أحدث تقدير"]}>
          {snapshot.indicators.map((ind, i) => {
            const entry = progress.entries.find((e) => e.indicatorId === ind.id);
            return (
              <tr key={ind.id}>
                <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                <td className="px-3 py-2">{orFallback(ind.nameAr)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(ind.weight)}٪</td>
                <td className="px-3 py-2 tabular-nums">{entry?.rating ?? "غير مقيم"}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

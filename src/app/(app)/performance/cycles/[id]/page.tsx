import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people, improvementPlans } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton, ProgressBar } from "@/components/ui";
import { AskAssistant } from "@/components/assistant/ask-assistant";
import { cycleProgress, weakIndicators } from "@/lib/performance/scoring";
import { NewSessionForm, ImprovementPlanForm } from "./cycle-ui";
import { dualDisplay } from "@/lib/dates";

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

  const sessionRatings = sessions.map((s) => ({
    sessionDate: s.sessionDate,
    createdAt: s.createdAt,
    ratings: allRatings
      .filter((r) => r.sessionId === s.id)
      .map((r) => ({ indicatorId: r.indicatorId, weight: weightById.get(r.indicatorId) ?? 0, rating: r.rating })),
  }));
  const progress = cycleProgress(sessionRatings);
  const weak = weakIndicators(progress.entries);
  const weakNames = snapshot.indicators.filter((i) => weak.includes(i.id)).map((i) => i.nameAr);

  const visits = sessions.filter((s) => s.sessionType === "زيارة").length;
  const followups = sessions.filter((s) => s.sessionType === "متابعة").length;
  const canWrite = user.permissions.has("performance.write") && cycle.status !== "مقفلة";

  const context = cycle.cycleType === "معلم" ? "teacher" : "employee";
  const startDisplay = cycle.startDate ? dualDisplay(cycle.startDate, context) : null;
  const endDisplay = cycle.endDate ? dualDisplay(cycle.endDate, context) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`دورة أداء: ${person.fullName}`}
        subtitle={`${cycle.cycleType} — ${snapshot.model.nameAr} — ${cycle.yearKey}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={cycle.status} />
            {user.permissions.has("ai.use") && (
              <AskAssistant type="performance" id={id} label={`دورة أداء: ${person.fullName} (${cycle.yearKey})`} />
            )}
          </div>
        }
      />

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
          <div className="mt-1 text-lg font-bold text-brand-900 tabular-nums">{progress.result.toFixed(2)}٪</div>
          <ProgressBar value={progress.coverage * 100} />
        </Card>
        <Card>
          <div className="text-xs text-gray-500">الزيارات الصفية / المتابعات</div>
          <div className="mt-1 text-lg font-bold text-brand-900 tabular-nums">
            {visits} / {followups}
            <span className="text-xs font-normal text-gray-400"> (المستهدف {cycle.followupTarget})</span>
          </div>
        </Card>
      </div>

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
                <td className="px-3 py-2 tabular-nums">{s.sessionResult ? `${Number(s.sessionResult).toFixed(2)}٪` : "—"}</td>
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
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.title}</span>
                  <Badge value={p.status} />
                </div>
                {p.goals && <p className="mt-1 text-xs text-gray-500">الأهداف: {p.goals}</p>}
                {p.actions && <p className="text-xs text-gray-500">الإجراءات: {p.actions}</p>}
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
                <td className="px-3 py-2">{ind.nameAr}</td>
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

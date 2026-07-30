import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState, ProgressBar } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { isUuid } from "@/lib/validation";
import { orDash, orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import { cycleProgress } from "@/lib/performance/scoring";
import { loadAnalyticsCycles } from "@/lib/performance/analytics-service";

export const metadata = { title: "تقرير أداء منسوب" };
export const dynamic = "force-dynamic";

/**
 * التقرير التفصيلي لأداء المنسوب (v2.3 §10) — كل تقييماته في مكان واحد:
 * سجل الدورات، آخر نتيجة لكل معيار بوزنه ودرجته ونسبته، نقاط القوة وجوانب
 * التحسين والتوصيات من الجلسات، والمقارنة بالفترة السابقة. التقرير الرسمي
 * الموقّع يُصدر من صفحة الجلسة النهائية كما هو معتمد.
 */
export default async function EmployeeKpiPage({ params }: { params: Promise<{ personId: string }> }) {
  await requirePermission("performance.read", "performance.individual.read");
  const { personId } = await params;
  if (!isUuid(personId)) notFound();
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) notFound();

  const cycles = await loadAnalyticsCycles(personId);
  const detailed = cycles.map((c) => {
    const progress = cycleProgress(c.sessions);
    const totalWeight = c.indicators.reduce((s, i) => s + i.weight, 0);
    const resultPercent =
      progress.evaluated && totalWeight > 0 ? Math.round((progress.result / totalWeight) * 1000) / 10 : null;
    const nameById = new Map(c.indicators.map((i) => [i.id, i.nameAr]));
    const weightById = new Map(c.indicators.map((i) => [i.id, i.weight]));
    return { cycle: c, progress, resultPercent, nameById, weightById };
  });
  const latest = detailed.at(-1) ?? null;
  const previous = detailed.length >= 2 ? detailed[detailed.length - 2] : null;

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <BackButton fallbackHref="/performance/analytics" label="عودة إلى لوحة الأداء" />
      </div>
      <PageHeader
        title={`تقرير الأداء التفصيلي — ${orFallback(person.fullName)}`}
        subtitle={[person.jobTitle, person.category].filter(Boolean).join(" — ") || undefined}
      />

      {cycles.length === 0 ? (
        <EmptyState title="لا دورات تقييم لهذا المنسوب" hint="تُنشأ الدورات من صفحة الأداء الوظيفي" />
      ) : (
        <>
          {/* سجل الدورات */}
          <Card>
            <h2 className="mb-2 font-bold text-brand-900">سجل التقييمات ({cycles.length})</h2>
            <Table headers={["السنة", "النموذج", "الحالة", "النتيجة", ""]}>
              {detailed.map(({ cycle, resultPercent }) => (
                <tr key={cycle.id}>
                  <td className="px-3 py-2 text-sm tabular-nums">{cycle.yearKey}</td>
                  <td className="px-3 py-2 text-xs">{cycle.modelName}</td>
                  <td className="px-3 py-2"><Badge value={cycle.status} /></td>
                  <td className="px-3 py-2 tabular-nums">{resultPercent === null ? "لم يبدأ التقييم بعد" : `${resultPercent}٪`}</td>
                  <td className="px-3 py-2">
                    <Link href={`/performance/cycles/${cycle.id}`} className="text-xs text-brand-700 underline">
                      فتح الدورة ←
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          {latest && (
            <Card>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-brand-900">آخر تقييم — {latest.cycle.yearKey}</h2>
                <div className="flex items-center gap-3">
                  {previous && previous.resultPercent !== null && latest.resultPercent !== null && (
                    <span
                      className={`text-sm tabular-nums ${
                        latest.resultPercent - previous.resultPercent < 0 ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      مقارنة بـ{previous.cycle.yearKey}:{" "}
                      {latest.resultPercent - previous.resultPercent > 0 ? "+" : ""}
                      {Math.round((latest.resultPercent - previous.resultPercent) * 10) / 10}٪
                    </span>
                  )}
                  {latest.resultPercent !== null && (
                    <span className="text-lg font-bold text-brand-900 tabular-nums">{latest.resultPercent}٪</span>
                  )}
                </div>
              </div>
              {!latest.progress.evaluated ? (
                <p className="text-sm text-gray-400">لم يبدأ التقييم بعد</p>
              ) : (
                <Table headers={["المعيار", "الوزن", "التقدير (من 5)", "النسبة", ""]}>
                  {latest.progress.entries.map((e) => {
                    const percent = Math.round(((e.rating ?? 0) / 5) * 100);
                    return (
                      <tr key={e.indicatorId}>
                        <td className="px-3 py-2 text-sm font-medium">{latest.nameById.get(e.indicatorId) ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{latest.weightById.get(e.indicatorId) ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{e.rating ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{percent}٪</td>
                        <td className="w-36 px-3 py-2"><ProgressBar value={percent} /></td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          )}

          {/* نقاط القوة والتحسين والتوصيات من الجلسات */}
          {latest && (
            <SessionNarratives cycleId={latest.cycle.id} />
          )}
        </>
      )}
    </div>
  );
}

async function SessionNarratives({ cycleId }: { cycleId: string }) {
  const { perfSessions } = await import("@/db/schema");
  const sessions = await db.select().from(perfSessions).where(eq(perfSessions.cycleId, cycleId));
  const withNarrative = sessions.filter(
    (s) => s.strengths || s.improvementAreas || s.recommendations || s.actionsText || s.nextFollowupDate,
  );
  if (withNarrative.length === 0) return null;
  return (
    <Card>
      <h2 className="mb-2 font-bold text-brand-900">الملاحظات النوعية</h2>
      <div className="space-y-3">
        {withNarrative.map((s) => (
          <div key={s.id} className="rounded-lg bg-sand-50 p-3">
            <p className="mb-1 text-xs font-bold text-gray-600">
              جلسة {s.sessionType}
              {s.sessionDate ? ` — ${dualNumericCell(s.sessionDate)}` : ""}
            </p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-gray-500">نقاط القوة</dt>
              <dd>{orDash(s.strengths)}</dd>
              <dt className="text-gray-500">جوانب التحسين</dt>
              <dd>{orDash(s.improvementAreas)}</dd>
              <dt className="text-gray-500">التوصيات</dt>
              <dd>{orDash(s.recommendations)}</dd>
              <dt className="text-gray-500">موعد المتابعة</dt>
              <dd className="tabular-nums">{s.nextFollowupDate ? dualNumericCell(s.nextFollowupDate) : "—"}</dd>
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}

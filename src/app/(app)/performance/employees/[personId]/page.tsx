import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people, perfSessions, perfRatings, evidenceLinks, users } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState, ProgressBar, LinkButton, SubmitButton } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { isUuid } from "@/lib/validation";
import { orDash, orFallback } from "@/lib/format";
import { dualNumericCell, toGregorianNumeric } from "@/lib/dates";
import { cycleProgress } from "@/lib/performance/scoring";
import { loadAnalyticsCycles } from "@/lib/performance/analytics-service";

export const metadata = { title: "تقرير أداء منسوب" };
export const dynamic = "force-dynamic";

/**
 * التقرير التفصيلي لأداء المنسوب (v2.3 §10 + v2.4 §13):
 * اختيار الدورة/السنة، معايير الدورة المختارة بوزنها وتقديرها ودرجتها الموزونة وملاحظتها
 * وشواهدها، سجل الجلسات والزيارات باعتمادها، الملاحظات النوعية، والمقارنة بالفترة السابقة،
 * مع إصدار PDF رسمي بوثيقة مرقمة.
 */
export default async function EmployeeKpiPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ دورة?: string }>;
}) {
  const user = await requirePermission("performance.read", "performance.individual.read");
  const { personId } = await params;
  if (!isUuid(personId)) notFound();
  const requestedCycle = (await searchParams)["دورة"];
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person) notFound();
  const canGenerate = user.permissions.has("reports.generate");

  const cycles = await loadAnalyticsCycles(personId);
  const detailed = cycles.map((c) => {
    const progress = cycleProgress(c.sessions);
    const totalWeight = c.indicators.reduce((s, i) => s + i.weight, 0);
    const resultPercent =
      progress.evaluated && totalWeight > 0 ? Math.round((progress.result / totalWeight) * 1000) / 10 : null;
    return { cycle: c, progress, resultPercent };
  });
  const selectedIndex =
    requestedCycle && isUuid(requestedCycle)
      ? detailed.findIndex((d) => d.cycle.id === requestedCycle)
      : detailed.length - 1;
  const selected = selectedIndex >= 0 ? detailed[selectedIndex] : detailed.at(-1) ?? null;
  const previous = selected && selectedIndex > 0 ? detailed[selectedIndex - 1] : null;

  // بيانات الدورة المختارة: الجلسات بالاعتماد + ملاحظات المعايير + عدد الشواهد لكل معيار
  const sessions = selected
    ? await db.select().from(perfSessions).where(eq(perfSessions.cycleId, selected.cycle.id)).orderBy(asc(perfSessions.createdAt))
    : [];
  const sessionIds = sessions.map((s) => s.id);
  const [ratings, evidence, lockers] = await Promise.all([
    sessionIds.length ? db.select().from(perfRatings).where(inArray(perfRatings.sessionId, sessionIds)) : Promise.resolve([]),
    sessionIds.length
      ? db
          .select({ subKey: evidenceLinks.subKey })
          .from(evidenceLinks)
          .where(and(eq(evidenceLinks.entityType, "perf_session"), inArray(evidenceLinks.entityId, sessionIds)))
      : Promise.resolve([]),
    (async () => {
      const ids = sessions.map((s) => s.lockedBy).filter(Boolean) as string[];
      if (!ids.length) return new Map<string, string>();
      const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids));
      return new Map(rows.map((u) => [u.id, u.name]));
    })(),
  ]);
  const evidenceByIndicator = new Map<string, number>();
  for (const e of evidence) {
    if (!e.subKey) continue;
    evidenceByIndicator.set(e.subKey, (evidenceByIndicator.get(e.subKey) ?? 0) + 1);
  }
  const sessionOrder = new Map(sessions.map((s, i) => [s.id, i]));
  const noteByIndicator = new Map<string, string>();
  for (const r of [...ratings].sort((a, b) => (sessionOrder.get(a.sessionId) ?? 0) - (sessionOrder.get(b.sessionId) ?? 0))) {
    if (r.note) noteByIndicator.set(r.indicatorId, r.note);
  }
  const finalSession = sessions.filter((s) => s.sessionType === "نهائي").at(-1);

  // v2.4 §13: إصدار PDF رسمي للدورة المختارة
  const selectedCycleId = selected?.cycle.id;
  async function issueReport() {
    "use server";
    const u = await requirePermission("reports.generate", "performance.individual.read");
    const { generateEmployeePerformanceReport } = await import("@/lib/reports/performance-reports");
    await generateEmployeePerformanceReport({ personId, cycleId: selectedCycleId, issuedBy: u.id });
    revalidatePath(`/performance/employees/${personId}`);
    revalidatePath("/documents");
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <BackButton fallbackHref="/performance/analytics" label="عودة إلى لوحة الأداء" />
      </div>
      <PageHeader
        title={`تقرير الأداء التفصيلي — ${orFallback(person.fullName)}`}
        subtitle={[person.jobTitle, person.category].filter(Boolean).join(" — ") || undefined}
        actions={
          canGenerate && selected ? (
            <form action={issueReport}>
              {/* v2.4.1 §1: التسمية التي يطلبها المدير حرفياً — لا «إصدار التقرير» العامّ */}
              <SubmitButton variant="secondary">تقرير تفصيلي للموظف</SubmitButton>
            </form>
          ) : undefined
        }
      />

      {cycles.length === 0 ? (
        <EmptyState title="لا دورات تقييم لهذا المنسوب" hint="تُنشأ الدورات من صفحة الأداء الوظيفي" />
      ) : (
        <>
          {/* اختيار الدورة (v2.4 §13): كل دورة/سنة قابلة للعرض التفصيلي لا الأحدث فقط */}
          {detailed.length > 1 && (
            <div className="no-print flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500">الدورة:</span>
              {detailed.map((d) => (
                <LinkButton
                  key={d.cycle.id}
                  href={`/performance/employees/${personId}?دورة=${d.cycle.id}`}
                  variant={selected?.cycle.id === d.cycle.id ? "primary" : "secondary"}
                >
                  {d.cycle.yearKey}
                </LinkButton>
              ))}
            </div>
          )}

          {/* سجل الدورات */}
          <Card>
            <h2 className="mb-2 font-bold text-brand-900">سجل التقييمات ({cycles.length})</h2>
            <Table headers={["السنة", "النموذج", "الحالة", "النتيجة", ""]}>
              {detailed.map(({ cycle, resultPercent }) => (
                <tr key={cycle.id} className={selected?.cycle.id === cycle.id ? "bg-sand-50/60" : undefined}>
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

          {selected && (
            <Card>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-brand-900">
                  تقييم دورة {selected.cycle.yearKey} — {selected.cycle.modelName}
                </h2>
                <div className="flex items-center gap-3">
                  {previous && previous.resultPercent !== null && selected.resultPercent !== null && (
                    <span
                      className={`text-sm tabular-nums ${
                        selected.resultPercent - previous.resultPercent < 0 ? "text-red-700" : "text-emerald-700"
                      }`}
                    >
                      مقارنة بـ{previous.cycle.yearKey}:{" "}
                      {selected.resultPercent - previous.resultPercent > 0 ? "+" : ""}
                      {Math.round((selected.resultPercent - previous.resultPercent) * 10) / 10}٪
                    </span>
                  )}
                  {selected.resultPercent !== null && (
                    <span className="text-lg font-bold text-brand-900 tabular-nums">{selected.resultPercent}٪</span>
                  )}
                </div>
              </div>
              {!selected.progress.evaluated ? (
                <p className="text-sm text-gray-400">لم يبدأ التقييم بعد</p>
              ) : (
                <Table headers={["المعيار", "الوزن", "التقدير (من 5)", "الدرجة الموزونة", "الشواهد", "الملاحظة", ""]}>
                  {selected.progress.entries.map((e) => {
                    const weight = selected.cycle.indicators.find((i) => i.id === e.indicatorId)?.weight ?? 0;
                    const name = selected.cycle.indicators.find((i) => i.id === e.indicatorId)?.nameAr ?? "—";
                    const percent = Math.round(((e.rating ?? 0) / 5) * 100);
                    const weighted = e.rating === null ? null : Math.round((e.rating / 5) * weight * 10) / 10;
                    return (
                      <tr key={e.indicatorId}>
                        <td className="px-3 py-2 text-sm font-medium">{name}</td>
                        <td className="px-3 py-2 tabular-nums">{weight}</td>
                        <td className="px-3 py-2 tabular-nums">{e.rating ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{weighted ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{evidenceByIndicator.get(e.indicatorId) ?? 0}</td>
                        <td className="max-w-48 px-3 py-2 text-xs text-gray-600">{orDash(noteByIndicator.get(e.indicatorId) ?? null)}</td>
                        <td className="w-28 px-3 py-2"><ProgressBar value={percent} /></td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          )}

          {/* سجل الجلسات والزيارات بالاعتماد (v2.4 §13) */}
          {selected && sessions.length > 0 && (
            <Card>
              <h2 className="mb-2 font-bold text-brand-900">سجل الجلسات والزيارات ({sessions.length})</h2>
              <Table headers={["النوع", "التاريخ", "الحالة", "الاعتماد"]}>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-sm">{s.sessionType}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{s.sessionDate ? dualNumericCell(s.sessionDate) : "—"}</td>
                    <td className="px-3 py-2"><Badge value={s.status ?? "—"} /></td>
                    <td className="px-3 py-2 text-xs">
                      {s.lockedAt
                        ? `اعتُمدت بواسطة ${orDash(s.lockedBy ? lockers.get(s.lockedBy) ?? null : null)} — ${toGregorianNumeric(s.lockedAt)}م`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {/* الإقرار والاعتماد النهائي (v2.4 §13) */}
          {selected && finalSession && (
            <Card>
              <h2 className="mb-2 font-bold text-brand-900">الإقرار والاعتماد</h2>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <dt className="text-gray-500">إقرار الموظف</dt>
                <dd>{orDash(finalSession.employeeComment)}</dd>
                <dt className="text-gray-500">تعقيب المدير</dt>
                <dd>{orDash(finalSession.principalComment)}</dd>
                <dt className="text-gray-500">اعتماد التقييم النهائي</dt>
                <dd>
                  {finalSession.lockedAt
                    ? `معتمد — ${orDash(finalSession.lockedBy ? lockers.get(finalSession.lockedBy) ?? null : null)} بتاريخ ${toGregorianNumeric(finalSession.lockedAt)}م`
                    : "لم يُعتمد بعد"}
                </dd>
                <dt className="text-gray-500">التقرير الموقع</dt>
                <dd>{finalSession.signedReportFileId ? "مستلم ومحفوظ" : "لم يُستلم بعد"}</dd>
              </dl>
            </Card>
          )}

          {/* نقاط القوة والتحسين والتوصيات من جلسات الدورة المختارة */}
          {selected && <SessionNarratives cycleId={selected.cycle.id} />}
        </>
      )}
    </div>
  );
}

async function SessionNarratives({ cycleId }: { cycleId: string }) {
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

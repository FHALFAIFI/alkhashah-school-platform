import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs, programFollowups } from "@/db/schema";
import { PageHeader, Card, Badge, ProgressBar, EmptyState, LinkButton } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import {
  daysSince,
  isFollowupDue,
  isoWeekKey,
  isValidWeekKey,
  previousWeekKey,
  recentWeekKeys,
  weeklyGroup,
  NO_WEEKLY_UPDATE_LABEL,
  type WeeklyGroup,
} from "@/lib/plan/followup";
import { programsEvidenceSummary } from "@/lib/plan/program-service";
import { evidenceCountPhrase } from "@/lib/plan/evidence-summary";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback, orDash } from "@/lib/format";
import { FollowupDueBadge } from "../followup-badge";
import { FollowupForm } from "./followup-ui";

export const metadata = { title: "المتابعة الأسبوعية" };
export const dynamic = "force-dynamic";

/** ترتيب مجموعات العرض (v2.4 §7): الأكثر احتياجاً للانتباه أولاً */
const GROUP_ORDER: WeeklyGroup[] = [
  "متأخر",
  "متوقف مؤقتاً",
  "بلا تحديث هذا الأسبوع",
  "في المسار",
  "لم يبدأ",
  "مكتمل — بانتظار الإقفال",
  "مغلق",
];

export default async function FollowupPage({
  searchParams,
}: {
  searchParams: Promise<{ اسبوع?: string }>;
}) {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");

  const currentWeek = isoWeekKey();
  const requestedWeek = (await searchParams)["اسبوع"];
  const week = requestedWeek && isValidWeekKey(requestedWeek) ? requestedWeek : currentWeek;
  const prevWeek = previousWeekKey(week);
  const isCurrentWeek = week === currentWeek;
  const weekOptions = recentWeekKeys(8);

  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];
  const excluded = await getExcludedIdSets();

  // كل برامج السنة المعتمدة غير المؤرشفة — المغلقة تُعرض في ملخص منفصل (لا تُطالَب بمتابعة)
  const allApproved = activeYear
    ? (await db
        .select()
        .from(programs)
        .where(and(
          eq(programs.planYearId, activeYear.id),
          notSynthetic(programs.id, excluded.programs),
          isNull(programs.archivedAt),
        ))
        .orderBy(asc(programs.seq)))
        .filter((p) => p.status === "معتمد")
    : [];
  const open = allApproved.filter((p) => !p.closedAt);
  const closed = allApproved.filter((p) => p.closedAt);

  // سجلات الأسبوع المختار والأسبوع السابق فقط — لا نقرأ كامل التاريخ
  const weekRows = open.length
    ? await db
        .select()
        .from(programFollowups)
        .where(
          and(
            inArray(programFollowups.programId, open.map((p) => p.id)),
            inArray(programFollowups.weekKey, prevWeek ? [week, prevWeek] : [week]),
          ),
        )
    : [];
  const thisWeekByProgram = new Map(weekRows.filter((f) => f.weekKey === week).map((f) => [f.programId, f]));
  const prevWeekByProgram = new Map(weekRows.filter((f) => f.weekKey === prevWeek).map((f) => [f.programId, f]));

  // الحالة الفعلية للشواهد لكل برنامج — عدد فعلي وأحدث رفع، معلوماتي فقط بلا هدف/حصة (D-025)
  const evidenceByProgram = await programsEvidenceSummary(open.map((p) => p.id));

  const dueCount = open.filter((p) => !p.completedAt && isFollowupDue(p.lastReviewAt)).length;
  const updatedCount = open.filter((p) => thisWeekByProgram.has(p.id)).length;

  // التجميع الصادق (v2.4 §7): محور الاعتماد ومحور التنفيذ منفصلان — غياب التحديث لا يعني الاكتمال
  const grouped = new Map<WeeklyGroup, typeof open>();
  for (const p of open) {
    const g = weeklyGroup({
      closedAt: p.closedAt,
      completedAt: p.completedAt,
      weekStatus: thisWeekByProgram.get(p.id)?.executionStatus ?? null,
      currentStatus: p.executionStatus,
    });
    const list = grouped.get(g) ?? [];
    list.push(p);
    grouped.set(g, list);
  }

  return (
    <div>
      <PageHeader
        title="المتابعة الأسبوعية"
        subtitle={`أسبوع ${week} — ${open.length} برنامجاً معتمداً مفتوحاً · حُدِّث هذا الأسبوع: ${updatedCount} · مستحق المتابعة: ${dueCount}`}
        actions={<SectionReportsLink category="plan" report="plan-followups" />}
      />

      {/* اختيار الأسبوع — الأسابيع السابقة تعرض لقطاتها التاريخية كما سُجلت */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500">الأسبوع:</span>
        {weekOptions.map((w) => (
          <LinkButton
            key={w}
            href={w === currentWeek ? "/plan/followup" : `/plan/followup?اسبوع=${w}`}
            variant={w === week ? "primary" : "secondary"}
          >
            {w === currentWeek ? `${w} (الحالي)` : w}
          </LinkButton>
        ))}
      </div>

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState
          title="لا برامج معتمدة للمتابعة"
          hint="تظهر هنا البرامج بعد اعتمادها من صفحة البرنامج — المتابعة الأسبوعية تخص البرامج المعتمدة فقط"
        />
      ) : (
        <div className="space-y-6">
          {GROUP_ORDER.filter((g) => g !== "مغلق" && (grouped.get(g)?.length ?? 0) > 0).map((g) => (
            <section key={g}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-brand-900">
                {g}
                <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-normal tabular-nums text-gray-600">
                  {grouped.get(g)!.length}
                </span>
              </h2>
              <div className="space-y-3">
                {grouped.get(g)!.map((p) => {
                  const thisWeek = thisWeekByProgram.get(p.id);
                  const prev = prevWeekByProgram.get(p.id);
                  const due = !p.completedAt && isFollowupDue(p.lastReviewAt);
                  const ev = evidenceByProgram.get(p.id) ?? { count: 0, latestAt: null };
                  const progressDelta = thisWeek && prev ? thisWeek.progressSnapshot - prev.progressSnapshot : null;
                  const weeklyCompletedUndocumented =
                    thisWeek?.executionStatus === "مكتمل" && !p.completedAt;
                  return (
                    <Card key={p.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 basis-56">
                          <Link href={`/plan/${p.id}`} className="font-medium text-brand-700 hover:underline">
                            {p.seq}. {orFallback(p.name)}
                          </Link>
                          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                            <span>{orDash(p.domain)}</span>
                            <span>المسؤول: {orDash(p.ownerPosition)}</span>
                            <span>
                              {p.lastReviewAt
                                ? `آخر متابعة: ${p.lastReviewAt.toLocaleDateString("ar-SA-u-nu-latn")} (قبل ${daysSince(p.lastReviewAt)} يوماً)`
                                : "لا متابعة مسجلة بعد"}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* حالة الأسبوع المختار من لقطته المحفوظة — لا من الحالة الجارية المتغيرة */}
                          {thisWeek ? (
                            <>
                              <Badge value={thisWeek.executionStatus} />
                              <ProgressBar value={thisWeek.progressSnapshot} />
                              {progressDelta !== null && progressDelta !== 0 && (
                                <span
                                  className={`text-xs tabular-nums ${progressDelta > 0 ? "text-emerald-600" : "text-red-600"}`}
                                >
                                  {progressDelta > 0 ? `+${progressDelta}` : progressDelta}٪ عن الأسبوع السابق
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                              {NO_WEEKLY_UPDATE_LABEL}
                            </span>
                          )}
                          {due && <FollowupDueBadge />}
                        </div>
                      </div>

                      {/* محورا الحالة منفصلان: التنفيذ الجاري + الاعتماد/الإقفال (v2.4 §7) */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span>الحالة الجارية:</span>
                        <Badge value={p.executionStatus} />
                        <span className="text-gray-400">·</span>
                        <span>التقدم الحالي:</span>
                        <span className="tabular-nums">{p.progress}٪</span>
                        {p.completedAt && !p.closedAt && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">
                            وثق الاكتمال — بانتظار اعتماد الإقفال من المدير
                          </span>
                        )}
                        {weeklyCompletedUndocumented && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">
                            سُجل «مكتمل» في المتابعة ولم يوثق الاكتمال بعد — وثقه من صفحة البرنامج
                          </span>
                        )}
                      </div>

                      {thisWeek?.note && (
                        <p className="mt-2 rounded bg-sand-50 p-2 text-xs text-gray-600">
                          ملاحظة الأسبوع ({thisWeek.weekKey}): {thisWeek.note}
                        </p>
                      )}
                      {!thisWeek && prev?.note && (
                        <p className="mt-2 rounded bg-sand-50 p-2 text-xs text-gray-400">
                          ملاحظة الأسبوع السابق ({prev.weekKey}): {prev.note}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span>الشواهد: {evidenceCountPhrase(ev.count)}</span>
                        {ev.latestAt && (
                          <span className="text-gray-400">· آخر رفع: {ev.latestAt.toLocaleDateString("ar-SA-u-nu-latn")}</span>
                        )}
                        <Link href={`/plan/${p.id}#evidence`} className="text-brand-700 hover:underline">فتح شواهد البرنامج</Link>
                      </div>

                      {/* التسجيل للأسبوع الحالي فقط — لقطات الأسابيع السابقة تاريخية لا تُعدل من هنا */}
                      {canWrite && isCurrentWeek && (
                        <FollowupForm
                          programId={p.id}
                          defaultStatus={thisWeek?.executionStatus}
                          defaultProgress={thisWeek?.progressSnapshot ?? p.progress}
                        />
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}

          {closed.length > 0 && (
            <details className="rounded-xl border border-sand-200 bg-sand-50/50">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700">
                برامج مغلقة ({closed.length}) — أُقفلت باعتماد المدير ولا تُطالَب بمتابعة
              </summary>
              <ul className="space-y-1 px-4 pb-4 text-sm">
                {closed.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/plan/${p.id}`} className="text-brand-700 hover:underline">
                      {p.seq}. {orFallback(p.name)}
                    </Link>
                    <Badge value="مغلق" />
                    {p.closedAt && (
                      <span className="text-xs text-gray-400">{p.closedAt.toLocaleDateString("ar-SA-u-nu-latn")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

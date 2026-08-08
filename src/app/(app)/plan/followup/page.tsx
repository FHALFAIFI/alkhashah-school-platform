import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Badge, EmptyState, LinkButton } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import { FilterPanel } from "@/components/report-filters";
import { loadFilterOptions } from "@/lib/reports/filter-options";
import { parseReportFilters, canonicalListQuery } from "@/lib/reports/filters";
import { redirect } from "next/navigation";
import { loadWeeklyFollowup, type WeeklyRow } from "@/lib/plan/followup-service";
import {
  daysSince,
  isFollowupDue,
  recentWeekKeys,
  WEEKLY_STATUSES,
  NO_WEEKLY_UPDATE_LABEL,
  type WeeklyGroup,
} from "@/lib/plan/followup";
import { isProgramInconsistent, NEEDS_REVIEW_LABEL } from "@/lib/plan/consistency";
import { evidenceCountPhrase } from "@/lib/plan/evidence-summary";
import { orFallback, orDash } from "@/lib/format";
import { FollowupDueBadge } from "../followup-badge";
import { FollowupForm } from "./followup-ui";

export const metadata = { title: "المتابعة الأسبوعية" };
export const dynamic = "force-dynamic";

/**
 * الشاشة التشغيلية للمتابعة الأسبوعية (v2.5.0 §6).
 *
 * تعرض **المصدر الواحد** في `lib/plan/followup-service` وتحرّره؛ وتقرير «المتابعة
 * الأسبوعية» يعرض المصدر نفسه ويُصدّره فقط. اختلافهما عيب لا اجتهاد (§6.1).
 */

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

const FILTER_KEYS = ["search", "week", "domain", "owner", "program", "status"] as const;
const FLAGS = ["delayed", "notUpdated", "needsIntervention", "hasEvidence", "noEvidence"] as const;

export default async function FollowupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");
  const sp = await searchParams;

  /*
   * D-066: عنوانٌ بمفاتيح مكرّرة (رابط أو إشارة مرجعية من قبل هذا الإصدار) يُوحَّد هنا قبل
   * أي تصيير. لولاه لبقي مفتاح جزء الصفحة عند موجّه Next محسوباً من آخر تكرار وحده، فيقع
   * أول رفعٍ لقيمة في العطل نفسه. العنوان الموحَّد أصلاً لا يمرّ من هنا.
   */
  const canonicalQuery = canonicalListQuery(sp);
  if (canonicalQuery !== null) redirect(`/plan/followup?${canonicalQuery}`);

  // «اسبوع» بالعربية بقيت مقبولة: روابط المدير المحفوظة منذ v2.4 تستعملها
  const legacyWeek = typeof sp["اسبوع"] === "string" ? (sp["اسبوع"] as string) : undefined;
  const filters = parseReportFilters(sp);
  const result = await loadWeeklyFollowup({ week: legacyWeek ?? filters.week, filters });

  const options = await loadFilterOptions(FILTER_KEYS, {
    // الحالات المعروضة تشمل مفردات الأسبوع ووسم «بلا تحديث» — وهو مرشّح حقيقي لا فراغ
    statuses: [...WEEKLY_STATUSES, NO_WEEKLY_UPDATE_LABEL],
  });
  options.weeks = recentWeekKeys(12);

  const grouped = new Map<WeeklyGroup, WeeklyRow[]>();
  for (const row of result.rows) {
    const list = grouped.get(row.group) ?? [];
    list.push(row);
    grouped.set(row.group, list);
  }
  const dueCount = result.rows.filter((r) => !r.completedAt && isFollowupDue(r.lastFollowupAt)).length;
  const filtered = result.rows.length !== result.totalOpen;

  return (
    <div>
      <PageHeader
        title="المتابعة الأسبوعية"
        subtitle={`أسبوع ${result.week} — ${result.totalOpen} برنامجاً معتمداً مفتوحاً · حُدِّث هذا الأسبوع: ${result.updatedCount} · مستحق المتابعة: ${dueCount}`}
        actions={<SectionReportsLink category="plan" report="plan-followups" />}
      />

      {/* اختيار الأسبوع — الأسابيع السابقة تعرض لقطاتها التاريخية كما سُجلت */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500">الأسبوع:</span>
        {recentWeekKeys(8).map((w) => (
          <LinkButton
            key={w}
            href={w === result.currentWeek ? "/plan/followup" : `/plan/followup?week=${w}`}
            variant={w === result.week ? "primary" : "secondary"}
          >
            {w === result.currentWeek ? `${w} (الحالي)` : w}
          </LinkButton>
        ))}
      </div>

      <FilterPanel
        filterKeys={[...FILTER_KEYS]}
        flags={[...FLAGS]}
        options={options}
        resultCount={result.rows.length}
        storageKey="plan-followup"
      />

      {result.rows.length === 0 && result.closed.length === 0 ? (
        <EmptyState
          title={filtered ? "لا نتائج مطابقة للمرشّحات" : "لا برامج معتمدة للمتابعة"}
          hint={
            filtered
              ? `المرشّحات الفعّالة أخفت ${result.totalOpen} برنامجاً — امسحها لعرض الكل`
              : "تظهر هنا البرامج بعد اعتمادها من صفحة البرنامج — المتابعة الأسبوعية تخص البرامج المعتمدة فقط"
          }
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
                {grouped.get(g)!.map((row) => (
                  <ProgramCard key={row.programId} row={row} canWrite={canWrite} isCurrentWeek={result.isCurrentWeek} />
                ))}
              </div>
            </section>
          ))}

          {result.closed.length > 0 && (
            <details className="rounded-xl border border-sand-200 bg-sand-50/50">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700">
                برامج مغلقة ({result.closed.length}) — أُقفلت باعتماد المدير ولا تُطالَب بمتابعة
              </summary>
              <ul className="space-y-1 px-4 pb-4 text-sm">
                {result.closed.map((p) => (
                  <li key={p.programId} className="flex flex-wrap items-center gap-2">
                    <Link href={`/plan/${p.programId}`} className="text-brand-700 hover:underline">
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

function ProgramCard({ row, canWrite, isCurrentWeek }: { row: WeeklyRow; canWrite: boolean; isCurrentWeek: boolean }) {
  const due = !row.completedAt && isFollowupDue(row.lastFollowupAt);
  const weeklyCompletedUndocumented = row.weekStatus === "مكتمل" && !row.completedAt;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <Link href={`/plan/${row.programId}`} className="font-medium text-brand-700 hover:underline">
            {row.seq}. {orFallback(row.name)}
          </Link>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
            <span>{orDash(row.domain)}</span>
            <span>المسؤول: {orDash(row.owner)}</span>
            <span>
              {row.lastFollowupAt
                ? `آخر متابعة: ${row.lastFollowupAt.toLocaleDateString("ar-SA-u-nu-latn")} (قبل ${daysSince(row.lastFollowupAt)} يوماً)`
                : "لا متابعة مسجلة بعد"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* حالة الأسبوع المختار من سجله المحفوظ — لا من الحالة الجارية المتغيرة */}
          {row.updatedThisWeek ? (
            <Badge value={row.weekStatus} />
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{NO_WEEKLY_UPDATE_LABEL}</span>
          )}
          {row.interventionNeeded && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">يحتاج تدخّل المدير</span>
          )}
          {due && <FollowupDueBadge />}
        </div>
      </div>

      {/* المحاور الثلاثة منفصلة صراحةً (§6.4): الحالة الجارية · التقدم المعتمد · حالة الأسبوع */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>الحالة الجارية:</span>
        <Badge value={row.executionStatus} />
        {isProgramInconsistent({
          executionStatus: row.executionStatus,
          progress: row.progress,
          completedAt: row.completedAt,
          status: row.approval,
        }) && (
          <Link href="/plan/consistency" className="rounded-full bg-red-50 px-2 py-0.5 text-red-800 hover:underline">
            {NEEDS_REVIEW_LABEL}
          </Link>
        )}
        <span className="text-gray-400">·</span>
        {/* §6.4: التقدم من سجل البرنامج — المتابعة الأسبوعية لا تُدخله ولا تكتبه */}
        <span>التقدم المعتمد (من سجل البرنامج):</span>
        <span className="tabular-nums">{row.progress}٪</span>
        {row.completedAt && !row.closedAt && (
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

      {row.updatedThisWeek ? (
        <WeeklyNarrative row={row} />
      ) : (
        row.previousNote && (
          <p className="mt-2 rounded bg-sand-50 p-2 text-xs text-gray-400">
            ملاحظة الأسبوع السابق ({row.previousWeekKey}): {row.previousNote}
          </p>
        )
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>الشواهد: {evidenceCountPhrase(row.evidenceCount)}</span>
        {row.evidenceLatestAt && (
          <span className="text-gray-400">· آخر رفع: {row.evidenceLatestAt.toLocaleDateString("ar-SA-u-nu-latn")}</span>
        )}
        <Link href={`/plan/${row.programId}#evidence`} className="text-brand-700 hover:underline">فتح شواهد البرنامج</Link>
      </div>

      {/* التسجيل للأسبوع الحالي فقط — سجلات الأسابيع السابقة تاريخية لا تُعدل من هنا */}
      {canWrite && isCurrentWeek && (
        <FollowupForm
          programId={row.programId}
          defaultStatus={row.weekStatus}
          defaults={{
            note: row.note,
            completedWork: row.completedWork,
            obstacles: row.obstacles,
            requiredAction: row.requiredAction,
            nextStep: row.nextStep,
            evidenceUpdate: row.evidenceUpdate,
            interventionNeeded: row.interventionNeeded,
          }}
        />
      )}
    </Card>
  );
}

/** سرد الأسبوع كما سُجِّل — لا يُعرض حقل فارغ */
function WeeklyNarrative({ row }: { row: WeeklyRow }) {
  const lines: [string, string][] = [
    ["ملاحظات الأسبوع", row.note],
    ["ما أُنجز", row.completedWork],
    ["العوائق", row.obstacles],
    ["الإجراء المطلوب", row.requiredAction],
    ["الخطوة التالية", row.nextStep],
    ["تحديث الشواهد", row.evidenceUpdate],
  ].filter(([, v]) => v.trim() !== "") as [string, string][];
  if (lines.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 rounded bg-sand-50 p-2 text-xs sm:grid-cols-2">
      {lines.map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt className="shrink-0 text-gray-500">{label}:</dt>
          <dd className="min-w-0 text-gray-700">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

import Link from "next/link";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs, programFollowups } from "@/db/schema";
import { PageHeader, Card, Badge, ProgressBar, EmptyState } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import { daysSince, isFollowupDue } from "@/lib/plan/followup";
import { programsEvidenceSummary } from "@/lib/plan/program-service";
import { evidenceCountPhrase } from "@/lib/plan/evidence-summary";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback } from "@/lib/format";
import { FollowupDueBadge } from "../followup-badge";
import { FollowupForm } from "./followup-ui";

export const metadata = { title: "المتابعة الأسبوعية" };
export const dynamic = "force-dynamic";

export default async function FollowupPage() {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");

  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];
  const excluded = await getExcludedIdSets();
  const approved = activeYear
    ? (await db
        .select()
        .from(programs)
        // البرامج المؤرشفة (v2.1 §A1) والمغلقة نهائياً (v2.2 §A2) مستبعدة من المتابعة الأسبوعية —
        // البرنامج المنتهي لا يُطالَب بمتابعة، ويبقى كاملاً في التقارير التاريخية.
        .where(and(
          eq(programs.planYearId, activeYear.id),
          notSynthetic(programs.id, excluded.programs),
          isNull(programs.archivedAt),
          isNull(programs.closedAt),
        ))
        .orderBy(asc(programs.seq)))
        .filter((p) => p.status === "معتمد")
    : [];

  const followups = approved.length
    ? await db
        .select()
        .from(programFollowups)
        .where(inArray(programFollowups.programId, approved.map((p) => p.id)))
        .orderBy(desc(programFollowups.createdAt))
    : [];
  const latestByProgram = new Map<string, (typeof followups)[number]>();
  for (const f of followups) if (!latestByProgram.has(f.programId)) latestByProgram.set(f.programId, f);

  // الحالة الفعلية للشواهد لكل برنامج — عدد فعلي وأحدث رفع، معلوماتي فقط بلا هدف/حصة (D-025)
  const evidenceByProgram = await programsEvidenceSummary(approved.map((p) => p.id));

  const dueCount = approved.filter((p) => isFollowupDue(p.lastReviewAt)).length;

  return (
    <div>
      <PageHeader
        title="المتابعة الأسبوعية"
        subtitle={`متابعة تنفيذ البرامج المعتمدة أسبوعياً — ${approved.length} برنامجاً معتمداً · مستحق المتابعة: ${dueCount}`}
        actions={<SectionReportsLink category="plan" report="plan-followups" />}
      />
      {approved.length === 0 ? (
        <EmptyState
          title="لا برامج معتمدة للمتابعة"
          hint="تظهر هنا البرامج بعد اعتمادها من صفحة البرنامج — المتابعة الأسبوعية تخص البرامج المعتمدة فقط"
        />
      ) : (
        <div className="space-y-3">
          {approved.map((p) => {
            const latest = latestByProgram.get(p.id);
            const due = isFollowupDue(p.lastReviewAt);
            const ev = evidenceByProgram.get(p.id) ?? { count: 0, latestAt: null };
            return (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <Link href={`/plan/${p.id}`} className="font-medium text-brand-700 hover:underline">
                      {p.seq}. {orFallback(p.name)}
                    </Link>
                    <div className="mt-1 text-xs text-gray-500">
                      {p.lastReviewAt
                        ? `آخر متابعة: ${p.lastReviewAt.toLocaleDateString("ar-SA-u-nu-latn")} (قبل ${daysSince(p.lastReviewAt)} يوماً)`
                        : "لا متابعة مسجلة بعد"}
                      {latest && ` · ${latest.weekKey}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ProgressBar value={p.progress} />
                    <Badge value={p.executionStatus} />
                    {due && <FollowupDueBadge />}
                  </div>
                </div>
                {latest && (
                  <p className="mt-2 rounded bg-sand-50 p-2 text-xs text-gray-600">
                    آخر ملاحظة ({latest.weekKey}): {latest.note}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span>الشواهد: {evidenceCountPhrase(ev.count)}</span>
                  {ev.latestAt && (
                    <span className="text-gray-400">· آخر رفع: {ev.latestAt.toLocaleDateString("ar-SA-u-nu-latn")}</span>
                  )}
                  <Link href={`/plan/${p.id}#evidence`} className="text-brand-700 hover:underline">فتح شواهد البرنامج</Link>
                </div>
                {canWrite && <FollowupForm programId={p.id} defaultStatus={p.executionStatus} defaultProgress={p.progress} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

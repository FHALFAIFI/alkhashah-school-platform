import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs, programFollowups } from "@/db/schema";
import { PageHeader, Card, Badge, ProgressBar, LinkButton, EmptyState } from "@/components/ui";
import { daysSince, isFollowupDue } from "@/lib/plan/followup";
import { FollowupDueBadge } from "../followup-badge";
import { FollowupForm } from "./followup-ui";

export const metadata = { title: "المتابعة الأسبوعية" };
export const dynamic = "force-dynamic";

export default async function FollowupPage() {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");

  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];
  const approved = activeYear
    ? (await db.select().from(programs).where(eq(programs.planYearId, activeYear.id)).orderBy(asc(programs.seq)))
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

  const dueCount = approved.filter((p) => isFollowupDue(p.lastReviewAt)).length;

  return (
    <div>
      <PageHeader
        title="المتابعة الأسبوعية"
        subtitle={`متابعة تنفيذ البرامج المعتمدة أسبوعياً — ${approved.length} برنامجاً معتمداً · مستحق المتابعة: ${dueCount}`}
        actions={<LinkButton href="/plan" variant="secondary">عودة إلى الخطة</LinkButton>}
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
            return (
              <Card key={p.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <Link href={`/plan/${p.id}`} className="font-medium text-brand-700 hover:underline">
                      {p.seq}. {p.name}
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
                {canWrite && <FollowupForm programId={p.id} defaultStatus={p.executionStatus} />}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

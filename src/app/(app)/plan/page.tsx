import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs } from "@/db/schema";
import { PageHeader, Table, Badge, LinkButton, EmptyState, ProgressBar, Card } from "@/components/ui";
import { isFollowupDue } from "@/lib/plan/followup";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { FollowupDueBadge } from "./followup-badge";

export const metadata = { title: "الخطة التشغيلية" };
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  await requirePermission("plan.read");
  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYear = years.find((y) => y.status === "نشطة") ?? years[0];

  if (!activeYear) {
    return (
      <div>
        <PageHeader title="الخطة التشغيلية" />
        <EmptyState
          title="لم تستورد الخطة التشغيلية بعد"
          hint="ابدأ من صفحة الاستيراد برفع مصنف «الخطة التشغيلية المتكاملة» — 26 برنامجاً عبر أربعة مجالات"
        />
        <div className="mt-4">
          <LinkButton href="/imports/new?type=operational_plan">استيراد الخطة الآن</LinkButton>
        </div>
      </div>
    );
  }

  const excluded = await getExcludedIdSets();
  const progs = await db
    .select()
    .from(programs)
    .where(and(eq(programs.planYearId, activeYear.id), notSynthetic(programs.id, excluded.programs)))
    .orderBy(asc(programs.seq));

  const domains = [...new Set(progs.map((p) => p.domain))];
  const approved = progs.filter((p) => p.status !== "مسودة").length;
  const avgProgress = progs.length ? Math.round(progs.reduce((s, p) => s + p.progress, 0) / progs.length) : 0;

  return (
    <div>
      <PageHeader
        title={`الخطة التشغيلية — ${activeYear.nameAr}`}
        subtitle={`${progs.length} برنامجاً · معتمد: ${approved} · متوسط الإنجاز: ${avgProgress}٪ · تنتهي جميع البرامج في 5/1/1449هـ`}
        actions={
          <>
            <LinkButton href="/plan/followup">المتابعة الأسبوعية</LinkButton>
            <Badge value={activeYear.status} />
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {domains.map((d) => {
          const dp = progs.filter((p) => p.domain === d);
          const avg = Math.round(dp.reduce((s, p) => s + p.progress, 0) / dp.length);
          return (
            <Card key={d}>
              <div className="text-sm font-bold text-brand-900">{d}</div>
              <div className="mt-1 text-xs text-gray-500">{dp.length} برنامجاً</div>
              <div className="mt-2"><ProgressBar value={avg} /></div>
            </Card>
          );
        })}
      </div>
      <Table headers={["م", "البرنامج", "المجال", "مسؤول التنفيذ", "الفترة", "الإنجاز", "الحالة", ""]}>
        {progs.map((p) => (
          <tr key={p.id}>
            <td className="px-3 py-2 tabular-nums">{p.seq}</td>
            <td className="px-3 py-2 font-medium">
              <Link href={`/plan/${p.id}`} className="text-brand-700 hover:underline">{p.name}</Link>
            </td>
            <td className="px-3 py-2 text-xs">{p.domain}</td>
            <td className="px-3 py-2 text-xs">{p.ownerPosition ?? "—"}</td>
            <td className="px-3 py-2 text-xs tabular-nums">
              {p.hijriStart && p.hijriEnd ? `${p.hijriStart}هـ ← ${p.hijriEnd}هـ` : p.periodText ?? "—"}
            </td>
            <td className="px-3 py-2"><ProgressBar value={p.progress} /></td>
            <td className="px-3 py-2">
              <span className="inline-flex flex-wrap items-center gap-1">
                <Badge value={p.status} />
                {p.status === "معتمد" && isFollowupDue(p.lastReviewAt) && <FollowupDueBadge />}
              </span>
            </td>
            <td className="px-3 py-2"><LinkButton href={`/plan/${p.id}`} variant="secondary">فتح</LinkButton></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

import { and, asc, inArray, isNull } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs } from "@/db/schema";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { ClassificationsManager } from "./classifications-ui";

export const metadata = { title: "إدارة التصنيفات" };
export const dynamic = "force-dynamic";

export default async function ClassificationsPage() {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");

  const years = await db.select().from(planYears).orderBy(asc(planYears.key));
  const activeYears = years.filter((y) => y.status === "نشطة");
  const scopeYears = activeYears.length ? activeYears : years;
  const excluded = await getExcludedIdSets();

  // تصنيفات = قيم «المجال» المتمايزة بين البرامج غير المؤرشفة وغير الاصطناعية في السنة النشطة
  const progs = scopeYears.length
    ? await db
        .select({ domain: programs.domain })
        .from(programs)
        .where(and(
          inArray(programs.planYearId, scopeYears.map((y) => y.id)),
          notSynthetic(programs.id, excluded.programs),
          isNull(programs.archivedAt),
        ))
    : [];

  const countByDomain = new Map<string, number>();
  for (const p of progs) countByDomain.set(p.domain, (countByDomain.get(p.domain) ?? 0) + 1);
  const classifications = [...countByDomain.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain, "ar"));

  return (
    <div className="space-y-4">
      <PageHeader
        title="إدارة التصنيفات"
        subtitle={`«المجال» تصنيف حرّ للبرامج — أعد التسمية (دمج) أو أعد التوزيع دون حذف أي برنامج · ${classifications.length} تصنيفاً`}
        actions={<BackButton fallbackHref="/plan" />}
      />
      {classifications.length === 0 ? (
        <EmptyState
          title="لا تصنيفات بعد"
          hint="تظهر التصنيفات من حقل «المجال» في البرامج غير المؤرشفة للسنة النشطة"
        />
      ) : (
        <Card>
          <ClassificationsManager classifications={classifications} canWrite={canWrite} />
        </Card>
      )}
    </div>
  );
}

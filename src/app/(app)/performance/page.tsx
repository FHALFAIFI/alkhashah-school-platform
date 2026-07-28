import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfCycles, perfModels, people } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState, LinkButton } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { faresPreviewBatchId } from "@/lib/committees/prerequisites";
import { missingSignedReports } from "@/lib/performance/signed-reports";
import { NewCycleForm } from "./performance-ui";
import { orDash } from "@/lib/format";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "دورات الأداء" };
export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const user = await requirePermission("performance.read");
  const canSeeIndividual = user.permissions.has("performance.individual.read");
  const canWrite = user.permissions.has("performance.write");

  const excluded = await getExcludedIdSets();
  const [cycles, models, persons, faresBatchId, missingSigned] = await Promise.all([
    db.select().from(perfCycles).where(notSynthetic(perfCycles.id, excluded.perfCycles)).orderBy(desc(perfCycles.createdAt)),
    db.select().from(perfModels).where(eq(perfModels.status, "معتمد")),
    db.select().from(people).where(and(eq(people.active, true), notSynthetic(people.id, excluded.people))).orderBy(asc(people.fullName)),
    faresPreviewBatchId(),
    canSeeIndividual ? missingSignedReports() : Promise.resolve([]),
  ]);
  const personName = new Map(persons.map((p) => [p.id, p.fullName]));
  // متطلَّب سابق: التقييم يحتاج بيانات المنسوبين المعتمدة — دورة التقييم للمنسوبين المعتمدين حصراً
  const employeesReady = persons.length > 0;

  const teacherCycles = cycles.filter((c) => c.cycleType === "معلم");
  const staffCycles = cycles.filter((c) => c.cycleType === "موظف");

  return (
    <div className="space-y-5">
      <PageHeader
        title="إدارة الأداء الوظيفي"
        subtitle="دورتا المعلم (التقويم الدراسي، تبدأ بعودة المعلمين) والموظف (السنة الميلادية) منفصلتان في لوحة موحدة"
        actions={
          <>
            <SectionReportsLink category="performance" />
            <LinkButton href="/performance/models" variant="secondary">نماذج الأداء</LinkButton>
          </>
        }
      />

      {!canSeeIndividual && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">تفاصيل الأداء الفردي متاحة لمدير المدرسة فقط — تعرض هنا الحالة العامة دون التفاصيل.</p>
        </Card>
      )}

      {canSeeIndividual && missingSigned.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <h2 className="mb-2 font-bold text-amber-900">تقارير موقّعة ناقصة ({missingSigned.length})</h2>
          <p className="mb-2 text-sm text-amber-800">جلسات اكتمل تقييمها ولم يُرفع تقريرها الموقع بعد — لا تكتمل الجلسة دون رفعه.</p>
          <ul className="space-y-1">
            {missingSigned.map((m) => (
              <li key={m.sessionId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-100 bg-white/60 px-3 py-1.5 text-sm">
                <span>{m.personName} — جلسة {m.sessionType}</span>
                <LinkButton href={`/performance/cycles/${m.cycleId}/sessions/${m.sessionId}`} variant="secondary">رفع التقرير الموقع</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canWrite && !employeesReady && (
        <Card className="border-amber-300 bg-amber-50">
          <h2 className="mb-1 font-bold text-amber-900">متطلَّب سابق: بيانات منسوبي المدرسة</h2>
          <p className="text-sm text-amber-800">
            تقييم الأداء يعتمد على بيانات المنسوبين المعتمدة — الدورة تُنشأ لمنسوب معتمد حصراً. لا يوجد منسوبون
            معتمدون بعد؛ اعتمد دفعة فارس من المعاينة أولاً ثم عد لبدء دورات التقييم.
          </p>
          <div className="mt-3">
            {faresBatchId ? (
              <LinkButton href={`/imports/${faresBatchId}`}>فتح معاينة دفعة فارس</LinkButton>
            ) : (
              <LinkButton href="/imports" variant="secondary">فتح الاستيراد</LinkButton>
            )}
          </div>
        </Card>
      )}

      {canWrite && models.length > 0 && persons.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">دورة أداء جديدة</h2>
          <NewCycleForm
            people={persons.map((p) => ({ id: p.id, fullName: p.fullName, category: p.category, suggestedModelKey: p.suggestedModelKey }))}
            models={models.map((m) => ({ id: m.id, nameAr: m.nameAr, audience: m.audience, official: m.official }))}
          />
        </Card>
      )}
      {models.length === 0 && (
        <Card className="border-purple-200 bg-purple-50">
          <p className="text-sm text-purple-900">
            لا نماذج معتمدة بعد. النماذج الرسمية الثمانية تدخل من ملف الوزارة بعد التحقق البصري (الملف المصدر غير متوفر حالياً)،
            ويمكن للمدير تصميم نماذج الموظفين من <Link className="underline" href="/performance/models">مصمم النماذج</Link>.
          </p>
        </Card>
      )}

      {[{ title: "دورات المعلمين", data: teacherCycles }, { title: "دورات الموظفين", data: staffCycles }].map((group) => (
        <Card key={group.title}>
          <h2 className="mb-3 font-bold text-brand-900">{group.title} ({group.data.length})</h2>
          {group.data.length === 0 ? (
            <p className="text-sm text-gray-400">لا دورات بعد</p>
          ) : (
            <Table headers={["الاسم", "السنة", "البداية", "النهاية", "الحالة", ""]}>
              {group.data.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium">{personName.get(c.personId) ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{orDash(c.yearKey)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{c.startDate ?? "—"}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{c.endDate ?? "—"}</td>
                  <td className="px-3 py-2"><Badge value={c.status} /></td>
                  <td className="px-3 py-2">
                    {canSeeIndividual ? (
                      <LinkButton href={`/performance/cycles/${c.id}`} variant="secondary">فتح</LinkButton>
                    ) : (
                      <span className="text-xs text-gray-400">مقيد</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      ))}
    </div>
  );
}

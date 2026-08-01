import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Badge, Table, EmptyState, ProgressBar, SubmitButton } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import {
  loadOverallAnalytics,
  MIN_INSIGHT_SAMPLE,
} from "@/lib/performance/analytics-service";

export const metadata = { title: "لوحة الأداء العام" };
export const dynamic = "force-dynamic";

/**
 * لوحة الأداء العام (v2.3 §11) — كشف مواطن الضعف برؤى حسابية حتمية، بلا ذكاء
 * اصطناعي: كل رقم من قواعد معلنة، وكل رؤية تقود إلى السجلات التي حُسبت منها،
 * ولا تُعرض رؤية بعينة أقل من الحد الأدنى المعلن.
 */
export default async function PerformanceAnalyticsPage() {
  const user = await requirePermission("performance.read", "performance.individual.read");
  const { analytics, threshold } = await loadOverallAnalytics();
  const a = analytics;
  const canGenerate = user.permissions.has("reports.generate");

  // v2.4 §13: «تقرير الأداء الوظيفي التفصيلي للمدرسة» — وثيقة رسمية مرقمة بملحق أسماء
  async function issueOverallReport() {
    "use server";
    const u = await requirePermission("reports.generate", "performance.individual.read");
    const { generateOverallPerformanceReport } = await import("@/lib/reports/performance-reports");
    await generateOverallPerformanceReport({ issuedBy: u.id });
    revalidatePath("/performance/analytics");
    revalidatePath("/documents");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="لوحة الأداء العام"
        subtitle={`رؤى حسابية شفافة — عتبة الضعف ${threshold}٪ (قابلة للضبط من الإعدادات)، وأدنى عينة للرؤية ${MIN_INSIGHT_SAMPLE} تقييمات`}
        actions={
          <div className="flex flex-wrap gap-2">
            <SectionReportsLink category="performance" />
            {canGenerate && (
              <form action={issueOverallReport}>
                <SubmitButton variant="secondary">إصدار تقرير المدرسة التفصيلي (PDF)</SubmitButton>
              </form>
            )}
          </div>
        }
      />

      {/* حالات التقييم */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["لم يبدأ التقييم", a.counts.notStarted, "/performance"],
            ["قيد التقييم", a.counts.inProgress, "/performance"],
            ["بانتظار الاعتماد النهائي", a.counts.awaitingFinalApproval, "/performance"],
            ["مكتملة", a.counts.completed, "/performance"],
          ] as const
        ).map(([label, count, href]) => (
          <Card key={label}>
            <Link href={href} className="block">
              <div className="text-xs text-gray-500">{label}</div>
              <div className="mt-1 text-2xl font-bold text-brand-900 tabular-nums">{count}</div>
            </Link>
          </Card>
        ))}
      </div>

      {/* الرؤى الحتمية */}
      <Card className="border-brand-200 bg-brand-50/40">
        <h2 className="mb-2 font-bold text-brand-900">ما يلفت الانتباه</h2>
        {a.insights.length === 0 ? (
          <p className="text-sm text-gray-500">
            لا رؤى كافية بعد — تظهر الرؤى تلقائياً متى بلغت عينة التقييمات {MIN_INSIGHT_SAMPLE} فأكثر.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {a.insights.map((i, idx) => (
              <li key={idx}>
                <Link href={i.href} className="text-sm text-brand-800 hover:underline">
                  ◂ {i.text}
                </Link>
                <span className="ms-2 text-xs text-gray-400">(العينة: {i.sample})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* المعايير */}
      <Card>
        <h2 id="criteria" className="mb-2 scroll-mt-20 font-bold text-brand-900">متوسط الأداء حسب المعيار</h2>
        {a.criteria.length === 0 ? (
          <EmptyState title="لا تقديرات بعد" hint="تظهر المعايير بعد أول جلسة تقييم مقيَّمة" />
        ) : (
          <Table headers={["المعيار", "المتوسط", "", "عدد التقييمات", "دون العتبة", "الحالة"]}>
            {a.criteria.map((c) => (
              <tr key={c.name}>
                <td className="px-3 py-2 text-sm font-medium">{c.name}</td>
                <td className="px-3 py-2 tabular-nums">{c.averagePercent}٪</td>
                <td className="w-40 px-3 py-2"><ProgressBar value={c.averagePercent} /></td>
                <td className="px-3 py-2 tabular-nums">{c.sampleSize}</td>
                <td className="px-3 py-2 tabular-nums">{c.belowThresholdCycleIds.length}</td>
                <td className="px-3 py-2">
                  {c.insufficientData ? (
                    <span className="text-xs text-gray-400">عينة غير كافية</span>
                  ) : c.averagePercent < threshold ? (
                    <Badge value="يحتاج معالجة" />
                  ) : (
                    <Badge value="جاهز" />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* توزيع الدرجات */}
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">توزيع النتائج</h2>
          <Table headers={["الشريحة", "عدد الدورات"]}>
            {a.distribution.map((d) => (
              <tr key={d.bucket}>
                <td className="px-3 py-2 text-sm">{d.bucket}</td>
                <td className="px-3 py-2 tabular-nums">{d.count}</td>
              </tr>
            ))}
          </Table>
        </Card>

        {/* حسب النموذج */}
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">المتوسط حسب نموذج التقييم</h2>
          {a.byModel.length === 0 ? (
            <p className="text-sm text-gray-400">لا نتائج بعد</p>
          ) : (
            <Table headers={["النموذج", "المتوسط", "العينة"]}>
              {a.byModel.map((m) => (
                <tr key={m.modelName}>
                  <td className="px-3 py-2 text-sm">{m.modelName}</td>
                  <td className="px-3 py-2 tabular-nums">{m.averagePercent}٪</td>
                  <td className="px-3 py-2 tabular-nums">{m.sampleSize}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* من يحتاج متابعة */}
      <Card>
        <h2 className="mb-2 font-bold text-brand-900">منسوبون يحتاجون متابعة ({a.needsFollowUp.length})</h2>
        {a.needsFollowUp.length === 0 ? (
          <p className="text-sm text-gray-400">لا أحد دون العتبة حالياً</p>
        ) : (
          <Table headers={["المنسوب", "السنة", "النتيجة", "معايير ضعيفة", ""]}>
            {a.needsFollowUp.map((e) => (
              <tr key={e.cycleId}>
                <td className="px-3 py-2 text-sm font-medium">{e.personName}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{e.yearKey}</td>
                <td className="px-3 py-2 tabular-nums">{e.resultPercent === null ? "—" : `${e.resultPercent}٪`}</td>
                <td className="px-3 py-2 text-xs">{e.weakCriteria.join("، ") || "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/performance/employees/${e.personId}`} className="text-xs text-brand-700 underline">
                    التقرير التفصيلي ←
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* الضعف المتكرر + التغير بين الفترات */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">ضعف متكرر عبر المنسوبين</h2>
          {a.recurringWeaknesses.length === 0 ? (
            <p className="text-sm text-gray-400">لا ضعف متكرراً — أو العينة غير كافية</p>
          ) : (
            <Table headers={["المعيار", "منسوبون", "دورات"]}>
              {a.recurringWeaknesses.map((w) => (
                <tr key={w.name}>
                  <td className="px-3 py-2 text-sm">{w.name}</td>
                  <td className="px-3 py-2 tabular-nums">{w.affectedPeople}</td>
                  <td className="px-3 py-2 tabular-nums">{w.affectedCycles}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">التغير بين الفترات</h2>
          {a.periodChange.length === 0 ? (
            <p className="text-sm text-gray-400">يظهر التغير متى وُجدت دورتان مقيَّمتان لمنسوب</p>
          ) : (
            <Table headers={["المنسوب", "من", "إلى", "التغير"]}>
              {a.periodChange.map((p) => (
                <tr key={`${p.personId}-${p.toYear}`}>
                  <td className="px-3 py-2 text-sm">
                    <Link href={`/performance/employees/${p.personId}`} className="text-brand-700 hover:underline">
                      {p.personName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">{p.fromYear}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{p.toYear}</td>
                  <td className={`px-3 py-2 tabular-nums ${p.deltaPercent < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {p.deltaPercent > 0 ? "+" : ""}
                    {p.deltaPercent}٪
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* بلا دورة تقييم */}
      <Card>
        <h2 id="missing" className="mb-2 scroll-mt-20 font-bold text-brand-900">
          منسوبون نشطون بلا دورة تقييم ({a.missingEvaluations.length})
        </h2>
        {a.missingEvaluations.length === 0 ? (
          <p className="text-sm text-gray-400">لكل المنسوبين النشطين دورة تقييم</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {a.missingEvaluations.map((p) => (
              <li key={p.id} className="text-sm">
                <Link href={`/people/${p.id}`} className="text-brand-700 hover:underline">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

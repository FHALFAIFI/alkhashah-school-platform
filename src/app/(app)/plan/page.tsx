import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs } from "@/db/schema";
import { PageHeader, Table, Badge, LinkButton, EmptyState, ProgressBar, Card, DualDate } from "@/components/ui";
import { isFollowupDue } from "@/lib/plan/followup";
import { programStatusLabel } from "@/lib/plan/status-labels";
import { programLifecycle, PROGRAM_LIFECYCLE } from "@/lib/plan/lifecycle";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback, orDash } from "@/lib/format";
import { dualDisplay } from "@/lib/dates";
import { FollowupDueBadge } from "./followup-badge";
import { AddProgramPanel } from "./program-create-ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import { Tutorial } from "@/components/tutorial";

export const metadata = { title: "الخطة التشغيلية" };
export const dynamic = "force-dynamic";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ حالة?: string }> }) {
  const user = await requirePermission("plan.read");
  const canWrite = user.permissions.has("plan.write");
  const canGenerate = user.permissions.has("reports.generate");
  // مرشّح سير العمل ثلاثي الحالات: «قيد التنفيذ» | «مكتمل» | «مغلق» — بلا قيمة = الكل
  const stateFilter = (await searchParams)["حالة"];
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
  // البرامج المؤرشفة (حذف ناعم، v2.1 §A1) مخفية من القائمة التشغيلية وبطاقات المجالات
  const all = await db
    .select()
    .from(programs)
    .where(and(eq(programs.planYearId, activeYear.id), notSynthetic(programs.id, excluded.programs), isNull(programs.archivedAt)))
    .orderBy(asc(programs.seq));

  // البرامج المغلقة نهائياً (v2.2 §A2) تُرفع من القائمة التشغيلية وتُعرض في قسم تاريخي
  // منفصل أسفل الصفحة — لا تُحذف ولا تختفي من التقارير.
  const progs = all.filter((p) => !p.closedAt);
  const closed = all.filter((p) => p.closedAt);
  const completedCount = progs.filter((p) => p.completedAt).length;

  // تطبيق مرشّح الحالة على الجدول التشغيلي («مغلق» يعرض القسم التاريخي وحده)
  const visibleProgs =
    stateFilter === PROGRAM_LIFECYCLE.active
      ? progs.filter((p) => !p.completedAt)
      : stateFilter === PROGRAM_LIFECYCLE.completed
        ? progs.filter((p) => p.completedAt)
        : stateFilter === PROGRAM_LIFECYCLE.closed
          ? []
          : progs;
  const showClosedSection = !stateFilter || stateFilter === PROGRAM_LIFECYCLE.closed;

  const domains = [...new Set(progs.map((p) => p.domain))];
  const approved = progs.filter((p) => p.status !== "مسودة").length;
  const avgProgress = progs.length ? Math.round(progs.reduce((s, p) => s + p.progress, 0) / progs.length) : 0;

  return (
    <div>
      <PageHeader
        title={`الخطة التشغيلية — ${activeYear.nameAr}`}
        subtitle={`${progs.length} برنامجاً · معتمد: ${approved} · متوسط الإنجاز: ${avgProgress}٪${completedCount ? ` · مكتمل: ${completedCount}` : ""}${closed.length ? ` · مغلق: ${closed.length}` : ""} · تنتهي جميع البرامج في 5/1/1449هـ`}
        actions={
          <>
            <SectionReportsLink category="plan" />
            <LinkButton href="/plan/classifications" variant="secondary">إدارة التصنيفات</LinkButton>
            <LinkButton href="/plan/followup">المتابعة الأسبوعية</LinkButton>
            <Badge value={activeYear.status} />
          </>
        }
      />
      <div className="mb-4">
        <Tutorial
          id="plan"
          title="دورة حياة البرنامج — قيد التنفيذ، مكتمل، مغلق"
          steps={[
            "أنشئ البرنامج أو استورده من الخطة، ثم «اعتماد» يجمّد بياناته الأساسية.",
            "تابع التنفيذ وحدّث نسبة الإنجاز من صفحة البرنامج — الشواهد داعمة للتوثيق وليست شرطاً.",
            "عند انتهاء التنفيذ اختر «تعليم البرنامج كمكتمل» — يبقى قابلاً للتعديل والرجوع.",
            "للإغلاق النهائي اختر «إقفال البرنامج نهائياً» — يصبح البرنامج للقراءة فقط مع بقاء العرض والطباعة.",
            "«إعادة فتح البرنامج» تعيد المغلق إلى مكتمل، و«إعادة البرنامج للتنفيذ» تعيد المكتمل إلى قيد التنفيذ.",
          ]}
          note="لا تُشترط الشواهد ولا نسبة إنجاز معينة للاكتمال أو الإقفال — القرار للمدير."
        />
      </div>
      {canWrite && (
        <div className="mb-4">
          <AddProgramPanel />
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {domains.map((d) => {
          const dp = progs.filter((p) => p.domain === d);
          const avg = Math.round(dp.reduce((s, p) => s + p.progress, 0) / dp.length);
          return (
            <Card key={d}>
              <div className="text-sm font-bold text-brand-900">{orFallback(d, "بدون تصنيف")}</div>
              <div className="mt-1 text-xs text-gray-500">{dp.length} برنامجاً</div>
              <div className="mt-2"><ProgressBar value={avg} /></div>
            </Card>
          );
        })}
      </div>
      {/* مرشّح سير العمل ثلاثي الحالات — «مغلق» يعرض القسم التاريخي أدناه */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">تصفية حسب الحالة:</span>
        <LinkButton href="/plan" variant={!stateFilter ? "primary" : "secondary"}>الكل</LinkButton>
        {([
          [PROGRAM_LIFECYCLE.active, progs.length - completedCount],
          [PROGRAM_LIFECYCLE.completed, completedCount],
          [PROGRAM_LIFECYCLE.closed, closed.length],
        ] as [string, number][]).map(([state, count]) => (
          <LinkButton
            key={state}
            href={`/plan?حالة=${state}`}
            variant={stateFilter === state ? "primary" : "secondary"}
          >
            {`${state} (${count})`}
          </LinkButton>
        ))}
      </div>

      {stateFilter !== PROGRAM_LIFECYCLE.closed && (
        <Table headers={["م", "البرنامج", "المجال", "مسؤول التنفيذ", "الفترة", "الإنجاز", "الحالة", ""]}>
          {visibleProgs.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 tabular-nums">{p.seq}</td>
              <td className="px-3 py-2 font-medium">
                <Link href={`/plan/${p.id}`} className="text-brand-700 hover:underline">{orFallback(p.name)}</Link>
              </td>
              <td className="px-3 py-2 text-xs">{orFallback(p.domain, "بدون تصنيف")}</td>
              <td className="px-3 py-2 text-xs">{orDash(p.ownerPosition)}</td>
              <td className="px-3 py-2 text-xs tabular-nums">
                {p.hijriStart && p.hijriEnd ? `${p.hijriStart}هـ ← ${p.hijriEnd}هـ` : p.periodText ?? "—"}
              </td>
              <td className="px-3 py-2"><ProgressBar value={p.progress} /></td>
              <td className="px-3 py-2">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <Badge value={programLifecycle(p)} />
                  <Badge value={programStatusLabel(p.status)} />
                  {p.status === "معتمد" && !p.completedAt && isFollowupDue(p.lastReviewAt) && <FollowupDueBadge />}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex flex-wrap gap-1">
                  <LinkButton href={`/plan/${p.id}`} variant="secondary">فتح</LinkButton>
                  {/* v2.5.0 §5.1: التعديل مدخل ظاهر من القائمة أيضاً، في كل حالة */}
                  {canWrite && !p.archivedAt && (
                    <LinkButton href={`/plan/${p.id}?تعديل=1#edit`} variant="secondary">تعديل البرنامج</LinkButton>
                  )}
                  {/* v2.4 §10: وصول مباشر لبطاقة البرنامج وتقريره من القائمة */}
                  {canGenerate && (
                    <LinkButton href={`/plan/${p.id}/report`} variant="secondary">طباعة بطاقة البرنامج</LinkButton>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {showClosedSection && closed.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold text-gray-600">
            البرامج المغلقة ({closed.length})
          </h2>
          <p className="mb-3 text-xs text-gray-500">
            برامج أُقفلت نهائياً — مرفوعة من القوائم التشغيلية وباقية كاملة في التقارير والعروض
            التاريخية. يمكن إعادة فتح أي منها من صفحته.
          </p>
          <Table headers={["م", "البرنامج", "المجال", "تاريخ الإقفال", "الحالة", ""]}>
            {closed.map((p) => {
              const d = p.closedAt ? dualDisplay(p.closedAt, "employee") : null;
              return (
                <tr key={p.id} className="text-gray-500">
                  <td className="px-3 py-2 tabular-nums">{p.seq}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/plan/${p.id}`} className="text-brand-700 hover:underline">{orFallback(p.name)}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{orFallback(p.domain, "بدون تصنيف")}</td>
                  <td className="px-3 py-2 text-xs">
                    {d ? <DualDate primary={d.primary} secondary={d.secondary} /> : "—"}
                  </td>
                  <td className="px-3 py-2"><Badge value="مغلق" /></td>
                  <td className="px-3 py-2"><LinkButton href={`/plan/${p.id}`} variant="secondary">فتح</LinkButton></td>
                </tr>
              );
            })}
          </Table>
        </section>
      )}
    </div>
  );
}

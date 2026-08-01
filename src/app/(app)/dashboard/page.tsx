import Link from "next/link";
import { eq, and, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/db";
import { programs, people, evidenceItems } from "@/db/schema";
import { PageHeader, Card, Badge, EmptyState, ProgressBar } from "@/components/ui";
import { toHijriLong, toGregorianLong, dualNumericCell } from "@/lib/dates";
import {
  getWorkCenter,
  getPlanApprovalQueue,
  type WorkItem,
  type ApprovalQueueProgram,
} from "@/lib/worklist";
import { ApproveProgramButton } from "@/app/(app)/plan/[id]/program-ui";
import { strategicPendingDecisions } from "@/lib/strategic-decisions";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { loadDashboardMetrics } from "@/lib/dashboard-metrics";
import { orFallback, orDash } from "@/lib/format";

export const metadata = { title: "مركز عمل مدير المدرسة" };
export const dynamic = "force-dynamic";

const SECTION_LIMIT = 8;

function WorkItemRow({ item }: { item: WorkItem }) {
  return (
    <Link
      href={item.href}
      className="flex flex-col gap-1 rounded-lg border border-transparent px-2 py-2 transition hover:border-brand-200 hover:bg-sand-50"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* break-words: أسماء الملفات الطويلة الموصولة بشرطات سفلية تلتف بدل أن تمدّد البطاقة */}
        <span className="min-w-0 break-words text-sm font-medium text-gray-800">{item.title}</span>
        {item.status && <Badge value={item.status} />}
      </div>
      {item.detail && <p className="break-words text-xs text-gray-500">{item.detail}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
          <span aria-hidden>←</span>
          {item.action}
        </span>
        {item.due && <span className="text-xs text-gray-400 tabular-nums">الاستحقاق: {item.due}</span>}
      </div>
    </Link>
  );
}

function WorkSection({
  title,
  items,
  emptyText,
  moreHref,
}: {
  title: string;
  items: WorkItem[];
  emptyText: string;
  moreHref?: string;
}) {
  const shown = items.slice(0, SECTION_LIMIT);
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-bold text-brand-900">{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${items.length ? "bg-brand-100 text-brand-800" : "bg-sand-100 text-gray-400"}`}>
          {items.length}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="py-3 text-sm text-gray-400">{emptyText}</p>
      ) : (
        <div className="divide-y divide-sand-100">
          {shown.map((item) => (
            <WorkItemRow key={`${item.href}-${item.title}`} item={item} />
          ))}
        </div>
      )}
      {items.length > SECTION_LIMIT && moreHref && (
        <Link href={moreHref} className="mt-2 block text-center text-xs font-medium text-brand-700 hover:underline">
          عرض {items.length - SECTION_LIMIT} عنصراً إضافياً
        </Link>
      )}
    </Card>
  );
}

/** صف برنامج في طابور الاعتماد — بيانات الحالة الحقيقية مع فتح مباشر واعتماد مضمّن للمسودات */
function QueueProgramRow({ p, canApproveInline }: { p: ApprovalQueueProgram; canApproveInline: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0 flex-1 basis-64">
        <Link href={`/plan/${p.id}`} className="break-words text-sm font-medium text-brand-700 hover:underline">
          {p.seq}. {orFallback(p.name)}
        </Link>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
          <span>{orDash(p.domain)}</span>
          <span>المسؤول: {orDash(p.owner)}</span>
          {p.since && <span className="tabular-nums">منذ: {dualNumericCell(p.since)}</span>}
          <span>الشواهد: {p.evidenceCount}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {p.delayed && <Badge value="متجاوز نهايته المخططة" />}
        <ProgressBar value={p.progress} />
        {canApproveInline ? (
          <ApproveProgramButton programId={p.id} />
        ) : (
          <Link
            href={`/plan/${p.id}`}
            className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800 hover:bg-brand-50"
          >
            راجع وأقفل
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * v2.4 §11: «بانتظار اعتماد المدير» — ثلاث قوائم من حالات سير العمل الحقيقية:
 * مسودات جديدة، اكتمال موثق بانتظار الإقفال، وطلبات تعديل قيد الاعتماد.
 * الاعتماد المضمّن للمسودات يستخدم إجراء الاعتماد المدقَّق نفسه؛ الإقفال والإرجاع
 * بملاحظة يتمان من صفحة البرنامج (يتطلبان مراجعة وسبباً موثقاً). لا اعتماد جماعياً —
 * كل برنامج يُراجع منفرداً.
 */
function ApprovalQueueSection({
  queue,
  activeTab,
}: {
  queue: NonNullable<Awaited<ReturnType<typeof getPlanApprovalQueue>>>;
  activeTab?: string;
}) {
  const tabs = [
    { key: "جديد", label: "برامج جديدة بانتظار الاعتماد", count: queue.drafts.length },
    { key: "مكتمل", label: "اكتمال موثق بانتظار الإقفال", count: queue.completed.length },
    { key: "تعديلات", label: "طلبات تعديل", count: queue.changeRequests.length },
  ] as const;
  const active = tabs.some((t) => t.key === activeTab) ? (activeTab as (typeof tabs)[number]["key"]) : "جديد";
  const total = tabs.reduce((s, t) => s + t.count, 0);

  return (
    <section>
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">بانتظار اعتماد المدير</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${total ? "bg-brand-100 text-brand-800" : "bg-sand-100 text-gray-400"}`}>
            {total}
          </span>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.key === "جديد" ? "/dashboard" : `/dashboard?اعتماد=${t.key}`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                active === t.key
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-sand-200 text-gray-600 hover:bg-sand-50"
              }`}
            >
              {t.label} ({t.count})
            </Link>
          ))}
        </div>
        {active === "جديد" &&
          (queue.drafts.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">لا برامج جديدة بانتظار الاعتماد</p>
          ) : (
            <div className="divide-y divide-sand-100">
              {queue.drafts.map((p) => (
                <QueueProgramRow key={p.id} p={p} canApproveInline />
              ))}
            </div>
          ))}
        {active === "مكتمل" &&
          (queue.completed.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">لا برامج مكتملة بانتظار الإقفال</p>
          ) : (
            <div className="divide-y divide-sand-100">
              {queue.completed.map((p) => (
                <QueueProgramRow key={p.id} p={p} canApproveInline={false} />
              ))}
            </div>
          ))}
        {active === "تعديلات" &&
          (queue.changeRequests.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">لا طلبات تعديل قيد الاعتماد</p>
          ) : (
            <div className="divide-y divide-sand-100">
              {queue.changeRequests.map((cr) => (
                <Link
                  key={cr.id}
                  href={`/plan/${cr.programId}#change-requests`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-2 transition hover:border-brand-200 hover:bg-sand-50"
                >
                  <span className="min-w-0 break-words text-sm font-medium text-gray-800">
                    طلب تعديل «{orFallback(cr.fieldLabel)}» — {cr.seq}. {orFallback(cr.programName)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                    <span aria-hidden>←</span>
                    اعتمد التعديل أو ارفضه
                  </span>
                </Link>
              ))}
            </div>
          ))}
      </Card>
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ اعتماد?: string }>;
}) {
  const user = await requireUser();
  const today = new Date();
  const approvalTabParam = (await searchParams)["اعتماد"];

  // إحصاءات لوحة القيادة تستبعد السجلات الاصطناعية (مفعّل في التطوير/الإنتاج)
  const excluded = await getExcludedIdSets();
  const [work, queue, strategic, progCount, peopleCount, evidenceCount, metrics] = await Promise.all([
    getWorkCenter(user),
    getPlanApprovalQueue(user, excluded),
    strategicPendingDecisions(),
    db.select({ c: sql<number>`count(*)::int` }).from(programs).where(notSynthetic(programs.id, excluded.programs)),
    db
      .select({ c: sql<number>`count(*)::int`, category: people.category })
      .from(people)
      .where(and(eq(people.active, true), notSynthetic(people.id, excluded.people)))
      .groupBy(people.category),
    db.select({ c: sql<number>`count(*)::int` }).from(evidenceItems).where(notSynthetic(evidenceItems.id, excluded.evidence)),
    loadDashboardMetrics({
      canSeeFinance: user.permissions.has("budget.read"),
      canSeeIndividualPerf: user.permissions.has("performance.individual.read"),
    }),
  ]);

  const teachers = peopleCount.find((p) => p.category === "معلم")?.c ?? 0;
  const staff = peopleCount.find((p) => p.category === "موظف")?.c ?? 0;

  const quickLinks: { label: string; value: string; href: string }[] = [
    { label: "برامج الخطة التشغيلية", value: String(progCount[0]?.c ?? 0), href: "/plan" },
    { label: "المعلمون", value: String(teachers), href: "/people?فئة=معلم" },
    { label: "الموظفون", value: String(staff), href: "/people?فئة=موظف" },
    { label: "الشواهد", value: String(evidenceCount[0]?.c ?? 0), href: "/evidence" },
  ];

  const totalPending =
    work.needsActionNow.length +
    work.overdueTasks.length +
    work.awaitingReview.length +
    work.awaitingApproval.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="مركز عمل مدير المدرسة"
        subtitle={`مرحباً ${user.displayName} — ${toHijriLong(today)} · ${toGregorianLong(today)}`}
        actions={
          <Link
            href="/pilot"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0"
          >
            <span aria-hidden>✦</span>
            مركز التشغيل التجريبي
          </Link>
        }
      />

      {/* v2.4 §11: طابور «بانتظار اعتماد المدير» — من حالات سير العمل الحقيقية حصراً */}
      {queue && <ApprovalQueueSection queue={queue} activeTab={approvalTabParam} />}

      {/* لوحة المتابعة (v2.3 §13): مؤشرات حيّة كل بطاقة تقود إلى سجلاتها */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-gray-600">لوحة المتابعة</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {metrics.cards.map((c) => {
            const toneCls =
              c.tone === "bad"
                ? "text-red-700"
                : c.tone === "warn"
                  ? "text-amber-700"
                  : c.tone === "good"
                    ? "text-emerald-700"
                    : "text-brand-900";
            return (
              <Link
                key={c.key}
                href={c.href}
                className="block rounded-xl border border-sand-200 bg-white p-3 transition hover:border-brand-300"
              >
                <div className="text-xs text-gray-500">{c.label}</div>
                <div className={`mt-1 text-xl font-bold tabular-nums ${toneCls}`}>{c.value}</div>
                {c.hint && <div className="mt-0.5 text-[11px] text-gray-400">{c.hint}</div>}
              </Link>
            );
          })}
        </div>
      </section>

      {/* المواعيد القادمة (14 يوماً): بدايات ونهايات البرامج ومواعيد معالجة الملاحظات */}
      {metrics.upcoming.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">مواعيد قادمة (14 يوماً)</h2>
          <ul className="divide-y divide-sand-100">
            {metrics.upcoming.map((u, i) => (
              <li key={i} className="py-1.5">
                <Link href={u.href} className="flex flex-wrap items-center justify-between gap-2 hover:bg-sand-50">
                  <span className="text-sm">{u.title}</span>
                  <span className="text-xs text-gray-500 tabular-nums">{dualNumericCell(u.dateIso)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* القرارات الاستراتيجية المعلّقة أمام المدير — كل عنصر يربط بالسجل/الإجراء مباشرة */}
      {strategic.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-bold text-amber-900">قرارات مدير المدرسة الاستراتيجية</h2>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-800">{strategic.length}</span>
          </div>
          <ul className="divide-y divide-amber-100">
            {strategic.map((s) => (
              <li key={s.key} className="py-2">
                <Link href={s.href} className="block hover:bg-amber-100/50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-amber-950">{s.title}</span>
                    <Badge value={s.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-amber-800">{s.detail}</p>
                  <p className="mt-0.5 text-xs font-medium text-brand-700">← {s.action}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ما يحتاج إجراء الآن */}
      <Card className="border-brand-300 bg-brand-50/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">ما يحتاج إجراء الآن</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${work.needsActionNow.length ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
            {work.needsActionNow.length}
          </span>
        </div>
        {work.needsActionNow.length === 0 ? (
          totalPending === 0 ? (
            <EmptyState title="لا إجراءات عاجلة اليوم" hint="كل الأعمال تحت السيطرة — راجع الأقسام أدناه للمتابعة الدورية" />
          ) : (
            <p className="py-3 text-sm text-gray-500">لا عناصر عاجلة — راجع الأقسام أدناه</p>
          )
        ) : (
          <div className="grid grid-cols-1 gap-1 divide-y divide-brand-100 md:grid-cols-2 md:gap-x-6 md:divide-y-0">
            {work.needsActionNow.slice(0, 10).map((item) => (
              <WorkItemRow key={`now-${item.href}-${item.title}`} item={item} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkSection
          title="مهام متأخرة"
          items={work.overdueTasks}
          emptyText="لا مهام متأخرة"
          moreHref="/tasks"
        />
        <WorkSection
          title="عناصر بانتظار المراجعة"
          items={work.awaitingReview}
          emptyText="لا عناصر بانتظار المراجعة"
          moreHref="/evidence"
        />
        <WorkSection
          title="عناصر بانتظار الاعتماد"
          items={work.awaitingApproval}
          emptyText="لا عناصر بانتظار الاعتماد"
          moreHref="/imports"
        />
        <WorkSection
          title="قرارات اللجان المفتوحة"
          items={work.openDecisions}
          emptyText="لا قرارات مفتوحة"
          moreHref="/tasks"
        />
        <WorkSection
          title="تقييمات الأداء القادمة"
          items={work.upcomingPerformance}
          emptyText="لا جلسات أداء مستحقة"
          moreHref="/performance"
        />
        <WorkSection
          title="بلاغات الصيانة"
          items={work.maintenance}
          emptyText="لا بلاغات صيانة مفتوحة"
          moreHref="/building/maintenance"
        />

        {/* روابط سريعة */}
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">نظرة سريعة</h2>
          <div className="grid grid-cols-2 gap-3">
            {quickLinks.map((s) => (
              <Link key={s.label} href={s.href} className="rounded-lg border border-sand-200 p-3 transition hover:border-brand-300 hover:bg-sand-50">
                <div className="text-xl font-bold text-brand-900 tabular-nums">{s.value}</div>
                <div className="mt-0.5 text-xs text-gray-600">{s.label}</div>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

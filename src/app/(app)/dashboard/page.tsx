import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/db";
import { programs, people, actionTasks, evidenceItems, meetings, notifications, planYears } from "@/db/schema";
import { PageHeader, Card, ProgressBar, EmptyState } from "@/components/ui";
import { todayIso, toHijriLong, toGregorianLong } from "@/lib/dates";

export const metadata = { title: "لوحة المتابعة" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const today = new Date();

  const [progs, peopleCount, tasks, evidenceCount] = await Promise.all([
    db.select().from(programs),
    db.select({ c: sql<number>`count(*)::int`, category: people.category }).from(people).where(eq(people.active, true)).groupBy(people.category),
    db.select().from(actionTasks),
    db.select({ c: sql<number>`count(*)::int` }).from(evidenceItems),
  ]);

  const teachers = peopleCount.find((p) => p.category === "معلم")?.c ?? 0;
  const staff = peopleCount.find((p) => p.category === "موظف")?.c ?? 0;
  const avgProgress = progs.length ? Math.round(progs.reduce((s, p) => s + p.progress, 0) / progs.length) : 0;
  const openTasks = tasks.filter((t) => t.status !== "مكتملة" && t.status !== "ملغاة");
  const todayIsoStr = todayIso();
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate.toISOString().slice(0, 10) < todayIsoStr);

  const stats: { label: string; value: string; href: string; sub?: string }[] = [
    { label: "برامج الخطة التشغيلية", value: String(progs.length), href: "/plan", sub: `متوسط الإنجاز ${avgProgress}٪` },
    { label: "المعلمون", value: String(teachers), href: "/people?فئة=معلم" },
    { label: "الموظفون", value: String(staff), href: "/people?فئة=موظف" },
    { label: "مهام مفتوحة", value: String(openTasks.length), href: "/tasks", sub: overdue.length ? `${overdue.length} متأخرة` : undefined },
    { label: "الشواهد", value: String(evidenceCount[0]?.c ?? 0), href: "/evidence" },
  ];

  return (
    <div>
      <PageHeader
        title={`مرحباً، ${user.displayName}`}
        subtitle={`${toHijriLong(today)} — ${toGregorianLong(today)}`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="h-full transition hover:border-brand-300">
              <div className="text-2xl font-bold text-brand-900 tabular-nums">{s.value}</div>
              <div className="mt-1 text-sm text-gray-600">{s.label}</div>
              {s.sub && <div className="mt-0.5 text-xs text-gray-400">{s.sub}</div>}
            </Card>
          </Link>
        ))}
      </div>

      {progs.length === 0 ? (
        <EmptyState
          title="ابدأ باستيراد الخطة التشغيلية"
          hint="من صفحة الاستيراد، ارفع مصنف «الخطة التشغيلية المتكاملة 1448/1449» ثم راجع المعاينة واعتمد التنفيذ"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-bold text-brand-900">أقل البرامج إنجازاً</h2>
            <div className="space-y-2">
              {[...progs]
                .filter((p) => p.status !== "مقفل")
                .sort((a, b) => a.progress - b.progress)
                .slice(0, 6)
                .map((p) => (
                  <Link key={p.id} href={`/plan/${p.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-sand-50">
                    <span className="truncate">{p.seq}. {p.name}</span>
                    <ProgressBar value={p.progress} />
                  </Link>
                ))}
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 font-bold text-brand-900">مهام متأخرة</h2>
            {overdue.length === 0 ? (
              <p className="text-sm text-gray-400">لا مهام متأخرة</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {overdue.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-sand-50">
                    <span className="truncate">{t.title}</span>
                    <span className="text-xs text-red-600 tabular-nums">{t.dueDate?.toISOString().slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

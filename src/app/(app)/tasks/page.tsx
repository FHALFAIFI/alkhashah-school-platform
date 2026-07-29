import { desc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { actionTasks, people } from "@/db/schema";
import { PageHeader, Table, Badge, EmptyState, ProgressBar, Card } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import { dualDisplay, todayIso } from "@/lib/dates";
import { NewTaskForm, TaskStatusControl } from "./task-ui";
import { asc } from "drizzle-orm";
import Link from "next/link";
import { resolveTaskSources } from "@/lib/worklist";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback } from "@/lib/format";

export const metadata = { title: "المهام والإجراءات" };
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  meeting_outcome: "قرار اجتماع",
  program: "برنامج",
  perf_session: "جلسة أداء",
  inspection: "فحص",
  maintenance: "صيانة",
  manual: "يدوي",
  ai_assistant: "مساعد ذكي",
};

export default async function TasksPage() {
  const user = await requirePermission("tasks.read");
  const excluded = await getExcludedIdSets();
  const tasks = await db.select().from(actionTasks).where(notSynthetic(actionTasks.id, excluded.tasks)).orderBy(desc(actionTasks.createdAt));
  const persons = await db.select({ id: people.id, fullName: people.fullName }).from(people).where(notSynthetic(people.id, excluded.people)).orderBy(asc(people.fullName));
  const personName = new Map(persons.map((p) => [p.id, p.fullName]));
  const sourceLinks = await resolveTaskSources(tasks);
  const today = todayIso();

  const overdue = tasks.filter(
    (t) => t.dueDate && t.status !== "مكتملة" && t.status !== "ملغاة" && t.dueDate.toISOString().slice(0, 10) < today,
  );

  return (
    <div>
      <PageHeader
        title="المهام والإجراءات"
        subtitle={`${tasks.length} مهمة · متأخرة: ${overdue.length} — سجل موحد لجميع الوحدات`}
        actions={<SectionReportsLink category="plan" report="action-tasks" />}
      />
      {user.permissions.has("tasks.write") && (
        <Card className="mb-4">
          <NewTaskForm people={persons} />
        </Card>
      )}
      {tasks.length === 0 ? (
        <EmptyState title="لا مهام بعد" hint="تنشأ المهام من قرارات اللجان وجلسات الأداء والفحص، أو يدوياً" />
      ) : (
        <Table headers={["المهمة", "المكلف", "الموعد", "الأولوية", "التقدم", "الحالة", "المصدر", ""]}>
          {tasks.map((t) => {
            const dueIso = t.dueDate?.toISOString().slice(0, 10);
            const isOverdue = dueIso && t.status !== "مكتملة" && t.status !== "ملغاة" && dueIso < today;
            const d = dueIso ? dualDisplay(dueIso, "employee") : null;
            const src = sourceLinks.get(t.id);
            return (
              <tr key={t.id} id={`task-${t.id}`}>
                <td className="px-3 py-2">
                  <span className="font-medium">{orFallback(t.title)}</span>
                  {t.mandatory && <span className="ms-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">إلزامي</span>}
                </td>
                <td className="px-3 py-2 text-xs">{t.ownerPersonId ? orFallback(personName.get(t.ownerPersonId), "—") : t.ownerText ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {d?.primary ?? "—"}
                  {isOverdue && <div><Badge value="متأخر" /></div>}
                </td>
                <td className="px-3 py-2"><Badge value={t.priority} /></td>
                <td className="px-3 py-2"><ProgressBar value={t.progress} /></td>
                <td className="px-3 py-2"><Badge value={t.status} /></td>
                <td className="px-3 py-2 text-xs">
                  {src ? (
                    <Link href={src.href} className="text-brand-700 underline underline-offset-2 hover:text-brand-900">
                      {SOURCE_LABELS[t.sourceType ?? "manual"] ?? "المصدر"}
                    </Link>
                  ) : (
                    SOURCE_LABELS[t.sourceType ?? "manual"] ?? "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {user.permissions.has("tasks.write") && <TaskStatusControl taskId={t.id} status={t.status} progress={t.progress} />}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

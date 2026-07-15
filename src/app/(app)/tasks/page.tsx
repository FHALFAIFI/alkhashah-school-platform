import { desc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { actionTasks, people } from "@/db/schema";
import { PageHeader, Table, Badge, EmptyState, ProgressBar, Card } from "@/components/ui";
import { dualDisplay, todayIso } from "@/lib/dates";
import { NewTaskForm, TaskStatusControl } from "./task-ui";
import { asc } from "drizzle-orm";

export const metadata = { title: "المهام والإجراءات" };
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  meeting_outcome: "قرار اجتماع",
  program: "برنامج",
  perf_session: "جلسة أداء",
  inspection: "فحص",
  maintenance: "صيانة",
  manual: "يدوي",
};

export default async function TasksPage() {
  const user = await requirePermission("tasks.read");
  const tasks = await db.select().from(actionTasks).orderBy(desc(actionTasks.createdAt));
  const persons = await db.select({ id: people.id, fullName: people.fullName }).from(people).orderBy(asc(people.fullName));
  const personName = new Map(persons.map((p) => [p.id, p.fullName]));
  const today = todayIso();

  const overdue = tasks.filter(
    (t) => t.dueDate && t.status !== "مكتملة" && t.status !== "ملغاة" && t.dueDate.toISOString().slice(0, 10) < today,
  );

  return (
    <div>
      <PageHeader
        title="المهام والإجراءات"
        subtitle={`${tasks.length} مهمة · متأخرة: ${overdue.length} — سجل موحد لجميع الوحدات`}
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
            return (
              <tr key={t.id}>
                <td className="px-3 py-2">
                  <span className="font-medium">{t.title}</span>
                  {t.mandatory && <span className="ms-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">إلزامي</span>}
                </td>
                <td className="px-3 py-2 text-xs">{t.ownerPersonId ? personName.get(t.ownerPersonId) ?? "—" : t.ownerText ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {d?.primary ?? "—"}
                  {isOverdue && <div><Badge value="متأخر" /></div>}
                </td>
                <td className="px-3 py-2"><Badge value={t.priority} /></td>
                <td className="px-3 py-2"><ProgressBar value={t.progress} /></td>
                <td className="px-3 py-2"><Badge value={t.status} /></td>
                <td className="px-3 py-2 text-xs">{SOURCE_LABELS[t.sourceType ?? "manual"] ?? "—"}</td>
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

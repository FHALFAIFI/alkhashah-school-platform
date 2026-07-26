import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committeeTemplates, committeeTaskTemplates } from "@/db/schema";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { TaskTemplateManager, SeedButton } from "./task-templates-ui";

export const metadata = { title: "قوالب مهام اللجان" };
export const dynamic = "force-dynamic";

export default async function TaskTemplatesPage() {
  const user = await requirePermission("committees.read");
  const canManage = user.permissions.has("committees.approve");

  const [templates, allTasks] = await Promise.all([
    db.select().from(committeeTemplates).orderBy(asc(committeeTemplates.nameAr)),
    db.select().from(committeeTaskTemplates).orderBy(asc(committeeTaskTemplates.sortOrder)),
  ]);
  const tasksByKey = new Map<string, (typeof committeeTaskTemplates.$inferSelect)[]>();
  for (const t of allTasks) {
    const arr = tasksByKey.get(t.templateKey) ?? [];
    arr.push(t);
    tasksByKey.set(t.templateKey, arr);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="قوالب مهام اللجان"
        subtitle="مهام معرّفة مسبقاً لكل نوع لجنة/فريق/مجتمع تعلم — مركزية وقابلة لإعادة الاستخدام. تعديل القالب لاحقاً لا يغيّر أي توزيع أو وثيقة صدرت سابقاً."
        actions={<LinkButton href="/committees" variant="secondary">عودة إلى اللجان</LinkButton>}
      />
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-sm text-amber-900">
          هذه القوالب <strong>قيمٌ ابتدائية قابلة للتعديل</strong> — مبدؤها مهام القوالب الرسمية، وهي
          <strong> ليست قوائم مهام معتمدة رسمياً</strong>. راجعها وعدّلها واستبعد ما لا يلزم قبل توزيعها،
          وتُدرَج ضمن قائمة قبول المدير للمراجعة. تعديلها لاحقاً لا يعيد كتابة أي توزيع مهام أو وثيقة صدرت سابقاً.
        </p>
      </Card>
      {canManage && (
        <Card>
          <SeedButton />
        </Card>
      )}
      {templates.map((t) => (
        <Card key={t.id}>
          <h2 className="mb-1 font-bold text-brand-900">
            {t.nameAr} <span className="text-xs font-normal text-gray-400">({t.kind})</span>
          </h2>
          <TaskTemplateManager
            templateKey={t.key}
            tasks={(tasksByKey.get(t.key) ?? []).map((x) => ({ id: x.id, title: x.title, active: x.active }))}
            canManage={canManage}
          />
        </Card>
      ))}
    </div>
  );
}

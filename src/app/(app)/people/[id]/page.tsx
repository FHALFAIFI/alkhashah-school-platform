import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people, perfCycles } from "@/db/schema";
import { PageHeader, Card, Badge, SubmitButton, LinkButton } from "@/components/ui";
import { DependencyNotice } from "@/components/dependency-notice";
import { assessDeletion } from "@/lib/safe-delete";
import { employeeTypeOf } from "@/lib/employee-type";
import { PersonForm } from "../person-form";
import { deactivatePersonAction, reactivatePersonAction, deletePersonAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("people.read");
  const { id } = await params;
  const [person] = await db.select().from(people).where(eq(people.id, id));
  if (!person) notFound();

  const canSeePerformance = user.permissions.has("performance.read");
  const canOpenCycle = user.permissions.has("performance.individual.read");
  const cycles = canSeePerformance
    ? await db.select().from(perfCycles).where(eq(perfCycles.personId, id)).orderBy(desc(perfCycles.createdAt))
    : [];
  // تقييم التبعيات يُعرض دائماً قبل زر الحذف — لا حذف مفاجئ ولا حذف تعاقبي
  const assessment = await assessDeletion("person", id);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={person.fullName}
        subtitle={`${employeeTypeOf(person)}${person.jobTitle ? ` — ${person.jobTitle}` : ""}`}
        actions={person.active ? <Badge value="نشط" /> : <Badge value="موقوف" />}
      />
      {!person.active && person.deactivateReason && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">سبب الإيقاف: {person.deactivateReason}</p>
        </Card>
      )}
      {person.suggestedModelKey && (
        <Card className="border-purple-200 bg-purple-50">
          <p className="text-sm text-purple-900">
            اقتراح آلي: نموذج الأداء المناسب لهذا المسمى قد يكون «{person.suggestedModelKey}» — الاقتراح يتطلب تأكيد المدير عند إنشاء دورة الأداء ولا يعتمد تلقائياً.
          </p>
        </Card>
      )}
      <Card>
        <PersonForm person={person} />
      </Card>
      {canSeePerformance && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-brand-900">دورات الأداء ({cycles.length})</h2>
            <LinkButton href="/performance" variant="secondary">إنشاء دورة أداء</LinkButton>
          </div>
          {cycles.length === 0 ? (
            <p className="text-sm text-gray-400">لا دورات أداء لهذا الشخص بعد</p>
          ) : (
            <ul className="space-y-2">
              {cycles.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-100 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{c.yearKey}</span>
                    <span className="text-xs text-gray-400">({c.cycleType})</span>
                    <Badge value={c.status} />
                  </span>
                  {canOpenCycle ? (
                    <LinkButton href={`/performance/cycles/${c.id}`} variant="secondary">فتح</LinkButton>
                  ) : (
                    <span className="text-xs text-gray-400">مقيد</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card>
        <h2 className="mb-3 font-bold text-gray-800">إيقاف أو حذف</h2>
        {person.active ? (
          <form action={deactivatePersonAction.bind(null, person.id)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor="reason" className="mb-1 block text-sm text-gray-600">سبب الإيقاف (اختياري)</label>
              <input id="reason" name="reason" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <SubmitButton variant="secondary">إيقاف السجل</SubmitButton>
          </form>
        ) : (
          <form action={reactivatePersonAction.bind(null, person.id)}>
            <SubmitButton variant="secondary">إعادة التفعيل</SubmitButton>
          </form>
        )}
        <div className="mt-4 space-y-2">
          <DependencyNotice assessment={assessment} />
          {!assessment.blocked && (
            <form
              action={async () => {
                "use server";
                await deletePersonAction(person.id);
              }}
            >
              <SubmitButton variant="danger" confirmText={`حذف «${person.fullName}» نهائياً؟ لا يمكن التراجع.`}>
                حذف نهائي
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}

import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people, perfCycles } from "@/db/schema";
import { PageHeader, Card, Badge, SubmitButton, LinkButton } from "@/components/ui";
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

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={person.fullName}
        subtitle={`${person.category}${person.jobTitle ? ` — ${person.jobTitle}` : ""}`}
        actions={person.active ? <Badge value="نشطة" /> : <Badge value="ملغاة" />}
      />
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
        <form
          action={async () => {
            "use server";
            await deletePersonAction(person.id);
          }}
          className="mt-3"
        >
          <SubmitButton variant="danger">حذف نهائي</SubmitButton>
          <p className="mt-1 text-xs text-gray-400">الحذف النهائي ممكن فقط عندما لا توجد سجلات مرتبطة؛ وإلا استخدم الإيقاف.</p>
        </form>
      </Card>
    </div>
  );
}

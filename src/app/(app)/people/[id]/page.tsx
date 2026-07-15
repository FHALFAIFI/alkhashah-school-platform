import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PageHeader, Card, Badge, SubmitButton } from "@/components/ui";
import { PersonForm } from "../person-form";
import { deactivatePersonAction, reactivatePersonAction, deletePersonAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("people.read");
  const { id } = await params;
  const [person] = await db.select().from(people).where(eq(people.id, id));
  if (!person) notFound();

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

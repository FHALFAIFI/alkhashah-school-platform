import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfModels, perfIndicators } from "@/db/schema";
import { PageHeader, Card, Badge, Table } from "@/components/ui";
import { IndicatorForm, DeleteIndicatorButton, ApproveModelButton, ReopenModelForm } from "../models-ui";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("performance.models.manage");
  const { id } = await params;
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, id));
  if (!model) notFound();
  const indicators = await db
    .select()
    .from(perfIndicators)
    .where(eq(perfIndicators.modelId, id))
    .orderBy(asc(perfIndicators.sortOrder));
  const total = indicators.reduce((s, i) => s + Number(i.weight), 0);
  const isDraft = model.status !== "معتمد";

  return (
    <div className="space-y-5">
      <PageHeader
        title={model.nameAr}
        subtitle={`${model.audience} — ${model.official ? "نموذج رسمي (لا تعدل أسماء المؤشرات أو الأوزان بعد النقل)" : "نموذج داخلي"}`}
        actions={<Badge value={model.status} />}
      />
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-brand-900">المؤشرات ({indicators.length})</h2>
          <span className={`text-sm tabular-nums ${total === 100 ? "text-emerald-600" : "text-amber-600"}`}>
            مجموع الأوزان: {total}٪
          </span>
        </div>
        {indicators.length > 0 && (
          <Table headers={["م", "المؤشر", "الوزن", "شواهد مطلوبة", ""]}>
            {indicators.map((ind, i) => (
              <tr key={ind.id}>
                <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{ind.nameAr}</td>
                <td className="px-3 py-2 tabular-nums">{Number(ind.weight)}٪</td>
                <td className="px-3 py-2 text-xs">{ind.requiresEvidence ? "نعم" : "لا"}</td>
                <td className="px-3 py-2">{isDraft && <DeleteIndicatorButton indicatorId={ind.id} />}</td>
              </tr>
            ))}
          </Table>
        )}
        {isDraft && <IndicatorForm modelId={id} />}
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {isDraft
              ? "النموذج مسودة — لا يستخدم في الدورات قبل اعتماد المدير ومجموع أوزان 100٪."
              : "النموذج معتمد — التعديل يتطلب إعادة فتح بسبب موثق مع حفظ النسخة."}
          </p>
          {isDraft ? (
            <ApproveModelButton modelId={id} disabled={total !== 100 || indicators.length === 0} total={total} />
          ) : (
            <ReopenModelForm modelId={id} />
          )}
        </div>
      </Card>
    </div>
  );
}

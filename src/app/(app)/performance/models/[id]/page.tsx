import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfModels, perfIndicators } from "@/db/schema";
import { PageHeader, Card, Badge, Table } from "@/components/ui";
import { IndicatorForm, DeleteIndicatorButton, ApproveModelButton, ReopenModelForm } from "../models-ui";
import { isAwaitingFaresIndicator, AWAITING_FARES_LABEL } from "@/lib/performance/d014";

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
  const awaiting = (nameAr: string, weight: number | string) =>
    isAwaitingFaresIndicator({ modelKey: model.key, modelOfficial: model.official, modelVersion: model.version, indicatorNameAr: nameAr, weight });
  const hasAwaiting = indicators.some((i) => awaiting(i.nameAr, i.weight));

  return (
    <div className="space-y-5">
      <PageHeader
        title={model.nameAr}
        subtitle={`${model.audience} — ${model.official ? "نموذج رسمي (لا تعدل أسماء المؤشرات أو الأوزان بعد النقل)" : "نموذج داخلي"}`}
        actions={<Badge value={model.status} />}
      />
      {hasAwaiting && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900">
            <span className="font-bold">خلاف مصدري موثق (D-014):</span> يظهر الدليل الإرشادي (ص30/44/45) وزن 15٪ حيث
            يظهر ملف النماذج المعتمد 5٪ (قيمة الدليل تجعل مجموع الجدول 110٪ المستحيل). اعتُمدت مؤقتاً قيمة ملف النماذج
            (5٪)، والخلية معلّمة «{AWAITING_FARES_LABEL}». لا يُقفَل تقييم نهائي يعتمد هذه النسخة الأصلية حتى يطابق المدير
            القيمة مع نظام فارس ثم يصدر نسخة نموذج معتمدة جديدة (لا تُغيَّر لقطات الدورات القائمة).
          </p>
        </Card>
      )}
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
                <td className="px-3 py-2 font-medium">
                  {ind.nameAr}
                  {awaiting(ind.nameAr, ind.weight) && (
                    <span className="ms-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{AWAITING_FARES_LABEL}</span>
                  )}
                </td>
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

import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfModels, perfIndicators } from "@/db/schema";
import { PageHeader, Card, Badge, Table } from "@/components/ui";
import {
  IndicatorForm, DeleteIndicatorButton, ApproveModelButton, ReopenModelForm,
  ArchiveModelForm, RestoreModelButton, DeleteModelButton,
} from "../models-ui";
import { orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import { isAwaitingFaresIndicator, AWAITING_FARES_LABEL } from "@/lib/performance/d014";
import { modelLinkedRecords, modelInUse } from "@/lib/performance/model-admin";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("performance.models.manage");
  const { id } = await params;
  const [model] = await db.select().from(perfModels).where(eq(perfModels.id, id));
  if (!model) notFound();
  const [indicators, linked] = await Promise.all([
    db
      .select()
      .from(perfIndicators)
      .where(eq(perfIndicators.modelId, id))
      .orderBy(asc(perfIndicators.sortOrder)),
    modelLinkedRecords(id),
  ]);
  const total = indicators.reduce((s, i) => s + Number(i.weight), 0);
  const isDraft = model.status !== "معتمد";
  const awaiting = (nameAr: string, weight: number | string) =>
    isAwaitingFaresIndicator({ modelKey: model.key, modelOfficial: model.official, modelVersion: model.version, indicatorNameAr: nameAr, weight });
  const hasAwaiting = indicators.some((i) => awaiting(i.nameAr, i.weight));

  return (
    <div className="space-y-5">
      <PageHeader
        title={orFallback(model.nameAr)}
        subtitle={`${model.audience} — ${model.official ? "نموذج رسمي (لا تعدل أسماء المؤشرات أو الأوزان بعد النقل)" : "نموذج داخلي"}`}
        actions={
          <span className="flex items-center gap-2">
            {model.archivedAt && <Badge value="مؤرشف" />}
            <Badge value={model.status} />
          </span>
        }
      />
      {model.archivedAt && (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-amber-900">
              النموذج مؤرشف منذ {dualNumericCell(model.archivedAt)}
              {model.archivedReason ? ` — السبب: ${model.archivedReason}` : ""}. لا يظهر في اختيار
              الدورات الجديدة، وتقاريره التاريخية تعرض من اللقطة المجمدة في كل دورة.
            </p>
            <RestoreModelButton modelId={id} />
          </div>
        </Card>
      )}
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
                  {orFallback(ind.nameAr)}
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

      {/* إدارة النموذج (v2.4 §6): أرشفة/استعادة دائماً؛ الحذف النهائي لغير المستخدم فقط */}
      <Card className="border-sand-200">
        <h2 className="mb-2 font-bold text-brand-900">إدارة النموذج</h2>
        <p className="mb-3 text-sm text-gray-600">
          السجلات المرتبطة: {linked.employees} موظف، {linked.cycles} دورة تقييم، {linked.sessions} جلسة،{" "}
          {linked.ratings} تقدير، {linked.evidenceLinks} شاهد، {linked.documents} تقرير مُصدَر.
        </p>
        {modelInUse(linked) ? (
          <p className="mb-3 rounded bg-sand-50 p-2 text-xs text-gray-600">
            النموذج مرتبط بتقييمات — الحذف النهائي غير متاح حفاظاً على السجل التاريخي؛ الأرشفة تخفيه من
            الاستخدام الجديد دون المساس بأي بيانات.
          </p>
        ) : (
          <p className="mb-3 rounded bg-sand-50 p-2 text-xs text-gray-600">
            النموذج غير مرتبط بأي تقييم — يمكن أرشفته أو حذفه نهائياً مع مؤشراته.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {!model.archivedAt ? <ArchiveModelForm modelId={id} modelName={orFallback(model.nameAr)} /> : <RestoreModelButton modelId={id} />}
          {!modelInUse(linked) && !model.official && (
            <DeleteModelButton modelId={id} modelName={orFallback(model.nameAr)} />
          )}
        </div>
      </Card>
    </div>
  );
}

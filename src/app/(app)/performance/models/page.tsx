import Link from "next/link";
import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfModels, perfIndicators } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton } from "@/components/ui";
import { NewModelForm } from "./models-ui";
import { orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";

export const metadata = { title: "نماذج الأداء" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  await requirePermission("performance.models.manage");
  const models = await db.select().from(perfModels).orderBy(asc(perfModels.createdAt));
  const activeModels = models.filter((m) => !m.archivedAt);
  const archivedModels = models.filter((m) => m.archivedAt);
  const indicators = await db.select().from(perfIndicators);
  const countByModel = new Map<string, { count: number; total: number }>();
  for (const i of indicators) {
    const c = countByModel.get(i.modelId) ?? { count: 0, total: 0 };
    c.count++;
    c.total += Number(i.weight);
    countByModel.set(i.modelId, c);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="نماذج الأداء"
        subtitle="النماذج الرسمية الثمانية تنقل من ملف الوزارة بعد فحص بصري ولا تعدل أسماؤها أو أوزانها؛ نماذج الموظفين تصمم داخلياً وتبقى مسودة حتى اعتماد المدير"
      />
      {models.filter((m) => m.official).length >= 8 ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm text-emerald-900">
            النماذج الرسمية الثمانية منقولة حرفياً من ملف الوزارة «نماذج تقييم أداء شاغلي الوظائف التعليمية»
            (الإصدار الأول) بعد فحص بصري صفحةً صفحة، وهي معتمدة ومحمية من التعديل العادي.
            سجل التحقق والمطابقة مع الدليل الإرشادي موثق لدى مسؤول النظام.
          </p>
        </Card>
      ) : (
        <Card className="border-purple-200 bg-purple-50">
          <p className="text-sm text-purple-900">
            ملف «نماذج تقييم أداء شاغلي الوظائف التعليمية» الرسمي غير متوفر ضمن الملفات المرجعية الحالية.
            عند توفره تدخل النماذج الثمانية من هنا مع وسم «رسمي» وتتحقق بصرياً قبل الاعتماد. لا يخترع النظام أي محتوى رسمي بديل.
          </p>
        </Card>
      )}

      {/* v2.4.1 §1: مكان إجراءات دورة حياة النموذج معلن — لا بحث داخل قائمة غامضة */}
      <p className="rounded-lg bg-sand-50 px-3 py-2 text-xs text-gray-600">
        افتح أي نموذج لإدارة دورة حياته: النموذج غير المستخدم يعرض «حذف النموذج» (حذف نهائي بتأكيد صريح)، والنموذج
        المستخدم في أي دورة أو تقدير يعرض «أرشفة النموذج» فقط حفاظاً على السجل التاريخي، والمؤرشف يعرض «استعادة النموذج».
        عدد السجلات المرتبطة معروض في صفحة النموذج قبل أي إجراء.
      </p>

      {activeModels.length > 0 && (
        <Table headers={["النموذج", "الفئة", "النوع", "المؤشرات", "مجموع الأوزان", "الحالة", ""]}>
          {activeModels.map((m) => {
            const c = countByModel.get(m.id) ?? { count: 0, total: 0 };
            return (
              <tr key={m.id}>
                <td className="px-3 py-2 font-medium">
                  <Link href={`/performance/models/${m.id}`} className="text-brand-700 hover:underline">{orFallback(m.nameAr)}</Link>
                </td>
                <td className="px-3 py-2"><Badge value={m.audience} /></td>
                <td className="px-3 py-2 text-xs">{m.official ? "رسمي" : "داخلي"}</td>
                <td className="px-3 py-2 tabular-nums">{c.count}</td>
                <td className={`px-3 py-2 tabular-nums ${c.total === 100 ? "text-emerald-600" : "text-amber-600"}`}>{c.total}٪</td>
                <td className="px-3 py-2"><Badge value={m.status} /></td>
                <td className="px-3 py-2"><LinkButton href={`/performance/models/${m.id}`} variant="secondary">فتح</LinkButton></td>
              </tr>
            );
          })}
        </Table>
      )}

      {/* مرشح الأرشيف (v2.4 §6): النماذج المؤرشفة تبقى قابلة للبحث والاستعادة */}
      {archivedModels.length > 0 && (
        <details className="rounded-xl border border-sand-200 bg-sand-50/50">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700">
            النماذج المؤرشفة ({archivedModels.length})
          </summary>
          <div className="px-4 pb-4">
            <Table headers={["النموذج", "الفئة", "تاريخ الأرشفة", "السبب", ""]}>
              {archivedModels.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/performance/models/${m.id}`} className="text-brand-700 hover:underline">{orFallback(m.nameAr)}</Link>
                  </td>
                  <td className="px-3 py-2"><Badge value={m.audience} /></td>
                  <td className="px-3 py-2 text-xs tabular-nums">{m.archivedAt ? dualNumericCell(m.archivedAt) : "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{m.archivedReason ?? "—"}</td>
                  <td className="px-3 py-2"><LinkButton href={`/performance/models/${m.id}`} variant="secondary">فتح</LinkButton></td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">نموذج جديد</h2>
        <NewModelForm />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { perfModels, perfIndicators } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton } from "@/components/ui";
import { NewModelForm } from "./models-ui";

export const metadata = { title: "نماذج الأداء" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  await requirePermission("performance.models.manage");
  const models = await db.select().from(perfModels).orderBy(asc(perfModels.createdAt));
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
            (الإصدار الأول) بعد فحص بصري صفحةً صفحة، وهي معتمدة ومقفلة عن التعديل العادي.
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

      {models.length > 0 && (
        <Table headers={["النموذج", "الفئة", "النوع", "المؤشرات", "مجموع الأوزان", "الحالة", ""]}>
          {models.map((m) => {
            const c = countByModel.get(m.id) ?? { count: 0, total: 0 };
            return (
              <tr key={m.id}>
                <td className="px-3 py-2 font-medium">
                  <Link href={`/performance/models/${m.id}`} className="text-brand-700 hover:underline">{m.nameAr}</Link>
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

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">نموذج جديد</h2>
        <NewModelForm />
      </Card>
    </div>
  );
}

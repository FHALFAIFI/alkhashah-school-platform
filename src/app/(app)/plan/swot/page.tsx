import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planSwotItems } from "@/db/schema";
import { PageHeader, Table, EmptyState, Badge, Card } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { SectionReportsLink } from "@/components/section-reports-link";
import { orFallback } from "@/lib/format";

export const metadata = { title: "التحليل الرباعي" };
export const dynamic = "force-dynamic";

/** ترتيب العرض الرسمي: قوة ثم ضعف ثم فرصة ثم تهديد */
const CATEGORY_ORDER = ["قوة", "ضعف", "فرصة", "تهديد"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  قوة: "نقاط القوة",
  ضعف: "نقاط الضعف",
  فرصة: "الفرص",
  تهديد: "التهديدات",
};

/**
 * «التحليل الرباعي» — عرض ورقة SWOT الرسمية من مصنف الخطة التشغيلية.
 *
 * البيانات رسمية مستوردة حرفياً ولا تُحرَّر هنا: هذه الصفحة عرض وقراءة، ومصدرها دفعة
 * استيراد الخطة. الاستبعاد الاصطناعي يتم عبر السنة التخطيطية — عناصر SWOT مرتبطة بالسنة
 * كالمؤشرات والمخاطر، فسنة العرض التجريبية تُخفي عناصرها معها.
 */
export default async function SwotPage() {
  await requirePermission("plan.read");
  const excluded = await getExcludedIdSets();
  const items = await db
    .select()
    .from(planSwotItems)
    .where(notSynthetic(planSwotItems.planYearId, excluded.planYears))
    .orderBy(asc(planSwotItems.sortOrder), asc(planSwotItems.code));

  const byCategory = CATEGORY_ORDER.map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    rows: items.filter((i) => i.category === c),
  }));
  // نوع غير معروف في المصدر لا يختفي صامتاً — يُعرض في مجموعته كما ورد
  const other = items.filter((i) => !(CATEGORY_ORDER as readonly string[]).includes(i.category));

  return (
    <div className="space-y-4">
      <PageHeader
        title="التحليل الرباعي"
        subtitle="عناصر القوة والضعف والفرص والتهديدات — من ورقة «التحليل الرباعي» في مصنف الخطة التشغيلية"
        actions={<SectionReportsLink category="risks" report="swot-register" />}
      />

      {items.length === 0 ? (
        <EmptyState
          title="لا عناصر تحليل رباعي بعد"
          hint="تُستورد عناصر التحليل الرباعي ضمن دفعة استيراد الخطة التشغيلية من ورقة «التحليل الرباعي»"
        />
      ) : (
        <>
          <Card className="border-sand-300 bg-sand-50">
            <p className="text-sm text-gray-700">
              العناصر رسمية ومحفوظة حرفياً من المصدر — تُعرض هنا ولا تُحرَّر. تحديثها يتم بإعادة استيراد
              مصنف الخطة.
            </p>
          </Card>

          {[...byCategory, ...(other.length > 0 ? [{ key: "أخرى", label: "أنواع أخرى", rows: other }] : [])]
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.key}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-600">
                  {g.label}
                  <Badge value={String(g.rows.length)} />
                </h2>
                <Table headers={["الرمز", "العنصر", "الدلالة الاستراتيجية"]}>
                  {g.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-xs tabular-nums">{r.code}</td>
                      <td className="px-3 py-2 font-medium">{r.item}</td>
                      <td className="px-3 py-2 text-xs">{orFallback(r.implication, "—")}</td>
                    </tr>
                  ))}
                </Table>
              </section>
            ))}
        </>
      )}
    </div>
  );
}

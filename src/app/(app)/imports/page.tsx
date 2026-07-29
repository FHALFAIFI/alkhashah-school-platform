import { desc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { importBatches } from "@/db/schema";
import { PageHeader, Table, Badge, LinkButton, EmptyState } from "@/components/ui";
import { dualDisplay } from "@/lib/dates";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "الاستيراد" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  people: "بيانات الموظفين (فارس)",
  operational_plan: "الخطة التشغيلية",
  plan_swot: "التحليل الرباعي",
  calendar: "التقويم الدراسي",
  assets: "العهدة والأصول",
};

export default async function ImportsPage() {
  await requirePermission("imports.read");
  const batches = await db.select().from(importBatches).orderBy(desc(importBatches.createdAt));

  return (
    <div>
      <PageHeader
        title="دفعات الاستيراد"
        subtitle="كل استيراد يمر بمعاينة وتحقق وتصحيح ثم موافقة صريحة، ويمكن التراجع الكامل عند الأمان"
        actions={
          <>
            <SectionReportsLink category="imports" />
            <LinkButton href="/imports/new?type=people" variant="secondary">استيراد أشخاص</LinkButton>
            <LinkButton href="/imports/new?type=plan_swot" variant="secondary">استيراد التحليل الرباعي</LinkButton>
            <LinkButton href="/imports/new?type=operational_plan">استيراد الخطة التشغيلية</LinkButton>
          </>
        }
      />
      {batches.length === 0 ? (
        <EmptyState title="لا توجد دفعات استيراد بعد" hint="ابدأ باستيراد الخطة التشغيلية من المصنف المرجعي" />
      ) : (
        <Table headers={["النوع", "الملف المصدر", "الحالة", "التاريخ", "الملخص", ""]}>
          {batches.map((b) => {
            const d = dualDisplay(b.createdAt.toISOString().slice(0, 10), "employee");
            return (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium">{TYPE_LABELS[b.importType] ?? b.importType}</td>
                <td className="px-3 py-2">{b.sourceFileName}</td>
                <td className="px-3 py-2"><Badge value={b.status} /></td>
                <td className="px-3 py-2 text-xs text-gray-500 tabular-nums">{d?.primary}</td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {b.summary ? Object.entries(b.summary as Record<string, number>).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}
                </td>
                <td className="px-3 py-2"><LinkButton href={`/imports/${b.id}`} variant="secondary">فتح</LinkButton></td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

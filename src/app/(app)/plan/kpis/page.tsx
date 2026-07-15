import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { programKpis } from "@/db/schema";
import { PageHeader, Table, EmptyState } from "@/components/ui";

export const metadata = { title: "مؤشرات الأداء" };
export const dynamic = "force-dynamic";

export default async function KpisPage() {
  await requirePermission("plan.read");
  const kpis = await db.select().from(programKpis).orderBy(asc(programKpis.code));
  return (
    <div>
      <PageHeader title="مؤشرات الأداء" subtitle="القيم الرسمية من مصنف الخطة — خط الأساس والمستهدف كما وردا" />
      {kpis.length === 0 ? (
        <EmptyState title="لا مؤشرات بعد" hint="تستورد المؤشرات ضمن دفعة استيراد الخطة التشغيلية" />
      ) : (
        <Table headers={["الرمز", "المؤشر", "خط الأساس", "المستهدف", "الدورية", "المالك", "مصدر البيانات", "الاتجاه", "مواعيد القياس"]}>
          {kpis.map((k) => (
            <tr key={k.id}>
              <td className="px-3 py-2 tabular-nums">{k.code}</td>
              <td className="px-3 py-2 font-medium">{k.nameAr}</td>
              <td className="px-3 py-2 tabular-nums">{k.baseline ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums">{k.target ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{k.periodicity ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{k.owner ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{k.dataSource ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{k.direction ?? "—"}</td>
              <td className="px-3 py-2 text-xs tabular-nums">{k.measureDates ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

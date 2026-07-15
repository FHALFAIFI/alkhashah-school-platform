import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { programRisks } from "@/db/schema";
import { PageHeader, Table, EmptyState, Badge } from "@/components/ui";

export const metadata = { title: "سجل المخاطر" };
export const dynamic = "force-dynamic";

export default async function RisksPage() {
  await requirePermission("plan.read");
  const risks = await db.select().from(programRisks).orderBy(asc(programRisks.code));
  return (
    <div>
      <PageHeader title="سجل المخاطر" subtitle="من مصنف الخطة التشغيلية" />
      {risks.length === 0 ? (
        <EmptyState title="لا مخاطر مسجلة بعد" hint="تستورد المخاطر ضمن دفعة استيراد الخطة التشغيلية" />
      ) : (
        <Table headers={["الرمز", "الخطر", "الاحتمالية", "الأثر", "التصنيف", "المعالجة", "المالك"]}>
          {risks.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 tabular-nums">{r.code}</td>
              <td className="px-3 py-2 font-medium">{r.risk}</td>
              <td className="px-3 py-2 text-xs">{r.likelihood ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{r.impact ?? "—"}</td>
              <td className="px-3 py-2">{r.classification ? <Badge value={r.classification === "حرج" ? "عالية" : r.classification} /> : "—"}</td>
              <td className="px-3 py-2 text-xs">{r.treatment ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{r.owner ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

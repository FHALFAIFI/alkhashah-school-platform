import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { evidenceItems, evidenceLinks } from "@/db/schema";
import { PageHeader, Table, Badge, EmptyState } from "@/components/ui";

export const metadata = { title: "الشواهد" };
export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  await requirePermission("evidence.read");
  const items = await db.select().from(evidenceItems).orderBy(desc(evidenceItems.createdAt));
  const links = await db.select().from(evidenceLinks);
  const linkCount = new Map<string, number>();
  for (const l of links) linkCount.set(l.evidenceId, (linkCount.get(l.evidenceId) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        title="سجل الشواهد الموحد"
        subtitle="يرفع الشاهد مرة واحدة ويربط بعدة سجلات عبر جميع الوحدات — لا يحذف شاهد مرتبط بسجل معتمد"
      />
      {items.length === 0 ? (
        <EmptyState title="لا شواهد بعد" hint="تضاف الشواهد من داخل البرامج والاجتماعات وجلسات الأداء، أو من هنا" />
      ) : (
        <Table headers={["العنوان", "النوع", "الدور", "المصدر", "حالة المراجعة", "الروابط", "تنزيل"]}>
          {items.map((item) => (
            <tr key={item.id} id={`ev-${item.id}`}>
              <td className="px-3 py-2 font-medium">{item.title}</td>
              <td className="px-3 py-2 text-xs">{item.kind === "file" ? "ملف" : item.kind === "link" ? "رابط" : "نص"}</td>
              <td className="px-3 py-2">{item.role ? <Badge value={item.role} /> : "—"}</td>
              <td className="px-3 py-2 text-xs">{item.source ?? "—"}</td>
              <td className="px-3 py-2 text-xs">{item.reviewStatus}</td>
              <td className="px-3 py-2 tabular-nums">{linkCount.get(item.id) ?? 0}</td>
              <td className="px-3 py-2">
                {item.fileId ? (
                  <a href={`/api/files/${item.fileId}`} className="text-xs text-brand-700 underline">تنزيل</a>
                ) : item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 underline">فتح الرابط</a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

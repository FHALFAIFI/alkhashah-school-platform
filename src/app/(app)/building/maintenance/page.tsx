import { asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { maintenanceIssues, rooms } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { NewIssueForm, IssueStatusControl } from "./maintenance-ui";

export const metadata = { title: "الصيانة" };
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const user = await requirePermission("maintenance.read");
  const [issues, allRooms] = await Promise.all([
    db.select().from(maintenanceIssues).orderBy(desc(maintenanceIssues.createdAt)),
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.nameAr)),
  ]);
  const roomName = new Map(allRooms.map((r) => [r.id, r.nameAr]));
  const canWrite = user.permissions.has("maintenance.write");

  return (
    <div className="space-y-4">
      <PageHeader
        title="بلاغات الصيانة"
        subtitle="سير عمل بسيط: بلاغ ← إصلاح ← إغلاق وتحقق — بلا بوابة موردين أو فواتير أو تكاليف"
      />
      {canWrite && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">بلاغ جديد</h2>
          <NewIssueForm rooms={allRooms.map((r) => ({ id: r.id, label: `${r.nameAr} (${r.code})` }))} />
        </Card>
      )}
      {issues.length === 0 ? (
        <EmptyState title="لا بلاغات صيانة" />
      ) : (
        <Table headers={["الرمز", "البلاغ", "الموقع", "الأولوية", "الحالة", "الصور", canWrite ? "تحديث" : ""]}>
          {issues.map((i) => (
            <tr key={i.id}>
              <td className="px-3 py-2 tabular-nums">{i.code}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{i.title}</span>
                {i.description && <p className="text-xs text-gray-400">{i.description}</p>}
                {i.repairNote && <p className="text-xs text-emerald-700">الإصلاح: {i.repairNote}</p>}
              </td>
              <td className="px-3 py-2 text-xs">{i.roomId ? roomName.get(i.roomId) ?? "—" : "—"}</td>
              <td className="px-3 py-2"><Badge value={i.priority} /></td>
              <td className="px-3 py-2"><Badge value={i.status} /></td>
              <td className="px-3 py-2 text-xs">
                {(i.photos ?? []).map((p, idx) => (
                  <a key={p} href={`/api/files/${p}`} className="me-1 text-brand-700 underline">صورة {idx + 1}</a>
                ))}
                {(i.photos ?? []).length === 0 && "—"}
              </td>
              <td className="px-3 py-2">
                {canWrite && i.status !== "مغلق ومتحقق" && <IssueStatusControl issueId={i.id} status={i.status} />}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

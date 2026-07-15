import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { PageHeader, Table, EmptyState } from "@/components/ui";

export const metadata = { title: "سجل التدقيق" };
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requirePermission("admin.audit.read");
  const rows = await db
    .select({
      log: auditLog,
      actorName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(300);

  return (
    <div>
      <PageHeader title="سجل التدقيق" subtitle="سجل إلحاقي للقراءة فقط — آخر 300 حدث" />
      {rows.length === 0 ? (
        <EmptyState title="لا أحداث" />
      ) : (
        <Table headers={["الوقت", "المنفذ", "الإجراء", "البيان", "الكيان"]}>
          {rows.map(({ log, actorName }) => (
            <tr key={log.id}>
              <td className="px-3 py-2 text-xs tabular-nums">
                {log.createdAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "medium" })}
              </td>
              <td className="px-3 py-2 text-xs">{actorName ?? "—"}</td>
              <td className="px-3 py-2 text-xs font-medium" dir="ltr">{log.action}</td>
              <td className="px-3 py-2 text-xs">{log.summary ?? "—"}</td>
              <td className="px-3 py-2 text-xs" dir="ltr">{log.entityType ?? ""}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

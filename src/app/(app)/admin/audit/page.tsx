import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { PageHeader, Table, EmptyState } from "@/components/ui";
import { peopleFieldLabel } from "@/lib/imports/people-fields";

export const metadata = { title: "سجل التدقيق" };
export const dynamic = "force-dynamic";

type Snapshot = { status?: string; mapped?: Record<string, unknown> | null };

/**
 * قبل/بعد لأحداث قرارات الاستيراد — يعرض تغير الحالة والقيم التي تغيرت فقط.
 * يظهر لأي حدث يحمل detail بلقطتي before/after ولا يغير عرض بقية الأحداث.
 */
function BeforeAfterDetail({ detail }: { detail: unknown }) {
  const d = detail as { before?: Snapshot; after?: Snapshot; resolvedWarnings?: string[] } | null;
  if (!d?.before || !d?.after) return null;
  const bm = (d.before.mapped ?? {}) as Record<string, unknown>;
  const am = (d.after.mapped ?? {}) as Record<string, unknown>;
  const changedKeys = [...new Set([...Object.keys(bm), ...Object.keys(am)])].filter(
    (k) => String(bm[k] ?? "") !== String(am[k] ?? ""),
  );
  return (
    <details className="mt-1 text-gray-500">
      <summary className="cursor-pointer select-none text-gray-400 hover:text-gray-600">قبل / بعد</summary>
      <div className="ms-2 mt-1 space-y-0.5 border-s border-sand-200 ps-2">
        {d.before.status !== d.after.status && (
          <div>
            الحالة: «{d.before.status}» ← «{d.after.status}»
          </div>
        )}
        {changedKeys.map((k) => (
          <div key={k}>
            {peopleFieldLabel(k)}: «{String(bm[k] ?? "—")}» ← «{String(am[k] ?? "—")}»
          </div>
        ))}
        {d.before.status === d.after.status && changedKeys.length === 0 && <div>لا تغيير في الحالة أو القيم</div>}
        {d.resolvedWarnings?.map((w, i) => (
          <div key={i} className="text-amber-600">حسم التحذير: {w}</div>
        ))}
      </div>
    </details>
  );
}

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
              <td className="px-3 py-2 text-xs">
                {log.summary ?? "—"}
                <BeforeAfterDetail detail={log.detail} />
              </td>
              <td className="px-3 py-2 text-xs" dir="ltr">{log.entityType ?? ""}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

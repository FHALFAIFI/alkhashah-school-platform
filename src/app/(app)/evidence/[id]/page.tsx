import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { evidenceItems, evidenceVersions } from "@/db/schema";
import { PageHeader, Card, Badge, LinkButton, Table } from "@/components/ui";
import { DependencyNotice } from "@/components/dependency-notice";
import { evidenceUsage } from "@/lib/evidence";
import { assessDeletion } from "@/lib/safe-delete";
import { EvidenceManageUI } from "./evidence-manage-ui";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EvidenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("evidence.read");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [item] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, id));
  if (!item) notFound();

  const canWrite = user.permissions.has("evidence.write");
  const canDelete = user.permissions.has("evidence.delete");

  const [usage, versions, assessment] = await Promise.all([
    evidenceUsage(id),
    db.select().from(evidenceVersions).where(eq(evidenceVersions.evidenceId, id)).orderBy(desc(evidenceVersions.version)),
    assessDeletion("evidence", id),
  ]);
  const totalLinks = usage.reduce((n, u) => n + u.refs.length, 0);

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title={item.title}
        subtitle={`النسخة ${item.version} — مستخدم في ${totalLinks} سجلاً`}
        actions={
          <>
            {item.archivedAt && <Badge value="مؤرشف" />}
            <Badge value={item.reviewStatus} />
            <LinkButton href="/evidence" variant="secondary">سجل الشواهد</LinkButton>
          </>
        }
      />

      {item.archivedAt && item.archivedReason && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">سبب الأرشفة: {item.archivedReason}</p>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">بيانات الشاهد</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Meta label="النوع" value={item.kind === "file" ? "ملف" : item.kind === "link" ? "رابط" : "نص"} />
          <Meta label="دور الشاهد" value={item.role} />
          <Meta label="تصنيف الشاهد" value={item.evidenceType} />
          <Meta label="المصدر" value={item.source} />
          <Meta label="جهة الإصدار" value={item.issuer} />
          <Meta label="تاريخ الشاهد" value={item.evidenceDate} />
          <Meta label="الأصل" value={item.origin} />
          <Meta label="الوصف" value={item.description} />
        </dl>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {item.fileId && <a href={`/api/files/${item.fileId}`} className="text-brand-700 underline">تنزيل الملف</a>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">فتح الرابط</a>
          )}
        </div>
        {item.textContent && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-sand-50 p-3 text-sm text-gray-700">{item.textContent}</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-bold text-brand-900">مستخدم في ({totalLinks})</h2>
        <p className="mb-3 text-xs text-gray-500">
          الشاهد الواحد يخدم كل هذه السجلات — لا يُرفع مرة أخرى لأي منها.
        </p>
        {usage.length === 0 ? (
          <p className="text-sm text-gray-400">غير مرتبط بأي سجل بعد</p>
        ) : (
          <div className="space-y-3">
            {usage.map((u) => (
              <div key={u.entityType}>
                <p className="mb-1 text-sm font-medium text-gray-700">{u.labelAr} ({u.refs.length})</p>
                <ul className="space-y-1">
                  {u.refs.map((r) => (
                    <li
                      key={`${r.id}-${r.subKey}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-100 px-3 py-2 text-sm"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{r.labelAr}</span>
                        {r.locked && <Badge value="مقفل" />}
                        {r.subKey && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">{r.subKey}</span>}
                      </span>
                      {r.href && <Link href={r.href} className="text-xs text-brand-700 underline">فتح السجل</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {versions.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">سجل النسخ ({versions.length})</h2>
          <Table headers={["النسخة", "النوع", "سبب الاستبدال", "التاريخ", "الملف"]}>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2 tabular-nums">{v.version}</td>
                <td className="px-3 py-2 text-xs">{v.kind === "file" ? "ملف" : v.kind === "link" ? "رابط" : "نص"}</td>
                <td className="px-3 py-2 text-xs">{v.reason}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{v.replacedAt.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2">
                  {v.fileId ? (
                    <a href={`/api/files/${v.fileId}`} className="text-xs text-brand-700 underline">تنزيل</a>
                  ) : v.url ? (
                    <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 underline">فتح</a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {canWrite && (
        <>
          <Card>
            <h2 className="mb-2 font-bold text-gray-800">حالة الحذف</h2>
            <DependencyNotice assessment={assessment} />
          </Card>
          <EvidenceManageUI
            evidenceId={item.id}
            currentKind={item.kind}
            archived={!!item.archivedAt}
            canDelete={canDelete && !assessment.blocked}
          />
        </>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-800">{value || "—"}</dd>
    </div>
  );
}

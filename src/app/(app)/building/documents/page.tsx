import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/db";
import { floors, rooms, assets } from "@/db/schema";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { SCAN_TARGETS, listScannedDocuments } from "@/lib/building/document-scan";
import { orFallback } from "@/lib/format";
import { DocumentScanner } from "./document-scanner";

export const metadata = { title: "مسح المستندات" };
export const dynamic = "force-dynamic";

export default async function BuildingDocumentsPage() {
  const user = await requireUser();
  const canScan =
    user.permissions.has("building.write") ||
    user.permissions.has("inspections.write") ||
    user.permissions.has("maintenance.write") ||
    user.permissions.has("assets.write");
  const canDownload = user.permissions.has("files.download");

  const [allFloors, allRooms, allAssets, docs] = await Promise.all([
    db.select().from(floors).orderBy(asc(floors.sortOrder)),
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.nameAr)),
    db.select().from(assets).where(eq(assets.active, true)).orderBy(asc(assets.nameAr)),
    listScannedDocuments(50),
  ]);

  const targetTypes = [
    { value: "building", label: SCAN_TARGETS.building },
    { value: "floor", label: SCAN_TARGETS.floor },
    { value: "room", label: SCAN_TARGETS.room },
    { value: "asset", label: SCAN_TARGETS.asset },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="مسح المستندات وإرفاقها"
        subtitle="امسح المستندات الورقية بكاميرا الجوال إلى ملف PDF وأرفقها بالمبنى أو الدور أو الغرفة أو الأصل — أو ارفع ملفاً. المسح محلي بالكامل ولا يُرسل لأي خدمة خارجية."
      />

      {canScan ? (
        <Card>
          <DocumentScanner
            csrfToken={user.csrfToken}
            targetTypes={targetTypes}
            floors={allFloors.map((f) => ({ value: f.id, label: f.nameAr }))}
            rooms={allRooms.map((r) => ({ value: r.id, label: `${orFallback(r.nameAr)} (${r.code})` }))}
            assets={allAssets.map((a) => ({ value: a.id, label: `${orFallback(a.nameAr)} (${a.code})` }))}
          />
        </Card>
      ) : (
        <EmptyState title="لا تملك صلاحية إرفاق المستندات" hint="تتطلب هذه الصفحة صلاحية تحرير في وحدة المبنى" />
      )}

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">المستندات الممسوحة ({docs.length})</h2>
        {docs.length === 0 ? (
          <EmptyState title="لا مستندات ممسوحة بعد" hint="ستظهر هنا المستندات التي تمسحها أو ترفعها" />
        ) : (
          <ul className="divide-y divide-sand-100">
            {docs.map((d) => (
              <li key={d.evidenceId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{d.title}</span>
                  <span className="ms-2 text-xs text-gray-500">
                    {SCAN_TARGETS[d.targetType]} · {d.category ?? "—"}
                    {d.sensitive && <span className="ms-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">حساس</span>}
                  </span>
                </div>
                {d.fileId && canDownload ? (
                  <a href={`/api/files/${d.fileId}`} className="text-sm text-brand-700 underline">تنزيل PDF</a>
                ) : (
                  <span className="text-xs text-gray-400">التنزيل للمصرّح لهم</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-gray-400">
        <Link href="/building" className="underline">← وحدة المبنى</Link>
      </p>
    </div>
  );
}

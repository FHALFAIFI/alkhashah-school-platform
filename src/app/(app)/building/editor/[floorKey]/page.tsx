import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { floors, floorGeometryVersions, floorBackgrounds, siteZones } from "@/db/schema";
import { PageHeader, Badge, Card } from "@/components/ui";
import { EditorLoader } from "./editor-loader";
import type { FloorGeometry } from "@/lib/building/geometry";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ floorKey: string }> }) {
  const user = await requirePermission("building.write");
  const { floorKey } = await params;
  const [floor] = await db.select().from(floors).where(eq(floors.key, floorKey));
  if (!floor) notFound();
  const [zone] = await db.select().from(siteZones).where(eq(siteZones.key, floor.zoneKey));
  const isContext = zone?.zoneType === "context";

  const versions = await db
    .select()
    .from(floorGeometryVersions)
    .where(eq(floorGeometryVersions.floorId, floor.id))
    .orderBy(desc(floorGeometryVersions.version));
  const latest = versions[0] ?? null;

  const [bg] = await db
    .select()
    .from(floorBackgrounds)
    .where(and(eq(floorBackgrounds.floorId, floor.id), eq(floorBackgrounds.active, true)))
    .orderBy(desc(floorBackgrounds.createdAt))
    .limit(1);

  const emptyGeometry: FloorGeometry = { unit: "m", rooms: [] };

  return (
    <div>
      <PageHeader
        title={`محرر المخطط: ${floor.nameAr}`}
        subtitle="مخطط تشغيلي — قارن مع صورة المصدر (الخلفية) وصحح قبل النشر · القياسات بالمتر بمنزلة عشرية واحدة"
        actions={latest ? <Badge value={latest.status} /> : undefined}
      />
      {isContext ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">هذه المنطقة سياق جغرافي فقط ولا تقبل تحريراً أو سجلات.</p>
        </Card>
      ) : (
        <EditorLoader
          floorId={floor.id}
          floorName={floor.nameAr}
          isSite={floor.key === "site"}
          isContext={isContext}
          initialGeometry={(latest?.geometry as unknown as FloorGeometry) ?? emptyGeometry}
          latestVersion={latest?.version ?? 0}
          latestVersionId={latest?.id ?? null}
          latestStatus={latest?.status ?? "—"}
          background={
            bg
              ? {
                  id: bg.id,
                  url: `/api/files/${bg.fileId}`,
                  transform: bg.transform as { x: number; y: number; scale: number; rotation: number; opacity: number; visible: boolean },
                }
              : null
          }
          canPublish={user.permissions.has("building.publish")}
        />
      )}

      {versions.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold text-brand-900">سجل نسخ الهندسة</h2>
          <div className="space-y-1 text-sm text-gray-600">
            {versions.slice(0, 10).map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">نسخة {v.version}</span>
                <Badge value={v.status} />
                {v.note && <span className="text-xs text-gray-400">{v.note}</span>}
                <span className="text-xs text-gray-400 tabular-nums">
                  {v.createdAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

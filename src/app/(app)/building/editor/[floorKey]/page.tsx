import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { floors, floorGeometryVersions, siteZones } from "@/db/schema";
import { PageHeader, Badge, Card } from "@/components/ui";
import { ManualEditor } from "./manual-editor";
import { RollbackButton, PublishButton } from "./rollback-ui";
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
        <>
        <Card className="mb-3 border-sand-200 bg-sand-50/60 lg:hidden">
          <p className="text-sm text-gray-600">
            التحرير الدقيق للجدران والغرف (السحب وتغيير الأبعاد على الرسم) متاح على شاشة الحاسب أو اللوحي — استخدم شاشة
            أكبر للتحرير الدقيق. على الجوال يمكنك تعديل بيانات الغرفة وأبعادها رقمياً من صفحة الغرفة، والفحص والصيانة.
          </p>
        </Card>
        <ManualEditor
          floorId={floor.id}
          initialGeometry={(latest?.geometry as unknown as FloorGeometry) ?? emptyGeometry}
          canPublish={user.permissions.has("building.publish")}
        />
        </>
      )}

      {versions.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 font-bold text-brand-900">سجل نسخ الهندسة — قارن وتراجع موثقاً</h2>
          <p className="mb-2 text-xs text-gray-400">النشر لا يستبدل النسخ السابقة؛ كل نسخة تحفظ المحرّر والوقت والسبب. التراجع يُنشئ نسخة جديدة موثقة.</p>
          <div className="space-y-1 text-sm text-gray-600">
            {versions.slice(0, 10).map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">نسخة {v.version}</span>
                <Badge value={v.status} />
                <span className="text-xs text-gray-500">غرف: {Array.isArray((v.geometry as { rooms?: unknown[] })?.rooms) ? (v.geometry as { rooms: unknown[] }).rooms.length : 0}</span>
                {v.note && <span className="text-xs text-gray-400">{v.note}</span>}
                <span className="text-xs text-gray-400 tabular-nums">
                  {v.createdAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                </span>
                {v.status === "مسودة" && user.permissions.has("building.publish") && <PublishButton versionId={v.id} version={v.version} />}
                {v.status !== "منشورة" && <RollbackButton versionId={v.id} version={v.version} />}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

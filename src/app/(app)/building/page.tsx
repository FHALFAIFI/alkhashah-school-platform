import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { floors, floorGeometryVersions, rooms as roomsTable } from "@/db/schema";
import { PageHeader, Card, Badge, LinkButton, Table } from "@/components/ui";
import type { FloorGeometry } from "@/lib/building/geometry";
import { FloorViewer } from "./floor-viewer";
import { OpenRoomByCodeForm } from "./building-ui";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "مخطط المبنى" };
export const dynamic = "force-dynamic";

export default async function BuildingPage({ searchParams }: { searchParams: Promise<{ دور?: string }> }) {
  const user = await requirePermission("building.read");
  const params = await searchParams;
  const allFloors = await db.select().from(floors).orderBy(asc(floors.sortOrder));
  const activeKey = params["دور"] ?? "site";
  const active = allFloors.find((f) => f.key === activeKey) ?? allFloors[0];

  const versions = active
    ? await db
        .select()
        .from(floorGeometryVersions)
        .where(eq(floorGeometryVersions.floorId, active.id))
        .orderBy(desc(floorGeometryVersions.version))
    : [];
  const published = versions.find((v) => v.status === "منشورة");
  const shown = published ?? versions[0];
  const geometry = shown ? (shown.geometry as unknown as FloorGeometry) : null;

  const floorRooms = active
    ? await db.select().from(roomsTable).where(and(eq(roomsTable.floorId, active.id), eq(roomsTable.active, true)))
    : [];

  const canWrite = user.permissions.has("building.write");

  return (
    <div className="space-y-4">
      <PageHeader
        title="التوأم الرقمي للمبنى المدرسي"
        subtitle="مخطط تشغيلي وليس رسماً هندسياً معتمداً · الإحداثيات: 17.2484051، 43.0609594 · مجمع البنات يظهر سياقاً جغرافياً فقط"
        actions={
          <div className="flex flex-wrap gap-2">
            <SectionReportsLink category="building" />
            <LinkButton href="/building/report" variant="secondary">تقرير المبنى</LinkButton>
            <LinkButton href="/building/documents" variant="secondary">مسح المستندات</LinkButton>
            <LinkButton href="/building/scan" variant="secondary">مسح رمز QR</LinkButton>
            <LinkButton href={`/building/3d?دور=${active?.key}`} variant="secondary">عرض ثلاثي الأبعاد</LinkButton>
            {canWrite && active && <LinkButton href={`/building/editor/${active.key}`}>فتح المحرر</LinkButton>}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {allFloors.map((f) => (
          <LinkButton key={f.id} href={`/building?دور=${f.key}`} variant={f.key === active?.key ? "primary" : "secondary"}>
            {f.nameAr}
          </LinkButton>
        ))}
      </div>

      <Card>
        <OpenRoomByCodeForm />
        <p className="mt-1 text-xs text-gray-400">اكتب الرمز المطبوع على ملصق الغرفة — يعمل دون كاميرا أو مسح ضوئي</p>
      </Card>

      {geometry ? (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold text-brand-900">{active.nameAr}</h2>
            <div className="flex items-center gap-2">
              {shown && <Badge value={shown.status} />}
              <span className="text-xs text-gray-400 tabular-nums">نسخة {shown?.version}</span>
            </div>
          </div>
          {!published && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              تعرض مسودة غير منشورة — راجعها في المحرر مع صورة المصدر ثم انشرها لمزامنة سجل الغرف.
            </p>
          )}
          {/* key بمفتاح الدور: تبديل الدور يعيد ضبط عرض التقريب/السحب بدل وراثة إحداثيات دور آخر */}
          <FloorViewer
            key={active.key}
            geometry={geometry}
            roomLinks={Object.fromEntries(floorRooms.map((r) => [r.geomKey, `/building/rooms/${r.id}`]))}
          />
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-gray-400">لا هندسة لهذا الدور بعد — افتح المحرر وارسمها</p>
        </Card>
      )}

      {floorRooms.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">غرف {active.nameAr} ({floorRooms.length})</h2>
          <Table headers={["الرمز", "الاسم", "النوع", "الأبعاد", "المساحة", ""]}>
            {floorRooms.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 tabular-nums">{r.code}</td>
                <td className="px-3 py-2 font-medium">
                  <Link prefetch={false} href={`/building/rooms/${r.id}`} className="text-brand-700 hover:underline">{r.nameAr}</Link>
                </td>
                <td className="px-3 py-2 text-xs">{r.roomType}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{r.lengthM && r.widthM ? `${Number(r.lengthM).toFixed(1)}×${Number(r.widthM).toFixed(1)}م` : "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{r.areaM2 ? `${Number(r.areaM2).toFixed(1)} م²` : "—"}</td>
                <td className="px-3 py-2"><LinkButton href={`/building/rooms/${r.id}`} variant="secondary">فتح</LinkButton></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

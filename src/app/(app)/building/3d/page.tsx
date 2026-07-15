import { asc, desc, eq, and } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { floors, floorGeometryVersions } from "@/db/schema";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { IsoLoader } from "./iso-loader";
import type { FloorGeometry } from "@/lib/building/geometry";

export const metadata = { title: "العرض ثلاثي الأبعاد" };
export const dynamic = "force-dynamic";

export default async function ThreeDPage() {
  await requirePermission("building.read");
  const allFloors = await db.select().from(floors).orderBy(asc(floors.sortOrder));
  const buildingFloors = allFloors.filter((f) => f.level >= 0);
  const floorsWithGeometry: { key: string; nameAr: string; level: number; geometry: FloorGeometry }[] = [];
  for (const f of buildingFloors) {
    const [v] = await db
      .select()
      .from(floorGeometryVersions)
      .where(eq(floorGeometryVersions.floorId, f.id))
      .orderBy(desc(floorGeometryVersions.version))
      .limit(1);
    if (v) floorsWithGeometry.push({ key: f.key, nameAr: f.nameAr, level: f.level, geometry: v.geometry as unknown as FloorGeometry });
  }

  return (
    <div>
      <PageHeader
        title="عرض متساوي القياس ثلاثي الأبعاد"
        subtitle="مولد من الهندسة المخزنة نفسها — عرض مبسط للاستئناس"
        actions={<LinkButton href="/building" variant="secondary">عودة للمخطط</LinkButton>}
      />
      <Card>
        <IsoLoader floors={floorsWithGeometry} />
      </Card>
    </div>
  );
}

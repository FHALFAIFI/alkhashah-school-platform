import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms, floors, inspectionTemplates } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

/** بيانات وضع عدم الاتصال: الغرف والقوالب المعتمدة — تخزن في IndexedDB على الجهاز */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("inspections.write")) {
    return NextResponse.json({ error: "لا تملك صلاحية الفحص" }, { status: 403 });
  }
  const allFloors = await db.select().from(floors).orderBy(asc(floors.sortOrder));
  const allRooms = await db.select().from(rooms).where(eq(rooms.active, true));
  const templates = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.status, "معتمد"));
  return NextResponse.json({
    floors: allFloors.map((f) => ({ id: f.id, key: f.key, nameAr: f.nameAr })),
    rooms: allRooms.map((r) => ({ id: r.id, floorId: r.floorId, code: r.code, nameAr: r.nameAr, roomType: r.roomType })),
    templates: templates.map((t) => ({ id: t.id, nameAr: t.nameAr, roomType: t.roomType, items: t.items, version: t.version })),
    csrfToken: user.csrfToken,
  });
}

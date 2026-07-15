import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import {
  rooms, floors, assets, inspections, inspectionTemplates, maintenanceIssues, readinessOverrides,
} from "@/db/schema";
import { PageHeader, Card, Badge, Table, ProgressBar } from "@/components/ui";
import { computeRoomReadiness } from "@/lib/building/readiness";
import { InspectionRunForm, ReadinessOverrideForm } from "./room-ui";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("building.read");
  const { id } = await params;
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
  if (!room) notFound();
  const [floor] = await db.select().from(floors).where(eq(floors.id, room.floorId));

  const [roomAssets, roomInspections, openIssues, override, templates] = await Promise.all([
    db.select().from(assets).where(and(eq(assets.roomId, id), eq(assets.active, true))),
    db.select().from(inspections).where(eq(inspections.roomId, id)).orderBy(desc(inspections.inspectionDate)).limit(10),
    db.select().from(maintenanceIssues).where(eq(maintenanceIssues.roomId, id)),
    db.select().from(readinessOverrides).where(eq(readinessOverrides.roomId, id)).orderBy(desc(readinessOverrides.createdAt)).limit(1),
    db.select().from(inspectionTemplates).where(eq(inspectionTemplates.status, "معتمد")),
  ]);

  const open = openIssues.filter((i) => i.status === "مفتوح" || i.status === "قيد الإصلاح");
  const latestInspection = roomInspections[0] ?? null;
  const { readiness, source, parts } = computeRoomReadiness({
    latestInspection: latestInspection ? { results: latestInspection.results ?? [] } : null,
    assets: roomAssets.map((a) => ({ condition: a.condition, important: a.important })),
    openIssues: open.length,
    override: override[0] ? { value: override[0].overrideValue } : null,
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3080";
  const qrDataUrl = await QRCode.toDataURL(`${appUrl}/building/rooms/${room.id}`, { width: 180, margin: 1 });
  const matchingTemplates = templates.filter((t) => !t.roomType || t.roomType === room.roomType);
  const canInspect = user.permissions.has("inspections.write");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${room.nameAr} (${room.code})`}
        subtitle={`${floor.nameAr} — ${room.roomType}${room.lengthM && room.widthM ? ` — ${Number(room.lengthM).toFixed(1)}×${Number(room.widthM).toFixed(1)}م` : ""}${room.areaM2 ? ` — ${Number(room.areaM2).toFixed(1)} م²` : ""}`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">الجاهزية ({source})</h2>
          <div className="text-2xl font-bold text-brand-900 tabular-nums">{readiness}٪</div>
          <ProgressBar value={readiness} />
          {Object.keys(parts).length > 0 && (
            <p className="mt-2 text-xs text-gray-400">
              {Object.entries(parts).map(([k, v]) => `${k}: ${v}٪`).join(" · ")}
            </p>
          )}
          {override[0] && (
            <p className="mt-1 text-xs text-amber-700">تجاوز يدوي — السبب: {override[0].reason}</p>
          )}
          {canInspect && <ReadinessOverrideForm roomId={id} />}
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">رمز الاستجابة السريعة للغرفة</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`رمز ${room.nameAr}`} className="mx-auto" />
          <p className="text-center text-xs text-gray-400 tabular-nums">{room.code}</p>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">بلاغات الصيانة</h2>
          <div className="text-2xl font-bold text-brand-900 tabular-nums">{open.length}</div>
          <p className="text-xs text-gray-400">بلاغات مفتوحة من أصل {openIssues.length}</p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">العهدة ({roomAssets.length})</h2>
        {roomAssets.length === 0 ? (
          <p className="text-sm text-gray-400">لا أصول مسجلة — تضاف من صفحة العهدة والأصول</p>
        ) : (
          <Table headers={["الرمز", "الأصل", "النوع", "الكمية/الرقم التسلسلي", "الحالة"]}>
            {roomAssets.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 tabular-nums">{a.code}</td>
                <td className="px-3 py-2 font-medium">{a.nameAr}</td>
                <td className="px-3 py-2 text-xs">{a.important ? "أصل مهم (سجل فردي)" : "متكرر بالكمية"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{a.important ? a.serialNumber ?? "—" : a.quantity}</td>
                <td className="px-3 py-2"><Badge value={a.condition === "جيدة" || a.condition === "ممتازة" ? "مكتمل" : "متأخر"} /> <span className="text-xs">{a.condition}</span></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الفحص</h2>
        {canInspect && matchingTemplates.length > 0 && (
          <InspectionRunForm
            roomId={id}
            templates={matchingTemplates.map((t) => ({ id: t.id, nameAr: t.nameAr, items: t.items }))}
          />
        )}
        {matchingTemplates.length === 0 && (
          <p className="mb-3 text-sm text-amber-700">لا قوالب فحص معتمدة لهذا النوع — اعتمد القوالب من صفحة الفحص والجاهزية</p>
        )}
        {roomInspections.length > 0 && (
          <Table headers={["التاريخ", "النتيجة", "ملاحظات"]}>
            {roomInspections.map((ins) => {
              const results = ins.results ?? [];
              const ok = results.filter((r) => r.ok).length;
              return (
                <tr key={ins.id}>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {ins.inspectionDate.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{ok}/{results.length} سليم</td>
                  <td className="px-3 py-2 text-xs">{ins.notes ?? "—"}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import {
  rooms, floors, floorGeometryVersions, assets, inspections, inspectionTemplates,
  maintenanceIssues, people, readinessOverrides,
} from "@/db/schema";
import { PageHeader, Card, Badge, LinkButton, Table, ProgressBar } from "@/components/ui";
import { computeRoomReadiness } from "@/lib/building/readiness";
import { isUuid } from "@/lib/validation";
import { InspectionRunForm, ReadinessOverrideForm, RoomEditForm, RoomIssueForm } from "./room-ui";
import { AskAssistant } from "@/components/assistant/ask-assistant";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("building.read");
  const { id } = await params;
  if (!isUuid(id)) notFound(); // معرّف غير صالح ⇒ 404 نظيف بدل خطأ تحويل uuid في القاعدة
  const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
  if (!room) notFound();
  const [floor] = await db.select().from(floors).where(eq(floors.id, room.floorId));

  const [roomAssets, roomInspections, openIssues, override, templates, activePeople, geometryVersions] = await Promise.all([
    db.select().from(assets).where(and(eq(assets.roomId, id), eq(assets.active, true))),
    db.select().from(inspections).where(eq(inspections.roomId, id)).orderBy(desc(inspections.inspectionDate)).limit(10),
    db.select().from(maintenanceIssues).where(eq(maintenanceIssues.roomId, id)),
    db.select().from(readinessOverrides).where(eq(readinessOverrides.roomId, id)).orderBy(desc(readinessOverrides.createdAt)).limit(1),
    db.select().from(inspectionTemplates).where(eq(inspectionTemplates.status, "معتمد")),
    db.select().from(people).where(eq(people.active, true)).orderBy(asc(people.fullName)),
    db
      .select({ id: floorGeometryVersions.id, version: floorGeometryVersions.version, status: floorGeometryVersions.status })
      .from(floorGeometryVersions)
      .where(eq(floorGeometryVersions.floorId, room.floorId))
      .orderBy(desc(floorGeometryVersions.version)),
  ]);

  const open = openIssues.filter((i) => i.status === "مفتوح" || i.status === "قيد الإصلاح");
  const latestInspection = roomInspections[0] ?? null;
  const { readiness, source, parts } = computeRoomReadiness({
    latestInspection: latestInspection ? { results: latestInspection.results ?? [] } : null,
    assets: roomAssets.map((a) => ({ condition: a.condition, important: a.important })),
    openIssues: open.length,
    override: override[0] ? { value: override[0].overrideValue } : null,
  });

  // رابط رمز QR من عنوان الطلب الفعلي — يعمل عبر Tailscale أو أي نطاق دون تثبيت اسم جهاز
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const appUrl = host ? `${proto}://${host}` : (process.env.APP_URL ?? "http://localhost:3080");
  const qrDataUrl = await QRCode.toDataURL(`${appUrl}/building/rooms/${room.id}`, { width: 180, margin: 1 });
  const matchingTemplates = templates.filter((t) => !t.roomType || t.roomType === room.roomType);
  const canInspect = user.permissions.has("inspections.write");
  const canEdit = user.permissions.has("building.write");
  const canReport = user.permissions.has("maintenance.write");
  const canPublish = user.permissions.has("building.publish");

  // مسودة مخطط أحدث من المنشورة؟ (تنشأ تلقائياً عند حفظ تعديل بيانات الغرفة)
  const latestGeometry = geometryVersions[0] ?? null;
  const publishedGeometry = geometryVersions.find((v) => v.status === "منشورة") ?? null;
  const draftPending =
    latestGeometry?.status === "مسودة" && (!publishedGeometry || latestGeometry.version > publishedGeometry.version);

  const peopleOptions = activePeople.map((p) => ({ id: p.id, label: p.fullName }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${room.nameAr} (${room.code})`}
        subtitle={`${floor.nameAr} — ${room.roomType}${room.lengthM && room.widthM ? ` — ${Number(room.lengthM).toFixed(1)}×${Number(room.widthM).toFixed(1)}م` : ""}${room.areaM2 ? ` — ${Number(room.areaM2).toFixed(1)} م²` : ""}`}
        actions={user.permissions.has("ai.use") ? <AskAssistant type="room" id={id} label={`غرفة ${room.nameAr} (${room.code})`} /> : undefined}
      />

      {/* صف الإجراء التالي — أين أنا وماذا أفعل الآن */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-bold text-brand-900">
            الجاهزية: <span className="tabular-nums">{readiness}٪</span>
          </span>
          {canInspect && matchingTemplates.length > 0 && <LinkButton href="#inspection" variant="secondary">سجل فحصاً</LinkButton>}
          {canReport && <LinkButton href="#report-issue" variant="secondary">أبلغ عن عطل</LinkButton>}
          {canEdit && <LinkButton href="#edit-room" variant="secondary">حدّث البيانات</LinkButton>}
        </div>
      </Card>

      {draftPending && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">التعديل محفوظ في مسودة المخطط — انشر النسخة ليظهر على المخطط</p>
          {canPublish ? (
            <div className="mt-2">
              <LinkButton href={`/building/editor/${floor.key}`} variant="secondary">فتح محرر الدور للنشر</LinkButton>
            </div>
          ) : (
            <p className="mt-1 text-xs text-amber-800">النشر يتم من صاحب صلاحية نشر المخطط (مدير المدرسة) — تعديلك محفوظ ولن يضيع</p>
          )}
        </Card>
      )}

      {(canEdit || canReport) && (
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <RoomEditForm
              roomId={id}
              initial={{
                nameAr: room.nameAr,
                roomType: room.roomType,
                lengthM: room.lengthM,
                widthM: room.widthM,
                capacity: room.capacity,
                notes: room.notes,
              }}
            />
          )}
          {canReport && <RoomIssueForm roomId={id} people={peopleOptions} />}
        </div>
      )}

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
        <h2 id="inspection" className="mb-3 scroll-mt-20 font-bold text-brand-900">الفحص</h2>
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

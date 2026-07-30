import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import {
  rooms, floors, floorGeometryVersions, assets, inspections, inspectionTemplates,
  maintenanceIssues, people, readinessOverrides, roomTypes, inspectionFindings, users,
} from "@/db/schema";
import { PageHeader, Card, Badge, LinkButton, Table, ProgressBar } from "@/components/ui";
import { computeRoomReadiness } from "@/lib/building/readiness";
import { templateAppliesToRoom } from "@/lib/building/room-types";
import { dualNumericCell } from "@/lib/dates";
import { isUuid } from "@/lib/validation";
import { orFallback } from "@/lib/format";
import { InspectionRunForm, ReadinessOverrideForm, RoomEditForm, RoomIssueForm, FindingControls } from "./room-ui";
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

  const [roomAssets, roomInspections, openIssues, override, templates, activePeople, geometryVersions, registry, roomFindings] = await Promise.all([
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
    db.select().from(roomTypes).orderBy(asc(roomTypes.sortOrder)),
    db.select().from(inspectionFindings).where(eq(inspectionFindings.roomId, id)).orderBy(desc(inspectionFindings.createdAt)),
  ]);

  const open = openIssues.filter((i) => i.status !== "مغلق" && i.status !== "مسودة");
  const openFindings = roomFindings.filter((f) => f.status === "يحتاج معالجة");
  const latestInspection = roomInspections[0] ?? null;
  const overrideActorName = override[0]?.actorId
    ? (await db.select({ name: users.displayName }).from(users).where(eq(users.id, override[0].actorId)))[0]?.name ?? null
    : null;
  const readiness = computeRoomReadiness({
    latestInspection: latestInspection
      ? { results: latestInspection.results ?? [], templateSnapshot: latestInspection.templateSnapshot }
      : null,
    override: override[0]
      ? { value: override[0].overrideValue, reason: override[0].reason, actorName: overrideActorName, at: override[0].createdAt }
      : null,
  });

  // رابط رمز QR من عنوان الطلب الفعلي — يعمل عبر Tailscale أو أي نطاق دون تثبيت اسم جهاز
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const appUrl = host ? `${proto}://${host}` : (process.env.APP_URL ?? "http://localhost:3080");
  const qrDataUrl = await QRCode.toDataURL(`${appUrl}/building/rooms/${room.id}`, { width: 180, margin: 1 });
  // المطابقة عبر سجل أنواع الغرف (D-037): الأسماء التاريخية تُحلّ إلى النوع نفسه
  const registryEntries = registry.map((t) => ({ key: t.key, labelAr: t.labelAr, aliases: t.aliases, active: t.active }));
  const matchingTemplates = templates.filter((t) => templateAppliesToRoom(t.roomType, room.roomType, registryEntries));
  const canInspect = user.permissions.has("inspections.write");
  const canEdit = user.permissions.has("building.write");
  const canReport = user.permissions.has("maintenance.write");
  const canPublish = user.permissions.has("building.publish");

  // مسودة مخطط أحدث من المنشورة؟ (تنشأ تلقائياً عند حفظ تعديل بيانات الغرفة)
  const latestGeometry = geometryVersions[0] ?? null;
  const publishedGeometry = geometryVersions.find((v) => v.status === "منشورة") ?? null;
  const draftPending =
    latestGeometry?.status === "مسودة" && (!publishedGeometry || latestGeometry.version > publishedGeometry.version);

  const peopleOptions = activePeople.map((p) => ({ id: p.id, label: orFallback(p.fullName) }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${orFallback(room.nameAr)} (${room.code})`}
        subtitle={`${floor.nameAr} — ${orFallback(room.roomType)}${room.lengthM && room.widthM ? ` — ${Number(room.lengthM).toFixed(1)}×${Number(room.widthM).toFixed(1)}م` : ""}${room.areaM2 ? ` — ${Number(room.areaM2).toFixed(1)} م²` : ""}`}
        actions={user.permissions.has("ai.use") ? <AskAssistant type="room" id={id} label={`غرفة ${orFallback(room.nameAr)} (${room.code})`} /> : undefined}
      />

      {/* صف الإجراء التالي — أين أنا وماذا أفعل الآن */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-bold text-brand-900">
            الجاهزية: <Badge value={readiness.statusAr} />
            {readiness.percent !== null && <span className="tabular-nums">{readiness.percent}٪</span>}
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
        <div id="صيانة" className="flex flex-wrap items-start gap-2 scroll-mt-20">
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
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-600">
            الجاهزية <Badge value={readiness.statusAr} />
          </h2>
          {readiness.percent === null ? (
            <p className="text-sm text-gray-400">لا فحص مسجَّل بعد — الجاهزية تُحسب من أول فحص</p>
          ) : (
            <>
              <div className="text-2xl font-bold text-brand-900 tabular-nums">{readiness.percent}٪</div>
              <ProgressBar value={readiness.percent} />
            </>
          )}
          {/* لماذا؟ — البنود الفاشلة بالاسم والخطورة (v2.3 §16: الحساب شفاف) */}
          {readiness.failedCritical.length > 0 && (
            <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">
              <p className="font-bold">بنود حرجة فاشلة — الغرفة لا تُعد جاهزة قبل معالجتها:</p>
              <ul className="ms-4 list-disc">
                {readiness.failedCritical.map((c) => (
                  <li key={c.key}>{c.label}</li>
                ))}
              </ul>
            </div>
          )}
          {readiness.failedOther.length > 0 && (
            <div className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
              <p className="font-bold">بنود تحتاج معالجة:</p>
              <ul className="ms-4 list-disc">
                {readiness.failedOther.map((c) => (
                  <li key={c.key}>
                    {c.label} <span className="text-amber-600">({c.severity})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {readiness.override && (
            <p className="mt-2 text-xs text-amber-700">
              تجاوز يدوي إلى {readiness.override.value}٪ — السبب: {readiness.override.reason}
              {readiness.override.actorName ? ` — بواسطة ${readiness.override.actorName}` : ""}
              {readiness.override.at ? ` (${dualNumericCell(readiness.override.at)})` : ""}
            </p>
          )}
          {canInspect && <ReadinessOverrideForm roomId={id} />}
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-bold text-gray-600">رمز الاستجابة السريعة للغرفة</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt={`رمز ${orFallback(room.nameAr)}`} className="mx-auto" />
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
                <td className="px-3 py-2 font-medium">{orFallback(a.nameAr)}</td>
                <td className="px-3 py-2 text-xs">{a.important ? "أصل مهم (سجل فردي)" : "متكرر بالكمية"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{a.important ? a.serialNumber ?? "—" : a.quantity}</td>
                <td className="px-3 py-2"><Badge value={a.condition === "جيدة" || a.condition === "ممتازة" ? "مكتمل" : "متأخر"} /> <span className="text-xs">{a.condition}</span></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ملاحظات الفحص المفتوحة (v2.3 §16): متابعة كل بند فاشل حتى الإغلاق أو تحويله بلاغ صيانة */}
      {roomFindings.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">
            ملاحظات الفحص ({openFindings.length} تحتاج معالجة من {roomFindings.length})
          </h2>
          <Table headers={["البند", "الخطورة", "الملاحظة", "الموعد المستهدف", "الحالة", "بلاغ الصيانة", ""]}>
            {roomFindings.map((f) => (
              <tr key={f.id}>
                <td className="px-3 py-2 text-sm font-medium">
                  {f.label}
                  {f.critical && <span className="ms-1 text-xs text-red-700">(حرج)</span>}
                </td>
                <td className="px-3 py-2"><Badge value={f.severity} /></td>
                <td className="px-3 py-2 text-xs">{f.note ?? "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{f.targetDate ? dualNumericCell(f.targetDate) : "—"}</td>
                <td className="px-3 py-2"><Badge value={f.status} /></td>
                <td className="px-3 py-2 text-xs">
                  {f.maintenanceIssueId ? (
                    <a href={`/building/maintenance/${f.maintenanceIssueId}`} className="text-brand-700 underline">
                      فتح البلاغ
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {canInspect && f.status === "يحتاج معالجة" && (
                    <FindingControls findingId={f.id} hasIssue={!!f.maintenanceIssueId} canCreateIssue={canReport} />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

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

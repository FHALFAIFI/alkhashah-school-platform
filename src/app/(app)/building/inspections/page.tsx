import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { inspectionTemplates, inspections, rooms, floors, maintenanceIssues, readinessOverrides } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton, ProgressBar } from "@/components/ui";
import { AskAssistant } from "@/components/assistant/ask-assistant";
import { computeRoomReadiness } from "@/lib/building/readiness";
import { statusLabel } from "@/lib/building/inspection-template-defs";
import { orFallback } from "@/lib/format";
import { ApproveTemplateButton } from "./inspections-ui";

export const metadata = { title: "الفحص والجاهزية" };
export const dynamic = "force-dynamic";

export default async function InspectionsPage() {
  const user = await requirePermission("inspections.read");
  const [templates, allRooms, allFloors, allInspections, allIssues, overrides] = await Promise.all([
    db.select().from(inspectionTemplates).orderBy(asc(inspectionTemplates.createdAt)),
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.code)),
    db.select().from(floors),
    db.select().from(inspections).orderBy(desc(inspections.inspectionDate)),
    db.select().from(maintenanceIssues),
    db.select().from(readinessOverrides).orderBy(desc(readinessOverrides.createdAt)),
  ]);
  const floorName = new Map(allFloors.map((f) => [f.id, f.nameAr]));
  const canApprove = user.permissions.has("building.publish");

  const readinessRows = allRooms.map((room) => {
    const latest = allInspections.find((i) => i.roomId === room.id) ?? null;
    const open = allIssues.filter(
      (i) => i.roomId === room.id && i.status !== "مغلق" && i.status !== "مسودة",
    ).length;
    const override = overrides.find((o) => o.roomId === room.id) ?? null;
    const readiness = computeRoomReadiness({
      latestInspection: latest
        ? { results: latest.results ?? [], templateSnapshot: latest.templateSnapshot }
        : null,
      override: override ? { value: override.overrideValue, reason: override.reason } : null,
    });
    return { room, readiness, lastInspection: latest?.inspectionDate ?? null, open };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="الفحص والجاهزية"
        subtitle="أنشئ قوالب الفحص وحرّرها وفعّلها من «قوالب الفحص» — القوالب المُفعّلة تظهر في الفحص الميداني الذي يدعم وضع عدم الاتصال"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {user.permissions.has("ai.use") && (
              <AskAssistant type="inspection" id={user.id} label="الفحص والجاهزية" />
            )}
            <LinkButton href="/building/inspections/templates">قوالب الفحص</LinkButton>
            <LinkButton href="/building/offline">وضع الفحص دون اتصال</LinkButton>
          </div>
        }
      />

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">قوالب الفحص ({templates.length})</h2>
          <Link href="/building/inspections/templates" className="text-sm text-brand-700 underline">
            إدارة القوالب والإصدارات ←
          </Link>
        </div>
        <Table headers={["القالب", "نوع الغرفة", "البنود", "الحالة", ""]}>
          {templates.map((t) => (
            <tr key={t.id} id={`tpl-${t.id}`} className="scroll-mt-20">
              <td className="px-3 py-2 font-medium">
                <Link href={`/building/inspections/templates/${t.id}`} className="text-brand-700 hover:underline">
                  {orFallback(t.nameAr)}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs">{t.roomType ?? "عام"}</td>
              <td className="px-3 py-2 tabular-nums">{t.items.length}</td>
              <td className="px-3 py-2"><Badge value={statusLabel(t.status)} /></td>
              <td className="px-3 py-2">
                {t.status === "مسودة" && canApprove && <ApproveTemplateButton templateId={t.id} />}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">جاهزية الغرف</h2>
        <p className="mb-3 text-xs text-gray-500">
          الحالة من آخر فحص: بند حرج فاشل = «غير جاهز»، بنود غير حرجة فاشلة = «يحتاج معالجة»،
          وكل التفاصيل بنداً بنداً داخل صفحة الغرفة.
        </p>
        <Table headers={["الرمز", "الغرفة", "الدور", "الحالة", "نسبة البنود السليمة", "آخر فحص", "بلاغات قائمة"]}>
          {readinessRows.map(({ room, readiness, lastInspection, open }) => (
            <tr key={room.id}>
              <td className="px-3 py-2 tabular-nums">{room.code}</td>
              <td className="px-3 py-2 font-medium">
                <Link href={`/building/rooms/${room.id}`} className="text-brand-700 hover:underline">{orFallback(room.nameAr)}</Link>
              </td>
              <td className="px-3 py-2 text-xs">{floorName.get(room.floorId)}</td>
              <td className="px-3 py-2"><Badge value={readiness.statusAr} /></td>
              <td className="px-3 py-2">
                {readiness.percent === null ? (
                  <span className="text-xs text-gray-400">—</span>
                ) : (
                  <ProgressBar value={readiness.percent} />
                )}
              </td>
              <td className="px-3 py-2 text-xs tabular-nums">
                {lastInspection ? lastInspection.toLocaleDateString("ar-SA-u-nu-latn") : "لم يفحص"}
              </td>
              <td className="px-3 py-2 tabular-nums">{open}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

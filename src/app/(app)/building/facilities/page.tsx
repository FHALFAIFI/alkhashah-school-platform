import { asc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { facilityChecklist, facilityRoomLinks, rooms } from "@/db/schema";
import { PageHeader, Card, EmptyState, LinkButton } from "@/components/ui";
import { AddFacilityForm, FacilityRow, type FacilityView } from "./facilities-ui";

export const metadata = { title: "قائمة المرافق" };
export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const user = await requirePermission("building.read");
  const canWrite = user.permissions.has("building.write");

  const [facilities, links, roomRows] = await Promise.all([
    db.select().from(facilityChecklist).orderBy(asc(facilityChecklist.sortOrder), asc(facilityChecklist.createdAt)),
    db.select().from(facilityRoomLinks),
    db.select({ id: rooms.id, code: rooms.code, name: rooms.nameAr }).from(rooms).orderBy(asc(rooms.code)),
  ]);

  const roomLabel = new Map(roomRows.map((r) => [r.id, `${r.code} — ${r.name}`]));
  const linksByFacility = new Map<string, { id: string; label: string }[]>();
  for (const l of links) {
    const arr = linksByFacility.get(l.facilityId) ?? [];
    arr.push({ id: l.roomId, label: roomLabel.get(l.roomId) ?? "غرفة" });
    linksByFacility.set(l.facilityId, arr);
  }

  const views: FacilityView[] = facilities.map((f) => ({
    id: f.id,
    facilityType: f.facilityType,
    kind: f.kind,
    status: f.status,
    requiredQty: f.requiredQty,
    notes: f.notes,
    linkedRooms: linksByFacility.get(f.id) ?? [],
  }));

  const present = views.filter((v) => v.status === "موجود").length;
  const missing = views.filter((v) => v.status === "غير موجود").length;
  const roomOptions = roomRows.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }));
  const hasStandard = facilities.some((f) => f.kind === "معياري");

  return (
    <div className="space-y-5">
      <PageHeader
        title="قائمة المرافق المطلوبة"
        subtitle="سير مبسّط: حدد المرافق المطلوبة، علّم كل مرفق موجود/غير موجود/غير مطلوب، واربط الموجود بغرفة فعلية. سجّل الأصول المهمة فقط — لا كل طاولة ومقعد."
        actions={<LinkButton href="/building" variant="secondary">مخطط المبنى</LinkButton>}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="مرافق موجودة" value={present} tone="good" />
        <Stat label="مرافق ناقصة" value={missing} tone={missing > 0 ? "warn" : "good"} />
        <Stat label="إجمالي القائمة" value={views.length} />
      </div>

      {canWrite && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">إضافة مرافق</h2>
          <AddFacilityForm hasStandard={hasStandard} />
        </Card>
      )}

      {views.length === 0 ? (
        <EmptyState
          title="لا مرافق في القائمة بعد"
          hint={canWrite ? "ابدأ بإضافة القائمة المعيارية ثم علّم حالة كل مرفق" : "لم تُنشأ قائمة المرافق بعد"}
        />
      ) : (
        <Card>
          <div className="space-y-2">
            {views.map((v) => (
              <FacilityRow key={v.id} facility={v} rooms={roomOptions} canWrite={canWrite} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-brand-900";
  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

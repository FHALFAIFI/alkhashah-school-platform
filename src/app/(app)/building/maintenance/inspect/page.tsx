import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { inspectionTemplates, rooms, floors, roomTypes } from "@/db/schema";
import { PageHeader, Card, EmptyState, LinkButton } from "@/components/ui";
import { templateAppliesToRoom } from "@/lib/building/room-types";
import { orFallback } from "@/lib/format";
import { RUN_INSPECTION_CTA } from "@/lib/building/maintenance-report";
import { Tutorial } from "@/components/tutorial";
import { MaintenanceInspectionFlow } from "./inspect-ui";

export const metadata = { title: "إجراء فحص" };
export const dynamic = "force-dynamic";

/**
 * v2.4.1 §1.2: «المبنى المدرسي ← الصيانة ← إجراء فحص».
 *
 * الفحص كان يُنفَّذ من صفحة الغرفة فقط، فبدا للمدير خارج منطقة الصيانة تماماً. هذه
 * الصفحة تجعله جزءاً تشغيلياً من الصيانة دون تكرار المنطق: تختار الغرفة والقالب،
 * وتُسجّل النتائج عبر إجراء التسجيل الموحّد نفسه (`submitInspectionAction`)، ثم تعرض
 * الملاحظات فوراً وتُنشئ **بلاغاً منفصلاً لكل ملاحظة** مختارة.
 *
 * صفحة الغرفة تبقى كما هي — نقطة دخول ثانية للفحص الميداني، لا بديل مُلغى.
 */
export default async function MaintenanceInspectPage() {
  const user = await requirePermission("inspections.write");
  const canCreateIssues = user.permissions.has("maintenance.write");

  const [allRooms, allFloors, templates, registry] = await Promise.all([
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.code)),
    db.select().from(floors),
    db.select().from(inspectionTemplates).where(eq(inspectionTemplates.status, "معتمد")).orderBy(asc(inspectionTemplates.nameAr)),
    db.select().from(roomTypes),
  ]);
  const floorName = new Map(allFloors.map((f) => [f.id, f.nameAr]));

  // مطابقة القالب بنوع الغرفة عبر السجل الموحّد (D-037) — القالب العام يصلح لكل الغرف
  const roomOptions = allRooms.map((r) => ({
    id: r.id,
    label: `${r.code} — ${orFallback(r.nameAr)} (${floorName.get(r.floorId) ?? "—"})`,
    templateIds: templates.filter((t) => templateAppliesToRoom(t.roomType, r.roomType, registry)).map((t) => t.id),
  }));

  const usableRooms = roomOptions.filter((r) => r.templateIds.length > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={RUN_INSPECTION_CTA}
        subtitle="فحص موقع داخل المبنى وتحويل كل ملاحظة تحتاج صيانة إلى بلاغ صيانة مستقل"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href="/building/maintenance" variant="secondary">بلاغات الصيانة</LinkButton>
            <LinkButton href="/building/inspections" variant="secondary">الفحص والجاهزية</LinkButton>
          </div>
        }
      />

      <Tutorial
        id="maintenance-inspect"
        title="من الفحص إلى بلاغ الصيانة"
        steps={[
          "اختر الموقع وقالب الفحص المطابق لنوعه.",
          "علّم كل بند «سليم» أو «يحتاج معالجة» وأضف ملاحظته.",
          "احفظ الفحص — تظهر فوراً كل ملاحظة تحتاج صيانة.",
          "اختر الملاحظات وأنشئ لكل واحدة بلاغ صيانة منفصلاً مرتبطاً بها.",
          "افتح البلاغ واعتمده وأصدر تقريره الرسمي للطباعة أو التنزيل.",
        ]}
      />

      {templates.length === 0 ? (
        <EmptyState
          title="لا قوالب فحص معتمدة"
          hint="اعتمد قالب فحص واحداً على الأقل من «الفحص والجاهزية ← قوالب الفحص» قبل تنفيذ الفحص."
        />
      ) : usableRooms.length === 0 ? (
        <EmptyState
          title="لا مواقع مطابقة لقوالب الفحص المعتمدة"
          hint="القوالب المعتمدة محددة بأنواع غرف لا تطابق المواقع النشطة — راجع نوع الغرفة أو نوع القالب."
        />
      ) : (
        <Card>
          <MaintenanceInspectionFlow
            rooms={usableRooms}
            templates={templates.map((t) => ({ id: t.id, nameAr: t.nameAr, items: t.items }))}
            canCreateIssues={canCreateIssues}
          />
        </Card>
      )}
    </div>
  );
}

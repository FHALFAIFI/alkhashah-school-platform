import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { maintenanceIssues, people, rooms } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState, LinkButton } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback } from "@/lib/format";
import { MAINTENANCE_FIELD_UNSET, RUN_INSPECTION_CTA, VIEW_ISSUE_CTA } from "@/lib/building/maintenance-report";
import { NewIssueForm } from "./maintenance-ui";
import { Tutorial } from "@/components/tutorial";

export const metadata = { title: "بلاغات الصيانة" };
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const user = await requirePermission("maintenance.read");
  const excluded = await getExcludedIdSets();
  const [issues, allRooms, activePeople] = await Promise.all([
    db.select().from(maintenanceIssues).where(notSynthetic(maintenanceIssues.id, excluded.maintenance)).orderBy(desc(maintenanceIssues.createdAt)),
    db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.nameAr)),
    db.select().from(people).where(and(eq(people.active, true), notSynthetic(people.id, excluded.people))).orderBy(asc(people.fullName)),
  ]);
  const roomName = new Map(allRooms.map((r) => [r.id, r.nameAr]));
  const personName = new Map(activePeople.map((p) => [p.id, p.fullName]));
  const canWrite = user.permissions.has("maintenance.write");
  const canInspect = user.permissions.has("inspections.write");

  return (
    <div className="space-y-4">
      <PageHeader
        title="بلاغات الصيانة"
        subtitle="دورة حياة رسمية: مسودة ← اعتماد ← إرسال للجهة المسؤولة ← معالجة ← نتيجة (تم الإصلاح / لم يتم الإصلاح) ← إغلاق — افتح البلاغ لمتابعته وتوليد خطابه"
        actions={
          canInspect ? (
            // v2.4.1 §1.2: الفحص جزء تشغيلي من الصيانة — «المبنى ← الصيانة ← إجراء فحص»
            <LinkButton href="/building/maintenance/inspect">{RUN_INSPECTION_CTA}</LinkButton>
          ) : undefined
        }
      />
      {canInspect && (
        <Card className="border-brand-200 bg-brand-50/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-brand-900">تبدأ الصيانة من الفحص</p>
              <p className="mt-1 text-xs text-brand-800">
                نفّذ فحص الموقع من هنا؛ كل ملاحظة تحتاج صيانة تظهر فور الحفظ ويُنشأ لها
                <strong> بلاغ صيانة منفصل</strong> مرتبط بالفحص وببند الملاحظة وبموقعها.
              </p>
            </div>
            <LinkButton href="/building/maintenance/inspect">{RUN_INSPECTION_CTA}</LinkButton>
          </div>
        </Card>
      )}
      <Tutorial
        id="maintenance"
        title="دورة حياة بلاغ الصيانة"
        steps={[
          "«إجراء فحص» للموقع — كل ملاحظة تحتاج صيانة تصير بلاغاً منفصلاً.",
          "سجّل البلاغ (مسودة) بموقعه ووصفه وصوره، ثم «اعتماد البلاغ».",
          "ولّد خطاب البلاغ الرسمي وسجّل إرساله للجهة المسؤولة بتاريخه.",
          "تابع المعالجة وسجّل زيارة الصيانة والإجراء المتخذ.",
          "سجّل النتيجة: «تم الإصلاح» أو «لم يتم الإصلاح» — الثانية تتطلب سبباً وتوصية وقرار تصعيد عند الإغلاق.",
          "أغلق البلاغ — كل انتقال مسجَّل في سجل البلاغ الإلحاقي.",
        ]}
      />
      {canWrite && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">بلاغ جديد</h2>
          <NewIssueForm
            rooms={allRooms.map((r) => ({ id: r.id, label: `${orFallback(r.nameAr)} (${r.code})` }))}
            people={activePeople.map((p) => ({ id: p.id, label: orFallback(p.fullName) }))}
          />
        </Card>
      )}
      {issues.length === 0 ? (
        <EmptyState title="لا بلاغات صيانة" />
      ) : (
        <Table headers={["الرمز", "البلاغ", "المصدر", "التصنيف", "الموقع", "المكلف بالإصلاح", "الأولوية", "الحالة", "النتيجة", ""]}>
          {issues.map((i) => (
            <tr key={i.id} id={`issue-${i.code}`} className="scroll-mt-20">
              <td className="px-3 py-2 tabular-nums">
                <Link href={`/building/maintenance/${i.id}`} className="text-brand-700 hover:underline">
                  {i.code}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Link href={`/building/maintenance/${i.id}`} className="font-medium text-brand-800 hover:underline">
                  {orFallback(i.title)}
                </Link>
                {i.description && <p className="text-xs text-gray-400">{i.description}</p>}
              </td>
              {/* v2.4 §14ب: مصدر البلاغ ظاهر في القائمة — ملاحظة فحص أم بلاغ مباشر */}
              <td className="px-3 py-2 text-xs">{i.inspectionFindingId ? "ملاحظة فحص" : "بلاغ مباشر"}</td>
              {/* v2.4.1 §1.2: تصنيف الصيانة ظاهر في السجل — «غير محدد» لا «—» المجرّدة */}
              <td className="px-3 py-2 text-xs">{i.category ?? MAINTENANCE_FIELD_UNSET}</td>
              <td className="px-3 py-2 text-xs">{i.roomId ? orFallback(roomName.get(i.roomId), "—") : "—"}</td>
              <td className="px-3 py-2 text-xs">{i.ownerPersonId ? orFallback(personName.get(i.ownerPersonId), "—") : "—"}</td>
              <td className="px-3 py-2"><Badge value={i.priority} /></td>
              <td className="px-3 py-2"><Badge value={i.status} /></td>
              <td className="px-3 py-2 text-xs">{i.resolution ?? "—"}</td>
              <td className="px-3 py-2">
                <Link href={`/building/maintenance/${i.id}`} className="text-xs text-brand-700 underline">
                  {VIEW_ISSUE_CTA} ←
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

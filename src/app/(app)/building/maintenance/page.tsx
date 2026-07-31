import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { maintenanceIssues, people, rooms } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { orFallback } from "@/lib/format";
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="بلاغات الصيانة"
        subtitle="دورة حياة رسمية: مسودة ← اعتماد ← إرسال للجهة المسؤولة ← معالجة ← نتيجة (تم الإصلاح / لم يتم الإصلاح) ← إغلاق — افتح البلاغ لمتابعته وتوليد خطابه"
      />
      <Tutorial
        id="maintenance"
        title="دورة حياة بلاغ الصيانة"
        steps={[
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
        <Table headers={["الرمز", "البلاغ", "الموقع", "المكلف بالإصلاح", "الأولوية", "الحالة", "النتيجة", ""]}>
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
              <td className="px-3 py-2 text-xs">{i.roomId ? orFallback(roomName.get(i.roomId), "—") : "—"}</td>
              <td className="px-3 py-2 text-xs">{i.ownerPersonId ? orFallback(personName.get(i.ownerPersonId), "—") : "—"}</td>
              <td className="px-3 py-2"><Badge value={i.priority} /></td>
              <td className="px-3 py-2"><Badge value={i.status} /></td>
              <td className="px-3 py-2 text-xs">{i.resolution ?? "—"}</td>
              <td className="px-3 py-2">
                <Link href={`/building/maintenance/${i.id}`} className="text-xs text-brand-700 underline">
                  فتح البلاغ ←
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

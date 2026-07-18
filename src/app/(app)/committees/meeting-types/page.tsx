import { asc, inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { meetingTypes, meetings } from "@/db/schema";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { AddMeetingTypeForm, MeetingTypeRow } from "./meeting-types-ui";

export const metadata = { title: "أنواع الاجتماعات" };
export const dynamic = "force-dynamic";

export default async function MeetingTypesPage() {
  const user = await requirePermission("committees.read");
  const canManage = user.permissions.has("committees.approve");
  const types = await db.select().from(meetingTypes).orderBy(asc(meetingTypes.sortOrder));
  const typeIds = types.map((t) => t.id);
  const usedRows = typeIds.length
    ? await db.selectDistinct({ typeId: meetings.typeId }).from(meetings).where(inArray(meetings.typeId, typeIds))
    : [];
  const usedSet = new Set(usedRows.map((r) => r.typeId).filter(Boolean) as string[]);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="أنواع الاجتماعات"
        subtitle="أنواع عربية إلزامية لكل اجتماع — يديرها المدير بالإضافة والتفعيل والتعطيل. النوع المستخدم لا يُحذف نهائياً."
        actions={<LinkButton href="/committees" variant="secondary">عودة إلى اللجان</LinkButton>}
      />
      {canManage && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">إضافة نوع جديد</h2>
          <AddMeetingTypeForm />
        </Card>
      )}
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الأنواع ({types.length})</h2>
        <ul className="space-y-2">
          {types.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-100 px-3 py-2">
              <span className="font-medium">{t.nameAr}</span>
              {canManage ? (
                <MeetingTypeRow id={t.id} active={t.active} used={usedSet.has(t.id)} />
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-xs ${t.active ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-600"}`}>
                  {t.active ? "مُفعَّل" : "مُعطَّل"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

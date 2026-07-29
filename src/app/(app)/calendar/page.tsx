import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { calendars, calendarEvents } from "@/db/schema";
import { PageHeader, Table, Badge, EmptyState, Card } from "@/components/ui";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "التقويم" };
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  await requirePermission("calendar.read");
  const cals = await db.select().from(calendars).orderBy(asc(calendars.key));

  return (
    <div>
      <PageHeader
        title="التقويم الدراسي والميلادي"
        subtitle="النص الهجري الرسمي من التقويم المعتمد يعرض حرفياً — استيراد تقويم جديد لا يعيد حساب الدورات القديمة"
        actions={<SectionReportsLink category="plan" report="calendar-events" />}
      />
      {cals.length === 0 ? (
        <EmptyState title="لا تقويم بعد" />
      ) : (
        cals.map(async (cal) => {
          const events = await db
            .select()
            .from(calendarEvents)
            .where(eq(calendarEvents.calendarId, cal.id))
            .orderBy(asc(calendarEvents.sortOrder));
          return (
            <Card key={cal.id} className="mb-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-brand-900">{cal.nameAr}</h2>
                <Badge value={cal.status} />
              </div>
              <Table headers={["المناسبة", "اليوم", "من (هجري)", "إلى (هجري)", "الفترة الميلادية", "النوع"]}>
                {events.map((ev) => (
                  <tr key={ev.id} className={ev.isHoliday ? "bg-amber-50/50" : ""}>
                    <td className="px-3 py-2 font-medium">
                      {ev.nameAr}
                      {ev.anchorKey === "teacher_return" && (
                        <span className="ms-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">بداية دورة أداء المعلمين</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{ev.dayText ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{ev.hijriFrom ? `${ev.hijriFrom}هـ` : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{ev.hijriTo && ev.hijriTo !== ev.hijriFrom ? `${ev.hijriTo}هـ` : "—"}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{ev.gregorianText ?? "—"}</td>
                    <td className="px-3 py-2">{ev.isHoliday ? <Badge value="إجازة" /> : <span className="text-xs text-gray-400">يوم عمل</span>}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          );
        })
      )}
    </div>
  );
}

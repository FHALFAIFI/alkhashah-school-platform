import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committees, committeeTemplates, meetings, planYears } from "@/db/schema";
import { PageHeader, Card, Badge, LinkButton, EmptyState } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { committeeStatusLabel } from "@/lib/plan/status-labels";
import { committedEmployeeCount, faresPreviewBatchId } from "@/lib/committees/prerequisites";
import { FormCommitteeButton, NewPlcForm } from "./committees-ui";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "اللجان والفرق" };
export const dynamic = "force-dynamic";

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: "أسبوعي", monthly: "شهري", term: "فصلي", on_demand: "عند الحاجة", none: "بدون تكرار",
};
const RECURRENCE_DAYS: Record<string, number> = { weekly: 7, monthly: 30, term: 90 };

export default async function CommitteesPage() {
  const user = await requirePermission("committees.read");
  const excluded = await getExcludedIdSets();
  const [templates, all, allMeetings, years, employeeCount, faresBatchId] = await Promise.all([
    db.select().from(committeeTemplates).orderBy(asc(committeeTemplates.createdAt)),
    db.select().from(committees).where(notSynthetic(committees.id, excluded.committees)).orderBy(desc(committees.createdAt)),
    db.select().from(meetings).where(notSynthetic(meetings.id, excluded.meetings)),
    db.select().from(planYears),
    committedEmployeeCount(),
    faresPreviewBatchId(),
  ]);
  const yearName = new Map(years.map((y) => [y.id, y.nameAr]));
  const canWrite = user.permissions.has("committees.write");
  // متطلَّب سابق: تشكيل اللجان يعتمد على بيانات المنسوبين المعتمدة — بلا منسوبين لا تشكيل
  const employeesReady = employeeCount > 0;

  const meetingsByCommittee = new Map<string, typeof allMeetings>();
  for (const m of allMeetings) {
    const arr = meetingsByCommittee.get(m.committeeId) ?? [];
    arr.push(m);
    meetingsByCommittee.set(m.committeeId, arr);
  }

  const formedTemplateIds = new Set(all.filter((c) => c.status !== "مقفلة").map((c) => c.templateId));
  const unformed = templates.filter((t) => !formedTemplateIds.has(t.id) && t.active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="اللجان والمجالس ومجتمعات التعلم"
        subtitle="تشكل اللجان سنوياً من القوالب دون نسخ عضويات الأعوام السابقة — الأعضاء من منسوبي المدرسة حصراً"
        actions={
          <div className="flex flex-wrap gap-2">
            <SectionReportsLink category="committees" />
            <LinkButton href="/committees/templates" variant="secondary">عرض القوالب</LinkButton>
            <LinkButton href="/committees/task-templates" variant="secondary">قوالب المهام</LinkButton>
            <LinkButton href="/committees/meeting-types" variant="secondary">أنواع الاجتماعات</LinkButton>
          </div>
        }
      />

      {!employeesReady && (
        <Card className="border-amber-300 bg-amber-50">
          <h2 className="mb-1 font-bold text-amber-900">متطلَّب سابق: بيانات منسوبي المدرسة</h2>
          <p className="text-sm text-amber-800">
            تشكيل اللجان يعتمد على بيانات المنسوبين المعتمدة — أعضاء اللجان من منسوبي المدرسة المعتمدين حصراً.
            لا يوجد منسوبون معتمدون بعد؛ اعتمد دفعة فارس من المعاينة أولاً ثم عد لتشكيل اللجان.
          </p>
          <div className="mt-3">
            {faresBatchId ? (
              <LinkButton href={`/imports/${faresBatchId}`}>فتح معاينة دفعة فارس</LinkButton>
            ) : (
              <LinkButton href="/imports" variant="secondary">فتح الاستيراد</LinkButton>
            )}
          </div>
        </Card>
      )}

      {canWrite && employeesReady && unformed.length > 0 && (
        <Card className="border-brand-200 bg-brand-50/50">
          <h2 className="mb-2 font-bold text-brand-900">قوالب لم تشكل لهذه السنة</h2>
          <div className="flex flex-wrap gap-2">
            {unformed.map((t) => (
              <FormCommitteeButton key={t.id} templateId={t.id} name={t.nameAr} />
            ))}
          </div>
        </Card>
      )}

      {all.length === 0 ? (
        <EmptyState
          title="لا تشكيلات بعد"
          hint={employeesReady ? "شكل اللجان من القوالب أعلاه — الأعضاء من منسوبي المدرسة المعتمدين" : "اعتمد بيانات منسوبي المدرسة (دفعة فارس) أولاً ثم شكل اللجان من القوالب"}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {all.map((c) => {
            const ms = meetingsByCommittee.get(c.id) ?? [];
            const completed = ms.filter((m) => m.status === "مكتمل").length;
            const lastMeeting = ms
              .filter((m) => m.meetingDate)
              .sort((a, b) => b.meetingDate!.getTime() - a.meetingDate!.getTime())[0];
            const dueDays = RECURRENCE_DAYS[c.recurrence];
            // مكون خادم — قراءة الوقت الحالي هنا آمنة
            // eslint-disable-next-line react-hooks/purity
            const nowMs = Date.now();
            const isDue =
              c.status === "معتمدة" &&
              dueDays !== undefined &&
              (!lastMeeting || nowMs - lastMeeting.meetingDate!.getTime() > dueDays * 24 * 3600 * 1000);
            const nextAction =
              c.status === "مسودة"
                ? "بانتظار الاعتماد — أكمل التشكيل واعتمده"
                : c.status === "مقفلة"
                  ? "مقفلة — للاطلاع فقط"
                  : isDue
                    ? "اجتماع مستحق — اعقد الاجتماع التالي"
                    : "معتمدة — تابع الاجتماعات وتوثيقها";
            return (
              <Link key={c.id} href={`/committees/${c.id}`}>
                <Card className="h-full transition hover:border-brand-300">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-bold text-brand-900">{c.nameAr}</h2>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {yearName.get(c.planYearId)} · {RECURRENCE_LABELS[c.recurrence] ?? c.recurrence} · اجتماعات مكتملة: {completed}/{ms.length}
                      </p>
                      <p className={`mt-1 text-xs font-medium ${c.status === "مقفلة" ? "text-gray-500" : isDue || c.status === "مسودة" ? "text-amber-700" : "text-emerald-700"}`}>
                        {nextAction}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge value={committeeStatusLabel(c.status)} />
                      <Badge value={c.kind} />
                      {isDue && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">اجتماع مستحق</span>}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {canWrite && employeesReady && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">مجتمع تعلم مهني جديد</h2>
          <NewPlcForm />
        </Card>
      )}
    </div>
  );
}

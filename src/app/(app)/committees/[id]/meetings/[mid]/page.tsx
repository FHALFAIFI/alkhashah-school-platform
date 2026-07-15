import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committees, committeeMembers, meetings, meetingOutcomes, people, documents, actionTasks } from "@/db/schema";
import { PageHeader, Card, Badge, Table } from "@/components/ui";
import { MeetingEditForm, OutcomeForm, SignedMinutesUpload, CompleteMeetingButton } from "./meeting-ui";
import { generateMinutesDocument } from "@/lib/reports/minutes-report";
import { SubmitButton } from "@/components/ui";
import { aiEnabled } from "@/lib/ai/provider";
import { AiMeetingAssistant } from "@/components/integrations-ui";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await requirePermission("committees.read");
  const { id, mid } = await params;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, mid));
  if (!meeting || meeting.committeeId !== id) notFound();
  const [committee] = await db.select().from(committees).where(eq(committees.id, id));

  const [outcomes, members, minutesDoc] = await Promise.all([
    db.select().from(meetingOutcomes).where(eq(meetingOutcomes.meetingId, mid)).orderBy(asc(meetingOutcomes.sortOrder)),
    db
      .select({ m: committeeMembers, name: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, id)),
    meeting.minutesDocId ? db.select().from(documents).where(eq(documents.id, meeting.minutesDocId)) : Promise.resolve([]),
  ]);

  const taskIds = outcomes.map((o) => o.taskId).filter(Boolean) as string[];
  const tasks = taskIds.length > 0 ? await db.select().from(actionTasks) : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const canWrite = user.permissions.has("committees.write") && meeting.status !== "مكتمل";
  const canApprove = user.permissions.has("committees.approve");
  const chair = members.find((x) => x.m.role === "رئيس" || x.m.role === "قائد");
  const secretary = members.find((x) => x.m.role === "مقرر");

  async function issueMinutes() {
    "use server";
    const u = await requirePermission("reports.generate");
    await generateMinutesDocument({ meetingId: mid, issuedBy: u.id });
    revalidatePath(`/committees/${id}/meetings/${mid}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${meeting.title ?? `الاجتماع ${meeting.seq}`}`}
        subtitle={committee.nameAr}
        actions={<Badge value={meeting.status} />}
      />

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">بيانات الاجتماع وجدول الأعمال والمناقشات</h2>
        {canWrite ? (
          <MeetingEditForm
            meetingId={mid}
            defaults={{
              title: meeting.title ?? "",
              meetingDate: meeting.meetingDate?.toISOString().slice(0, 10) ?? "",
              location: meeting.location ?? "",
              agenda: (meeting.agenda ?? []).join("\n"),
              discussion: meeting.discussion ?? "",
            }}
          />
        ) : (
          <div className="space-y-2 text-sm">
            <p><span className="text-gray-500">جدول الأعمال:</span></p>
            <ol className="list-inside list-decimal">{(meeting.agenda ?? []).map((a, i) => <li key={i}>{a}</li>)}</ol>
            {meeting.discussion && <p className="whitespace-pre-wrap"><span className="text-gray-500">المناقشات:</span> {meeting.discussion}</p>}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">النتائج: قرارات وتوصيات وملاحظات ({outcomes.length})</h2>
        {outcomes.length > 0 && (
          <Table headers={["النوع", "النص", "الإجراء المرتبط"]}>
            {outcomes.map((o) => {
              const task = o.taskId ? taskById.get(o.taskId) : null;
              return (
                <tr key={o.id}>
                  <td className="px-3 py-2"><Badge value={o.outcomeType === "قرار" ? "عالية" : o.outcomeType === "توصية" ? "متوسطة" : "منخفضة"} /> <span className="text-xs">{o.outcomeType}</span></td>
                  <td className="px-3 py-2">{o.text}</td>
                  <td className="px-3 py-2 text-xs">
                    {task ? (
                      <span>
                        {task.mandatory && <span className="me-1 rounded bg-red-50 px-1.5 py-0.5 text-red-700">إلزامي</span>}
                        <Badge value={task.status} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {canWrite && (
          <OutcomeForm meetingId={mid} people={members.map((x) => ({ id: x.m.personId, fullName: x.name }))} />
        )}
        <p className="mt-2 text-xs text-gray-400">القرار ينشئ إجراءً إلزامياً تلقائياً؛ التوصية قد تنشئ إجراءً اختيارياً.</p>
      </Card>

      {aiEnabled() && canWrite && <AiMeetingAssistant meetingId={mid} />}

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">المحضر والتوقيع والاكتمال</h2>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <form action={issueMinutes}>
              <SubmitButton variant="secondary">إصدار المحضر الرسمي (PDF)</SubmitButton>
            </form>
            {minutesDoc[0]?.pdfFileId && (
              <a href={`/api/files/${minutesDoc[0].pdfFileId}`} className="text-brand-700 underline">
                تنزيل المحضر {minutesDoc[0].docNumber}
              </a>
            )}
          </div>
          <p className="text-xs text-gray-500">
            يوقع المحضر يدوياً من {chair ? `الرئيس (${chair.name})` : "الرئيس"} و{secretary ? `المقرر (${secretary.name})` : "المقرر"} فقط، ثم يرفع هنا.
          </p>
          {meeting.signedMinutesFileId ? (
            <p className="text-emerald-700">
              ✓ المحضر الموقع مرفوع — <a href={`/api/files/${meeting.signedMinutesFileId}`} className="underline">تنزيل</a>
            </p>
          ) : (
            <p className="text-amber-700">لم يرفع المحضر الموقع بعد — لا يكتمل الاجتماع بدونه</p>
          )}
          {canWrite && <SignedMinutesUpload meetingId={mid} />}
          {meeting.status !== "مكتمل" && canApprove && (
            <CompleteMeetingButton meetingId={mid} disabled={!meeting.signedMinutesFileId} />
          )}
          {meeting.status === "مكتمل" && (
            <p className="font-medium text-emerald-700">اكتمل الاجتماع واعتمد.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

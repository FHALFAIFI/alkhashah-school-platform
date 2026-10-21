import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committees, committeeMembers, meetings, meetingOutcomes, people, documents, actionTasks, meetingTypes, meetingAttachments, storedFiles } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton, WorkflowSteps } from "@/components/ui";
import { MeetingEditForm, OutcomeForm, SignedMinutesUpload, CompleteMeetingButton, MeetingAttachmentForm, DeleteAttachmentButton } from "./meeting-ui";
import { generateMinutesDocument } from "@/lib/reports/minutes-report";
import { SubmitButton } from "@/components/ui";
import { orFallback, orDash } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; mid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission("committees.read");
  const { id, mid } = await params;
  const issuedParam = (await searchParams).issued;
  const issuedNumber = typeof issuedParam === "string" ? issuedParam : null;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, mid));
  if (!meeting || meeting.committeeId !== id) notFound();
  const [committee] = await db.select().from(committees).where(eq(committees.id, id));

  const [outcomes, members, minutesDoc, types, attachments] = await Promise.all([
    db.select().from(meetingOutcomes).where(eq(meetingOutcomes.meetingId, mid)).orderBy(asc(meetingOutcomes.sortOrder)),
    db
      .select({ m: committeeMembers, name: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, id)),
    meeting.minutesDocId ? db.select().from(documents).where(eq(documents.id, meeting.minutesDocId)) : Promise.resolve([]),
    db.select().from(meetingTypes).orderBy(asc(meetingTypes.sortOrder)),
    db
      .select({ a: meetingAttachments, name: storedFiles.originalName })
      .from(meetingAttachments)
      .leftJoin(storedFiles, eq(meetingAttachments.fileId, storedFiles.id))
      .where(eq(meetingAttachments.meetingId, mid))
      .orderBy(asc(meetingAttachments.createdAt)),
  ]);
  const activeTypes = types.filter((t) => t.active).map((t) => ({ id: t.id, nameAr: t.nameAr }));
  const typeName = meeting.typeId ? (types.find((t) => t.id === meeting.typeId)?.nameAr ?? null) : null;
  // التوقيع حسب نوع الاجتماع (D-027): لا قاعدة عامة تفرض التوقيع
  const typeRequiresSignature = meeting.typeId ? (types.find((t) => t.id === meeting.typeId)?.requiresSignature ?? false) : false;

  const taskIds = outcomes.map((o) => o.taskId).filter(Boolean) as string[];
  const tasks = taskIds.length > 0 ? await db.select().from(actionTasks).where(inArray(actionTasks.id, taskIds)) : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const canWrite = user.permissions.has("committees.write") && meeting.status !== "مكتمل";
  const canApprove = user.permissions.has("committees.approve");
  const chair = members.find((x) => x.m.role === "رئيس" || x.m.role === "قائد");
  const secretary = members.find((x) => x.m.role === "مقرر");

  async function issueMinutes() {
    "use server";
    const u = await requirePermission("reports.generate");
    const { docNumber } = await generateMinutesDocument({ meetingId: mid, issuedBy: u.id });
    /*
     * D-053 قاعدة 4 مُقيَّدة بـ D-065: التحويل يعيد التصيير فقط إن اختلف العنوان بأكثر من الوسم.
     *
     * كان الإجراء ينتهي بلا شيء، فتصدر الوثيقة المرقّمة ولا يظهر رابط تنزيلها ولا تتقدم مراحل
     * الاجتماع — فيُعيد المدير الإصدار وتتكرر وثيقة رسمية. ثم صار ينتهي بتحويل إلى المسار نفسه
     * بوسم `#minutes` وحده، وهذا انتقال وسم عند الموجّه: يمرّر الصفحة ولا يطلب تصييراً جديداً،
     * فبقيت الشاشة كما هي حرفياً. رقم الوثيقة الصادرة يجعل العنوان مختلفاً فعلاً، فيُطلب تصيير
     * جديد من الخادم، ويصير الرقم بذاته إثبات النتيجة على الشاشة.
     */
    redirect(`/committees/${id}/meetings/${mid}?issued=${encodeURIComponent(docNumber)}#minutes`);
  }

  // مؤشر المرحلة: الإعداد والنتائج → إصدار المحضر → المحضر الموقع → الاكتمال
  const stage =
    meeting.status === "مكتمل"
      ? 4
      : meeting.signedMinutesFileId
        ? 3
        : meeting.minutesDocId
          ? 2
          : outcomes.length > 0
            ? 1
            : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={orFallback(meeting.title, `الاجتماع ${meeting.seq}`)}
        subtitle={orFallback(committee.nameAr)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {typeName && <Badge value={typeName} />}
            <Badge value={meeting.status} />
          </div>
        }
      />

      <Card>
        <WorkflowSteps steps={["الإعداد والنتائج", "إصدار المحضر", "المحضر الموقع", "الاكتمال"]} current={stage} />
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-sand-100 pt-3">
          {stage === 0 && (
            <p className="text-sm font-medium text-brand-900">الخطوة التالية: سجل بيانات الاجتماع ونتائجه (قرارات وتوصيات وملاحظات)</p>
          )}
          {stage === 1 && (
            <>
              <p className="text-sm font-medium text-brand-900">الخطوة التالية: إصدار المحضر الرسمي (PDF)</p>
              <LinkButton href="#minutes" variant="secondary">إلى المحضر</LinkButton>
            </>
          )}
          {stage === 2 && (
            <>
              <p className="text-sm font-medium text-brand-900">الخطوة التالية: ارفع المحضر الموقع من الرئيس والمقرر</p>
              <LinkButton href="#minutes" variant="secondary">إلى الرفع</LinkButton>
            </>
          )}
          {stage === 3 && (
            <>
              <p className="text-sm font-medium text-brand-900">الخطوة التالية: أكمل الاجتماع</p>
              {canApprove ? <CompleteMeetingButton meetingId={mid} disabled={false} /> : <p className="text-xs text-gray-500">يعتمد الاكتمال المدير</p>}
            </>
          )}
          {stage === 4 && <p className="text-sm text-emerald-700">اكتمل الاجتماع واعتمد — السجل للاطلاع فقط.</p>}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">بيانات الاجتماع وجدول الأعمال والمناقشات</h2>
        {canWrite ? (
          <MeetingEditForm
            meetingId={mid}
            types={activeTypes}
            currentTypeId={meeting.typeId}
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
                  <td className="px-3 py-2">{orDash(o.text)}</td>
                  <td className="px-3 py-2 text-xs">
                    {task ? (
                      <Link prefetch={false} href={`/tasks#task-${task.id}`} className="inline-flex items-center gap-1 hover:underline" title="فتح الإجراء في قائمة المهام">
                        {task.mandatory && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">إلزامي</span>}
                        <Badge value={task.status} />
                      </Link>
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

      <Card>
        <h2 className="mb-1 font-bold text-brand-900">مرفقات الاجتماع ({attachments.length})</h2>
        <p className="mb-3 text-xs text-gray-400">مرفقات خاصة: مادة جدول الأعمال والمستندات الداعمة والمراسلات الخارجية وغيرها — لا علاقة لها بالحضور.</p>
        {attachments.length > 0 && (
          <Table headers={["العنوان", "الفئة", "الوصف", "تاريخ الرفع", "الملف", ""]}>
            {attachments.map(({ a, name }) => (
              <tr key={a.id}>
                <td className="px-3 py-2 font-medium">{orFallback(a.title)}</td>
                <td className="px-3 py-2">{a.category ? <Badge value={a.category} /> : <span className="text-xs text-gray-400">—</span>}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{orDash(a.description)}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{a.createdAt.toLocaleDateString("ar-SA-u-nu-latn")}</td>
                <td className="px-3 py-2"><a href={`/api/files/${a.fileId}`} className="text-xs text-brand-700 underline">{name ?? "تنزيل"}</a></td>
                <td className="px-3 py-2">{canWrite && <DeleteAttachmentButton attachmentId={a.id} />}</td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite && <MeetingAttachmentForm meetingId={mid} />}
      </Card>

      <div id="minutes" className="scroll-mt-20">
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">المحضر والتوقيع والاكتمال</h2>
        <div className="space-y-3 text-sm">
          {/*
            * تأكيد الإصدار يُقرأ من الوثيقة المحفوظة لا من العنوان: رقم في العنوان لا يقابل محضر
            * هذا الاجتماع لا يُعرض إطلاقاً، فلا يمكن لرابط ملفّق أن يدّعي إصداراً لم يحدث.
            */}
          {issuedNumber && minutesDoc[0]?.docNumber === issuedNumber && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 font-medium text-emerald-800">
              صدر المحضر الرسمي رقم {issuedNumber}
            </p>
          )}
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
            {typeRequiresSignature
              ? `نوع هذا الاجتماع «${typeName ?? ""}» مُهيّأ ليتطلب محضراً موقعاً لاكتماله — يوقّعه ${chair ? `الرئيس (${chair.name})` : "الرئيس"} و${secretary ? `المقرر (${secretary.name})` : "المقرر"} يدوياً ثم يُرفع هنا.`
              : `نوع هذا الاجتماع «${typeName ?? "غير محدد"}» لا يتطلب توقيعاً لاكتماله (D-027). يمكن رفع محضر موقّع اختيارياً عند الحاجة.`}
          </p>
          {meeting.signedMinutesFileId ? (
            <p className="text-emerald-700">
              ✓ المحضر الموقع مرفوع — <a href={`/api/files/${meeting.signedMinutesFileId}`} className="underline">تنزيل</a>
            </p>
          ) : typeRequiresSignature ? (
            <p className="text-amber-700">لم يرفع المحضر الموقع بعد — لا يكتمل الاجتماع بدونه</p>
          ) : (
            <p className="text-gray-500">لا يشترط هذا النوع رفع محضر موقّع للاكتمال.</p>
          )}
          {canWrite && <SignedMinutesUpload meetingId={mid} />}
          {meeting.status !== "مكتمل" && canApprove && (
            <CompleteMeetingButton meetingId={mid} disabled={typeRequiresSignature && !meeting.signedMinutesFileId} />
          )}
          {meeting.status === "مكتمل" && (
            <p className="font-medium text-emerald-700">اكتمل الاجتماع واعتمد.</p>
          )}
        </div>
      </Card>
      </div>
    </div>
  );
}

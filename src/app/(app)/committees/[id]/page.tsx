import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committees, committeeMembers, committeeTaskAssignments, meetings, people, planYears, meetingTypes } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton, WorkflowSteps } from "@/components/ui";
import { AddMemberForm, ApproveCommitteeButton, ReopenCommitteeForm, NewMeetingForm, CloseCommitteeButton, RemoveMemberButton, AssignmentFormCard } from "./committee-ui";
import { TaskDistribution } from "./task-distribution-ui";
import { documents } from "@/db/schema";
import { committeeStatusLabel } from "@/lib/plan/status-labels";
import { getExcludedIdSets, filterOutSynthetic } from "@/lib/synthetic";
import { dualDisplay } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CommitteePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("committees.read");
  const { id } = await params;
  const [c] = await db.select().from(committees).where(eq(committees.id, id));
  if (!c) notFound();

  const [members, ms, persons, [year], activeTypes] = await Promise.all([
    db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, id)).orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(meetings).where(eq(meetings.committeeId, id)).orderBy(asc(meetings.seq)),
    db.select().from(people).where(eq(people.active, true)).orderBy(asc(people.fullName)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
    db.select({ id: meetingTypes.id, nameAr: meetingTypes.nameAr }).from(meetingTypes).where(eq(meetingTypes.active, true)).orderBy(asc(meetingTypes.sortOrder)),
  ]);
  const personName = new Map(persons.map((p) => [p.id, p.fullName]));
  // منتقي الأعضاء يعرض المنسوبين المعتمدين فقط (يستبعد الاصطناعي/المؤرشف) — الخريطة الاسمية تبقى كاملة
  const excluded = await getExcludedIdSets();
  const selectablePeople = filterOutSynthetic(persons, excluded.people);
  const canWrite = user.permissions.has("committees.write") && c.status !== "مقفلة";
  const canApprove = user.permissions.has("committees.approve");

  // ملف PDF لنموذج التكليف المولّد (إن وُجد)
  let assignmentPdfFileId: string | null = null;
  if (c.assignmentDocId) {
    const [doc] = await db.select({ pdf: documents.pdfFileId }).from(documents).where(eq(documents.id, c.assignmentDocId));
    assignmentPdfFileId = doc?.pdf ?? null;
  }

  // توزيع مهام اللجنة (D-027)
  const taskAssignments = c.status !== "مسودة"
    ? await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.committeeId, id)).orderBy(asc(committeeTaskAssignments.sortOrder))
    : [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  const taskList = taskAssignments.map((t) => {
    const mem = t.assignedMemberId ? memberById.get(t.assignedMemberId) : undefined;
    return {
      id: t.id,
      title: t.title,
      notes: t.notes,
      excluded: t.excluded,
      assignedMemberId: t.assignedMemberId,
      memberName: mem ? personName.get(mem.personId) ?? null : null,
      memberRole: mem?.role ?? null,
    };
  });
  const activeMembers = members
    .filter((m) => !m.effectiveTo)
    .map((m) => ({ id: m.id, name: personName.get(m.personId) ?? "—", role: m.role }));

  // مؤشر المرحلة: التشكيل → الاعتماد → الاجتماعات → الإقفال
  const formationComplete =
    c.kind === "مجتمع تعلم"
      ? members.length > 0
      : members.some((m) => m.role === "رئيس") && members.some((m) => m.role === "مقرر");
  const stage =
    c.status === "مقفلة" ? 4 : c.status === "معتمدة" ? 2 : formationComplete ? 1 : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={orFallback(c.nameAr)}
        subtitle={`${c.kind} — ${year?.nameAr ?? ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={committeeStatusLabel(c.status)} />
            <LinkButton href={`/committees/${id}/report`} variant="secondary">تقرير اللجنة</LinkButton>
            {canApprove && c.status !== "مقفلة" && <CloseCommitteeButton committeeId={id} />}
          </div>
        }
      />

      <Card>
        <WorkflowSteps steps={["التشكيل", "الاعتماد", "الاجتماعات", "الإقفال"]} current={stage} />
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-sand-100 pt-3">
          {c.status === "مسودة" && !formationComplete && (
            <p className="text-sm font-medium text-amber-700">
              الخطوة التالية: {c.kind === "مجتمع تعلم" ? "أضف قائد المجتمع وأعضاءه ثم اعتمد التشكيل" : "أضف الرئيس والمقرر ثم اعتمد التشكيل"}
            </p>
          )}
          {c.status === "مسودة" && formationComplete && (
            <>
              <p className="text-sm font-medium text-brand-900">الخطوة التالية: اعتماد التشكيل</p>
              {canApprove && <ApproveCommitteeButton committeeId={id} />}
            </>
          )}
          {c.status === "معتمدة" && (
            <>
              <p className="text-sm font-medium text-brand-900">الخطوة التالية: توليد نموذج التكليف وتوقيعه، ثم عقد الاجتماعات وتوثيقها</p>
              {canWrite && <LinkButton href="#meetings">اجتماع جديد</LinkButton>}
            </>
          )}
          {c.status === "مقفلة" && (
            <p className="text-sm text-gray-500">اللجنة مقفلة ومؤرشفة — السجل للاطلاع فقط ولا تعديل عليه.</p>
          )}
        </div>
      </Card>

      {c.status !== "مسودة" && (
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">توزيع المهام</h2>
          <p className="mb-3 text-xs text-gray-500">
            حمّل المهام المعرّفة مسبقاً لنوع اللجنة (قيمٌ ابتدائية قابلة للتعديل، ليست معتمدة رسمياً)، راجعها
            وعدّلها واستبعد ما لا يلزم ورتّبها وأسندها للأعضاء، ثم ولّد نموذج التكليف (قائمتا الأعضاء والمهام).
            مهام اللجان قائمة ومنفصلة تماماً عن أنشطة البرامج التشغيلية.
          </p>
          <TaskDistribution
            committeeId={id}
            tasks={taskList}
            members={activeMembers}
            hasTemplate={!!c.templateId}
            canWrite={canWrite}
          />
        </Card>
      )}

      {c.status !== "مسودة" && (
        <Card>
          <h2 className="mb-2 font-bold text-brand-900">نموذج التكليف (للطباعة والتوقيع)</h2>
          <p className="mb-3 text-xs text-gray-500">
            يُولَّد نموذج التكليف كوثيقة رسمية بقائمتين مستقلتين: «أعضاء اللجنة» (بعمود «التوقيع» الورقي)
            و«مهام اللجنة». يُحفظ كلقطة تاريخية ثابتة — لا يتغيّر بتعديل القوالب لاحقاً. رفع الأصل الموقّع اختياري.
          </p>
          <AssignmentFormCard
            committeeId={id}
            assignmentPdfFileId={assignmentPdfFileId}
            signedAssignmentFileId={c.signedAssignmentFileId}
            canManage={canApprove}
          />
        </Card>
      )}

      {c.goal && (
        <Card>
          <h2 className="mb-1 text-sm font-bold text-gray-600">الهدف</h2>
          <p className="text-sm text-gray-800">{c.goal}</p>
        </Card>
      )}
      {c.kind === "مجتمع تعلم" && (c.objectives || c.outputs) && (
        <Card>
          {c.objectives && (<><h2 className="mb-1 text-sm font-bold text-gray-600">الأهداف</h2><p className="mb-2 text-sm">{c.objectives}</p></>)}
          {c.outputs && (<><h2 className="mb-1 text-sm font-bold text-gray-600">المخرجات</h2><p className="text-sm">{c.outputs}</p></>)}
        </Card>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">الأعضاء ({members.length})</h2>
          {c.status === "مسودة" && canApprove && <ApproveCommitteeButton committeeId={id} />}
          {c.status === "معتمدة" && canApprove && <ReopenCommitteeForm committeeId={id} />}
        </div>
        <p className="mb-3 text-xs text-gray-400">
          تسجل العضوية عند التشكيل فقط — لا حضور ولا غياب ولا نصاب. المحضر يوقعه الرئيس والمقرر فقط.
        </p>
        {members.length > 0 && (
          <Table headers={["الاسم", "الصفة", "العمل في اللجنة", ""]}>
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 font-medium">{orFallback(personName.get(m.personId))}</td>
                <td className="px-3 py-2 text-xs">{orDash(m.position)}</td>
                <td className="px-3 py-2"><Badge value={m.role === "رئيس" || m.role === "مقرر" ? "معتمد" : "جديدة"} /> <span className="text-xs">{orDash(m.role)}</span></td>
                <td className="px-3 py-2">
                  {canWrite && c.status === "مسودة" && <RemoveMemberButton memberId={m.id} />}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {canWrite && c.status === "مسودة" && (
          <AddMemberForm
            committeeId={id}
            people={selectablePeople.map((p) => ({ id: p.id, fullName: p.fullName, jobTitle: p.jobTitle }))}
            isPlc={c.kind === "مجتمع تعلم"}
          />
        )}
      </Card>

      <div id="meetings" className="scroll-mt-20">
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-brand-900">الاجتماعات ({ms.length})</h2>
        </div>
        {ms.length > 0 && (
          <Table headers={["#", "العنوان", "التاريخ", "الحالة", ""]}>
            {ms.map((m) => {
              const d = m.meetingDate ? dualDisplay(m.meetingDate.toISOString().slice(0, 10), "teacher") : null;
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2 tabular-nums">{m.seq}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/committees/${id}/meetings/${m.id}`} className="text-brand-700 hover:underline">
                      {orFallback(m.title, `الاجتماع ${m.seq}`)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">{d?.primary ?? "—"}</td>
                  <td className="px-3 py-2"><Badge value={m.status} /></td>
                  <td className="px-3 py-2">
                    <LinkButton href={`/committees/${id}/meetings/${m.id}`} variant="secondary">فتح</LinkButton>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        {canWrite && c.status === "معتمدة" && <NewMeetingForm committeeId={id} types={activeTypes} />}
        {c.status === "مسودة" && <p className="text-sm text-amber-600">اعتمد التشكيل أولاً لعقد الاجتماعات</p>}
      </Card>
      </div>
    </div>
  );
}

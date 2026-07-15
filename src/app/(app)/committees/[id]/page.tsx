import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committees, committeeMembers, meetings, people, planYears } from "@/db/schema";
import { PageHeader, Card, Badge, Table, LinkButton } from "@/components/ui";
import { AddMemberForm, ApproveCommitteeButton, ReopenCommitteeForm, NewMeetingForm, CloseCommitteeButton, RemoveMemberButton } from "./committee-ui";
import { dualDisplay } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function CommitteePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("committees.read");
  const { id } = await params;
  const [c] = await db.select().from(committees).where(eq(committees.id, id));
  if (!c) notFound();

  const [members, ms, persons, [year]] = await Promise.all([
    db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, id)).orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(meetings).where(eq(meetings.committeeId, id)).orderBy(asc(meetings.seq)),
    db.select().from(people).where(eq(people.active, true)).orderBy(asc(people.fullName)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
  ]);
  const personName = new Map(persons.map((p) => [p.id, p.fullName]));
  const canWrite = user.permissions.has("committees.write") && c.status !== "مقفلة";
  const canApprove = user.permissions.has("committees.approve");

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.nameAr}
        subtitle={`${c.kind} — ${year?.nameAr ?? ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge value={c.status} />
            {canApprove && c.status !== "مقفلة" && <CloseCommitteeButton committeeId={id} />}
          </div>
        }
      />

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
        <div className="mb-3 flex items-center justify-between">
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
                <td className="px-3 py-2 font-medium">{personName.get(m.personId) ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{m.position ?? "—"}</td>
                <td className="px-3 py-2"><Badge value={m.role === "رئيس" || m.role === "مقرر" ? "معتمد" : "جديدة"} /> <span className="text-xs">{m.role}</span></td>
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
            people={persons.map((p) => ({ id: p.id, fullName: p.fullName, jobTitle: p.jobTitle }))}
            isPlc={c.kind === "مجتمع تعلم"}
          />
        )}
      </Card>

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
                      {m.title}
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
        {canWrite && c.status === "معتمدة" && <NewMeetingForm committeeId={id} />}
        {c.status === "مسودة" && <p className="text-sm text-amber-600">اعتمد التشكيل أولاً لعقد الاجتماعات</p>}
      </Card>
    </div>
  );
}

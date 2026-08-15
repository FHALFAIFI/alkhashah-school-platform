import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { committees, committeeMembers, meetings, meetingOutcomes, actionTasks, people, planYears, meetingTypes, meetingAttachments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { buildWordReport } from "@/lib/reports/word-export";
import { getWordHeader } from "@/lib/document-header";
import { audit } from "@/lib/audit";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";

/** تصدير تقرير اللجنة بصيغة Word قابلة للتحرير — لا حضور ولا غياب ولا نصاب */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.generate")) return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });

  const [c] = await db.select().from(committees).where(eq(committees.id, id));
  if (!c) return NextResponse.json({ error: "اللجنة غير موجودة" }, { status: 404 });
  const [members, ms, [year]] = await Promise.all([
    db
      .select({ role: committeeMembers.role, position: committeeMembers.position, name: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, id))
      .orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(meetings).where(eq(meetings.committeeId, id)).orderBy(asc(meetings.seq)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
  ]);
  const meetingIds = ms.map((m) => m.id);
  const outcomes = meetingIds.length
    ? await db.select().from(meetingOutcomes).where(inArray(meetingOutcomes.meetingId, meetingIds)).orderBy(asc(meetingOutcomes.sortOrder))
    : [];
  const attachments = meetingIds.length
    ? await db.select().from(meetingAttachments).where(inArray(meetingAttachments.meetingId, meetingIds)).orderBy(asc(meetingAttachments.createdAt))
    : [];
  const allTypes = await db.select().from(meetingTypes);
  const typeName = new Map(allTypes.map((t) => [t.id, t.nameAr]));
  const taskIds = outcomes.map((o) => o.taskId).filter(Boolean) as string[];
  const tasks = taskIds.length ? await db.select().from(actionTasks).where(inArray(actionTasks.id, taskIds)) : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const seqByMeeting = new Map(ms.map((m) => [m.id, m.seq]));

  const now = new Date();
  const buf = await buildWordReport({
    // v2.4 §15: الهوية الرسمية المركزية بدل السطر الثابت الاحتياطي
    header: await getWordHeader(),
    issuedAtText: `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`,
    title: `تقرير اللجنة: ${orFallback(c.nameAr)}`,
    meta: [
      ["تاريخ الإصدار", `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`],
      ["النوع", c.kind],
      ["السنة", year?.nameAr ?? "—"],
      ["الحالة", c.status],
    ],
    sections: [
      {
        heading: "الأعضاء (تسجيل التشكيل — لا حضور ولا غياب)",
        table: { headers: ["الاسم", "الصفة", "العمل في اللجنة"], rows: members.map((m) => [orFallback(m.name), orDash(m.position), orDash(m.role)]) },
      },
      {
        heading: "الاجتماعات",
        table: {
          headers: ["م", "العنوان", "النوع", "التاريخ", "الحالة"],
          rows: ms.map((m) => [
            String(m.seq),
            orFallback(m.title, `الاجتماع ${m.seq}`),
            m.typeId ? typeName.get(m.typeId) ?? "—" : "—",
            m.meetingDate ? `${toHijriNumeric(m.meetingDate)}هـ` : "—",
            m.status,
          ]),
        },
      },
      {
        heading: "النتائج (قرارات وتوصيات وملاحظات)",
        table: {
          headers: ["الاجتماع", "النوع", "النص", "الإجراء"],
          rows: outcomes.map((o) => {
            const t = o.taskId ? taskById.get(o.taskId) : null;
            return [
              `الاجتماع ${seqByMeeting.get(o.meetingId) ?? "—"}`,
              o.outcomeType,
              orDash(o.text),
              t ? `${t.mandatory ? "إلزامي" : "اختياري"} — ${t.status}` : "—",
            ];
          }),
        },
      },
      {
        heading: "المرفقات",
        table: {
          headers: ["الاجتماع", "العنوان", "الفئة", "الوصف"],
          rows: attachments.map((a) => [`الاجتماع ${seqByMeeting.get(a.meetingId) ?? "—"}`, orFallback(a.title), orDash(a.category), orDash(a.description)]),
        },
      },
    ],
  });

  await audit({ actorId: user.id, action: "export.committee_docx", entityType: "committee", entityId: id, summary: `تصدير Word للجنة ${c.nameAr}` });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`تقرير_لجنة_${c.nameAr}.docx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

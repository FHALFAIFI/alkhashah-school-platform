import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { committees, committeeMembers, meetings, meetingOutcomes, actionTasks, people, meetingTypes, meetingAttachments, committeeImpacts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

/** تصدير Excel تحليلي للجنة: الأعضاء والاجتماعات والنتائج — لا حضور ولا غياب ولا نصاب */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.generate")) return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });

  const [c] = await db.select().from(committees).where(eq(committees.id, id));
  if (!c) return NextResponse.json({ error: "اللجنة غير موجودة" }, { status: 404 });
  const [members, ms] = await Promise.all([
    db
      .select({ role: committeeMembers.role, position: committeeMembers.position, name: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, id))
      .orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(meetings).where(eq(meetings.committeeId, id)).orderBy(asc(meetings.seq)),
  ]);
  const meetingIds = ms.map((m) => m.id);
  const outcomes = meetingIds.length
    ? await db.select().from(meetingOutcomes).where(inArray(meetingOutcomes.meetingId, meetingIds)).orderBy(asc(meetingOutcomes.sortOrder))
    : [];
  const attachments = meetingIds.length
    ? await db.select().from(meetingAttachments).where(inArray(meetingAttachments.meetingId, meetingIds)).orderBy(asc(meetingAttachments.createdAt))
    : [];
  const impacts = await db.select().from(committeeImpacts).where(eq(committeeImpacts.committeeId, id)).orderBy(asc(committeeImpacts.createdAt));
  const allTypes = await db.select().from(meetingTypes);
  const typeName = new Map(allTypes.map((t) => [t.id, t.nameAr]));
  const taskIds = outcomes.map((o) => o.taskId).filter(Boolean) as string[];
  const tasks = taskIds.length ? await db.select().from(actionTasks).where(inArray(actionTasks.id, taskIds)) : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const seqByMeeting = new Map(ms.map((m) => [m.id, m.seq]));

  const wb = new ExcelJS.Workbook();
  const wsM = wb.addWorksheet("الأعضاء", { views: [{ rightToLeft: true }] });
  wsM.columns = [
    { header: "الاسم", key: "name", width: 28 },
    { header: "الصفة", key: "position", width: 20 },
    { header: "العمل في اللجنة", key: "role", width: 14 },
  ];
  wsM.getRow(1).font = { bold: true };
  for (const m of members) wsM.addRow({ name: m.name, position: m.position ?? "—", role: m.role });

  const wsMe = wb.addWorksheet("الاجتماعات", { views: [{ rightToLeft: true }] });
  wsMe.columns = [
    { header: "م", key: "seq", width: 6 },
    { header: "العنوان", key: "title", width: 32 },
    { header: "النوع", key: "type", width: 16 },
    { header: "الحالة", key: "status", width: 16 },
  ];
  wsMe.getRow(1).font = { bold: true };
  for (const m of ms) wsMe.addRow({ seq: m.seq, title: m.title ?? "—", type: m.typeId ? typeName.get(m.typeId) ?? "—" : "—", status: m.status });

  const wsO = wb.addWorksheet("النتائج", { views: [{ rightToLeft: true }] });
  wsO.columns = [
    { header: "الاجتماع", key: "meeting", width: 12 },
    { header: "النوع", key: "type", width: 12 },
    { header: "النص", key: "text", width: 48 },
    { header: "الإجراء", key: "action", width: 20 },
  ];
  wsO.getRow(1).font = { bold: true };
  for (const o of outcomes) {
    const t = o.taskId ? taskById.get(o.taskId) : null;
    wsO.addRow({
      meeting: `الاجتماع ${seqByMeeting.get(o.meetingId) ?? "—"}`,
      type: o.outcomeType,
      text: o.text,
      action: t ? `${t.mandatory ? "إلزامي" : "اختياري"} — ${t.status}` : "—",
    });
  }

  const wsA = wb.addWorksheet("المرفقات", { views: [{ rightToLeft: true }] });
  wsA.columns = [
    { header: "الاجتماع", key: "meeting", width: 12 },
    { header: "العنوان", key: "title", width: 28 },
    { header: "الفئة", key: "category", width: 18 },
    { header: "الوصف", key: "description", width: 40 },
  ];
  wsA.getRow(1).font = { bold: true };
  for (const a of attachments) {
    wsA.addRow({ meeting: `الاجتماع ${seqByMeeting.get(a.meetingId) ?? "—"}`, title: a.title, category: a.category, description: a.description ?? "—" });
  }

  const wsI = wb.addWorksheet("النتائج والأثر", { views: [{ rightToLeft: true }] });
  wsI.columns = [
    { header: "النتيجة", key: "result", width: 40 },
    { header: "الأثر", key: "impact", width: 40 },
    { header: "القياس/المؤشر", key: "measurement", width: 24 },
    { header: "تاريخ الملاحظة", key: "observed", width: 16 },
  ];
  wsI.getRow(1).font = { bold: true };
  for (const im of impacts) {
    wsI.addRow({ result: im.result, impact: im.impact, measurement: im.measurement ?? "—", observed: im.observedAt ? im.observedAt.toISOString().slice(0, 10) : "—" });
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await audit({ actorId: user.id, action: "export.committee_xlsx", entityType: "committee", entityId: id, summary: `تصدير Excel للجنة ${c.nameAr}` });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`لجنة_${c.nameAr}_تحليلي.xlsx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { committees, committeeMembers, meetings, meetingOutcomes, actionTasks, people, planYears, meetingTypes, meetingAttachments } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";
import { escapeHtml as esc } from "@/lib/html-escape";

/**
 * تقرير اللجنة الرسمي: التشكيل والأعضاء (تسجيل عضوية فقط — لا حضور ولا غياب ولا نصاب)
 * والاجتماعات ونتائجها (قرارات/توصيات/ملاحظات) والإجراءات المرتبطة. يوقعه الرئيس والمقرر.
 */
export async function generateCommitteeReport(opts: { committeeId: string; issuedBy: string }) {
  const [c] = await db.select().from(committees).where(eq(committees.id, opts.committeeId));
  if (!c) throw new Error("اللجنة غير موجودة");
  const [members, ms, [year]] = await Promise.all([
    db
      .select({ role: committeeMembers.role, position: committeeMembers.position, sortOrder: committeeMembers.sortOrder, name: people.fullName })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, opts.committeeId))
      .orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(meetings).where(eq(meetings.committeeId, opts.committeeId)).orderBy(asc(meetings.seq)),
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
  const outcomesByMeeting = new Map<string, typeof outcomes>();
  for (const o of outcomes) {
    const arr = outcomesByMeeting.get(o.meetingId) ?? [];
    arr.push(o);
    outcomesByMeeting.set(o.meetingId, arr);
  }
  const attByMeeting = new Map<string, typeof attachments>();
  for (const a of attachments) {
    const arr = attByMeeting.get(a.meetingId) ?? [];
    arr.push(a);
    attByMeeting.set(a.meetingId, arr);
  }

  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  let body = `
  <h2>بيانات اللجنة</h2>
  <table>
    <tr><th style="width:22%">الاسم</th><td>${esc(orFallback(c.nameAr))}</td></tr>
    <tr><th>النوع</th><td>${esc(c.kind)}</td></tr>
    <tr><th>السنة</th><td>${esc(year?.nameAr ?? "—")}</td></tr>
    <tr><th>الحالة</th><td>${esc(c.status)}</td></tr>
    ${c.goal ? `<tr><th>الهدف</th><td>${esc(c.goal)}</td></tr>` : ""}
    ${c.objectives ? `<tr><th>الأهداف</th><td>${esc(c.objectives)}</td></tr>` : ""}
    ${c.outputs ? `<tr><th>المخرجات</th><td>${esc(c.outputs)}</td></tr>` : ""}
  </table>

  <h2>الأعضاء (تسجيل التشكيل — لا حضور ولا غياب)</h2>
  <table>
    <tr><th>م</th><th>الاسم</th><th>الصفة</th><th>العمل في اللجنة</th></tr>
    ${members.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(orFallback(m.name))}</td><td>${esc(orDash(m.position))}</td><td>${esc(orDash(m.role))}</td></tr>`).join("")}
  </table>

  <h2>الاجتماعات ونتائجها (${ms.length})</h2>`;

  for (const m of ms) {
    const dateText = m.meetingDate ? `${toHijriNumeric(m.meetingDate)}هـ (${toGregorianNumeric(m.meetingDate)}م)` : "—";
    const os = outcomesByMeeting.get(m.id) ?? [];
    const atts = attByMeeting.get(m.id) ?? [];
    const mType = m.typeId ? typeName.get(m.typeId) ?? "" : "";
    body += `
    <div style="page-break-inside:avoid; margin-bottom:12px;">
      <h3>الاجتماع ${m.seq}: ${esc(orFallback(m.title, `الاجتماع ${m.seq}`))}${mType ? ` — نوع: ${esc(mType)}` : ""} — ${dateText} — ${esc(m.status)}</h3>
      <table>
        <tr><th>النوع</th><th>النص</th><th>الإجراء المرتبط</th></tr>
        ${os
          .map((o) => {
            const t = o.taskId ? taskById.get(o.taskId) : null;
            const action = t ? `${t.mandatory ? "إلزامي" : "اختياري"} — ${t.status}` : "—";
            return `<tr><td>${esc(o.outcomeType)}</td><td>${esc(orDash(o.text))}</td><td>${esc(action)}</td></tr>`;
          })
          .join("")}
        ${os.length === 0 ? `<tr><td colspan="3">لا نتائج مسجلة</td></tr>` : ""}
      </table>
      ${
        atts.length > 0
          ? `<p style="margin:4px 0"><strong>المرفقات:</strong></p><table>
        <tr><th>العنوان</th><th>الفئة</th><th>الوصف</th></tr>
        ${atts.map((a) => `<tr><td>${esc(orFallback(a.title))}</td><td>${esc(orDash(a.category))}</td><td>${esc(orDash(a.description))}</td></tr>`).join("")}
      </table>`
          : ""
      }
    </div>`;
  }

  const chair = members.find((m) => m.role === "رئيس" || m.role === "قائد");
  const secretary = members.find((m) => m.role === "مقرر");
  body += `<p style="margin-top:16px">يُعتمد التقرير بتوقيع ${chair ? `الرئيس (${esc(orFallback(chair.name))})` : "الرئيس"} و${secretary ? `المقرر (${esc(orFallback(secretary.name))})` : "المقرر"} عند الحاجة — التوقيع ليس شرطاً إلزامياً لهذا التقرير.</p>`;

  const title = `تقرير اللجنة: ${orFallback(c.nameAr)}`;
  // الترويسة الرسمية المركزية (v2.3 §8): الهوية والشعارات من الإعدادات
  const identityHeader = await getOfficialHeader();
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, identity: identityHeader });
  const doc = await issueDocument({
    docType: "committee_report",
    title,
    entityType: "committee",
    entityId: c.id,
    htmlSnapshot: preliminaryHtml,
    withSignature: false,
    withStamp: false,
    issuedBy: opts.issuedBy,
  });
  const finalHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, docNumber: doc.docNumber, verificationCode: doc.verificationCode, identity: identityHeader });
  const pdf = await htmlToPdf(finalHtml);
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    uploadedBy: opts.issuedBy,
  });
  const { documents } = await import("@/db/schema");
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

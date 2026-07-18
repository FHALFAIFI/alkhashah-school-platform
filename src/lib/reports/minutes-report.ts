import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { committees, committeeMembers, meetings, meetingOutcomes, people, documents, meetingTypes, meetingAttachments } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** توليد محضر اجتماع رسمي — يوقعه الرئيس والمقرر فقط */
export async function generateMinutesDocument(opts: { meetingId: string; issuedBy: string }) {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, opts.meetingId));
  if (!meeting) throw new Error("الاجتماع غير موجود");
  const [committee] = await db.select().from(committees).where(eq(committees.id, meeting.committeeId));
  const members = await db
    .select({ m: committeeMembers, name: people.fullName })
    .from(committeeMembers)
    .innerJoin(people, eq(committeeMembers.personId, people.id))
    .where(eq(committeeMembers.committeeId, meeting.committeeId))
    .orderBy(asc(committeeMembers.sortOrder));
  const outcomes = await db
    .select()
    .from(meetingOutcomes)
    .where(eq(meetingOutcomes.meetingId, opts.meetingId))
    .orderBy(asc(meetingOutcomes.sortOrder));
  const attachments = await db
    .select()
    .from(meetingAttachments)
    .where(eq(meetingAttachments.meetingId, opts.meetingId))
    .orderBy(asc(meetingAttachments.createdAt));
  const typeName = meeting.typeId
    ? (await db.select({ nameAr: meetingTypes.nameAr }).from(meetingTypes).where(eq(meetingTypes.id, meeting.typeId)))[0]?.nameAr ?? null
    : null;

  const chair = members.find((x) => x.m.role === "رئيس" || x.m.role === "قائد");
  const secretary = members.find((x) => x.m.role === "مقرر");

  const dateText = meeting.meetingDate
    ? `${toHijriNumeric(meeting.meetingDate)}هـ (${toGregorianNumeric(meeting.meetingDate)}م)`
    : "—";
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  const body = `
  <h2>بيانات الاجتماع</h2>
  <table>
    <tr><th style="width:22%">اللجنة / الفريق</th><td>${esc(committee.nameAr)}</td></tr>
    <tr><th>الاجتماع</th><td>${esc(meeting.title ?? `الاجتماع ${meeting.seq}`)} (رقم ${meeting.seq})</td></tr>
    ${typeName ? `<tr><th>نوع الاجتماع</th><td>${esc(typeName)}</td></tr>` : ""}
    <tr><th>التاريخ</th><td>${dateText}</td></tr>
    ${meeting.location ? `<tr><th>المكان</th><td>${esc(meeting.location)}</td></tr>` : ""}
  </table>

  <h2>الأعضاء (تسجيل التشكيل)</h2>
  <table>
    <tr><th>م</th><th>الاسم</th><th>الصفة</th><th>العمل في اللجنة</th></tr>
    ${members.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td>${esc(x.m.position ?? "—")}</td><td>${esc(x.m.role)}</td></tr>`).join("")}
  </table>

  <h2>جدول الأعمال</h2>
  <ol>${(meeting.agenda ?? []).map((a) => `<li>${esc(a)}</li>`).join("")}</ol>

  ${meeting.discussion ? `<h2>المناقشات</h2><p>${esc(meeting.discussion).replaceAll("\n", "<br>")}</p>` : ""}

  <h2>النتائج</h2>
  <table>
    <tr><th>النوع</th><th>النص</th><th>إجراء</th></tr>
    ${outcomes
      .map(
        (o) =>
          `<tr><td>${esc(o.outcomeType)}</td><td>${esc(o.text)}</td><td>${o.taskId ? (o.outcomeType === "قرار" ? "إجراء إلزامي" : "إجراء اختياري") : "—"}</td></tr>`,
      )
      .join("")}
  </table>

  ${
    attachments.length > 0
      ? `<h2>المرفقات (${attachments.length})</h2>
  <table>
    <tr><th>العنوان</th><th>الفئة</th><th>الوصف</th></tr>
    ${attachments.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.category)}</td><td>${esc(a.description ?? "—")}</td></tr>`).join("")}
  </table>`
      : ""
  }

  <div class="signatures">
    <div class="sig-block"><div class="sig-line">رئيس اللجنة${chair ? `<br>${esc(chair.name)}` : ""}</div></div>
    <div class="sig-block"><div class="sig-line">المقرر${secretary ? `<br>${esc(secretary.name)}` : ""}</div></div>
  </div>
  <p class="meta">يوقع المحضر من الرئيس والمقرر فقط، ثم يرفع المحضر الموقع في النظام شرطاً لاكتمال الاجتماع.</p>
  `;

  const title = `محضر اجتماع: ${committee.nameAr} — ${meeting.title ?? meeting.seq}`;
  const doc = await issueDocument({
    docType: "meeting_minutes",
    title,
    entityType: "meeting",
    entityId: meeting.id,
    htmlSnapshot: "",
    issuedBy: opts.issuedBy,
  });
  const finalHtml = officialPageHtml({
    title,
    bodyHtml: body,
    issuedAtText,
    docNumber: doc.docNumber,
    verificationCode: doc.verificationCode,
  });
  const pdf = await htmlToPdf(finalHtml);
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    uploadedBy: opts.issuedBy,
  });
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));
  await db.update(meetings).set({ minutesDocId: doc.id }).where(eq(meetings.id, meeting.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

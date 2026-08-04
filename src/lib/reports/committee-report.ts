import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  committees,
  committeeMembers,
  committeeTaskAssignments,
  committeeImpacts,
  meetings,
  meetingOutcomes,
  actionTasks,
  people,
  planYears,
  meetingTypes,
  meetingAttachments,
  documents as documentsTable,
} from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";
import { escapeHtml as esc } from "@/lib/html-escape";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { taskStatusLabel, COMMITTEE_NO_TASKS_LABEL, ADD_TASK_CTA } from "@/lib/committees/task-status";
import {
  COMMITTEE_CARD_LABEL,
  COMMITTEE_REGISTRY_LABEL,
  DUE_DATE_UNSUPPORTED,
  MEMBER_TASK_HEADERS,
} from "@/lib/committees/report-labels";

/**
 * تقرير اللجنة الرسمي («بطاقة لجنة / مجلس»): التشكيل والأعضاء (تسجيل عضوية فقط — لا حضور
 * ولا غياب ولا نصاب) وتوزيع المهام بحالتها (v2.4 §12) والاجتماعات ونتائجها
 * (قرارات/توصيات/ملاحظات) والإجراءات المرتبطة والنتائج والأثر التاريخية إن وُجدت.
 * يوقعه الرئيس والمقرر.
 */

/** بناء جسم تقرير لجنة واحدة — يعاد استعماله في تقرير اللجنة المفرد وفي السجل التفصيلي */
async function buildCommitteeBody(committeeId: string): Promise<{ c: typeof committees.$inferSelect; body: string }> {
  const [c] = await db.select().from(committees).where(eq(committees.id, committeeId));
  if (!c) throw new Error("اللجنة غير موجودة");
  const [members, ms, [year], taskRows, impactRows] = await Promise.all([
    db
      .select({
        id: committeeMembers.id,
        role: committeeMembers.role,
        position: committeeMembers.position,
        sortOrder: committeeMembers.sortOrder,
        effectiveTo: committeeMembers.effectiveTo,
        name: people.fullName,
      })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, committeeId))
      .orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(meetings).where(eq(meetings.committeeId, committeeId)).orderBy(asc(meetings.seq)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
    db
      .select()
      .from(committeeTaskAssignments)
      .where(eq(committeeTaskAssignments.committeeId, committeeId))
      .orderBy(asc(committeeTaskAssignments.sortOrder)),
    // النتائج والأثر: جدول تاريخي (أُزيل مساره الكتابي في v2.1 §G3) — يُعرض فقط إن وُجدت صفوف
    db.select().from(committeeImpacts).where(eq(committeeImpacts.committeeId, committeeId)),
  ]);
  const meetingIds = ms.map((m) => m.id);
  const outcomes = meetingIds.length
    ? await db.select().from(meetingOutcomes).where(inArray(meetingOutcomes.meetingId, meetingIds)).orderBy(asc(meetingOutcomes.sortOrder))
    : [];
  const attachments = meetingIds.length
    ? await db.select().from(meetingAttachments).where(inArray(meetingAttachments.meetingId, meetingIds)).orderBy(asc(meetingAttachments.createdAt))
    : [];
  const minutesDocIds = ms.map((m) => m.minutesDocId).filter(Boolean) as string[];
  const minutesDocs = minutesDocIds.length
    ? await db
        .select({ id: documentsTable.id, docNumber: documentsTable.docNumber })
        .from(documentsTable)
        .where(inArray(documentsTable.id, minutesDocIds))
    : [];
  const minutesNumberById = new Map(minutesDocs.map((d) => [d.id, d.docNumber]));
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
  // v2.4 §12: مهام كل عضو بحالتها — كل عضو صف مستقل، لا خلايا مدموجة
  const activeTasks = taskRows.filter((t) => !t.excluded);
  const tasksByMember = new Map<string, { title: string; status: string | null }[]>();
  for (const t of activeTasks) {
    if (!t.assignedMemberId) continue;
    const arr = tasksByMember.get(t.assignedMemberId) ?? [];
    arr.push({ title: t.title, status: t.status });
    tasksByMember.set(t.assignedMemberId, arr);
  }
  const memberById = new Map(members.map((m) => [m.id, m]));

  let body = `
  <h2>البيانات الأساسية</h2>
  <table>
    <tr><th style="width:22%">الاسم</th><td>${esc(orFallback(c.nameAr))}</td></tr>
    <tr><th>النوع</th><td>${esc(c.kind)}</td></tr>
    <tr><th>السنة</th><td>${esc(year?.nameAr ?? "—")}</td></tr>
    <tr><th>الحالة</th><td>${esc(c.status)}</td></tr>
    <tr><th>تاريخ التشكيل</th><td>${esc(toGregorianNumeric(c.createdAt))}م</td></tr>
    ${c.approvedAt ? `<tr><th>تاريخ الاعتماد</th><td>${esc(toGregorianNumeric(c.approvedAt))}م</td></tr>` : ""}
    ${c.closedAt ? `<tr><th>تاريخ الإقفال</th><td>${esc(toGregorianNumeric(c.closedAt))}م</td></tr>` : ""}
    ${c.goal ? `<tr><th>الهدف</th><td>${esc(c.goal)}</td></tr>` : ""}
    ${Array.isArray(c.duties) && c.duties.length > 0 ? `<tr><th>الاختصاصات</th><td>${(c.duties as string[]).map((d) => esc(d)).join("؛ ")}</td></tr>` : ""}
    ${c.objectives ? `<tr><th>الأهداف</th><td>${esc(c.objectives)}</td></tr>` : ""}
    ${c.outputs ? `<tr><th>المخرجات</th><td>${esc(c.outputs)}</td></tr>` : ""}
  </table>

  <h2>الأعضاء والمهام (كل عضو في صف مستقل — تسجيل تشكيل لا حضور)</h2>
  <table>
    <tr><th>م</th><th>${esc(MEMBER_TASK_HEADERS[0])}</th><th>${esc(MEMBER_TASK_HEADERS[1])}</th><th>العمل في اللجنة</th><th>${esc(MEMBER_TASK_HEADERS[2])}</th><th>${esc(MEMBER_TASK_HEADERS[3])}</th></tr>
    ${members
      .map((m, i) => {
        const mTasks = tasksByMember.get(m.id) ?? [];
        // v2.4.1 §6.4: «لا مهام مسندة» و«لم يتم تحديد الحالة» نصّان مختلفان — لا «—» لكليهما
        const taskText = mTasks.length ? mTasks.map((t) => esc(t.title)).join("؛ ") : "لا مهام مسندة";
        const statusText = mTasks.length
          ? mTasks.map((t) => esc(taskStatusLabel(t.status))).join("؛ ")
          : "لا مهام مسندة";
        const nameCell = `${esc(orFallback(m.name))}${m.effectiveTo ? " (عضوية منتهية)" : ""}`;
        return `<tr><td>${i + 1}</td><td>${nameCell}</td><td>${esc(orDash(m.position))}</td><td>${esc(orDash(m.role))}</td><td>${taskText}</td><td>${statusText}</td></tr>`;
      })
      .join("")}
  </table>`;

  if (activeTasks.length > 0) {
    body += `
  <h2>توزيع المهام وتنفيذها (${activeTasks.length})</h2>
  <p class="meta">${esc(DUE_DATE_UNSUPPORTED)}.</p>
  <table>
    <tr><th>م</th><th>المهمة</th><th>المكلَّف</th><th>حالة التنفيذ</th><th>ملاحظات</th></tr>
    ${activeTasks
      .map((t, i) => {
        const mem = t.assignedMemberId ? memberById.get(t.assignedMemberId) : undefined;
        return `<tr><td>${i + 1}</td><td>${esc(t.title)}</td><td>${esc(orDash(mem?.name ?? null))}</td><td>${esc(taskStatusLabel(t.status))}</td><td>${esc(orDash(t.notes))}</td></tr>`;
      })
      .join("")}
  </table>`;
  } else {
    // §6.4: قسم فارغ مُعنون صراحةً — الجدول الفارغ بلا شرح هو ما قُرئ سابقاً كنقص في التقرير
    body += `
  <h2>توزيع المهام وتنفيذها</h2>
  <p>${esc(COMMITTEE_NO_TASKS_LABEL)} — استخدم «${esc(ADD_TASK_CTA)}» من صفحة اللجنة في المنصة.</p>`;
  }

  body += `
  <h2>الاجتماعات ونتائجها (${ms.length})</h2>`;

  for (const m of ms) {
    const dateText = m.meetingDate ? `${toHijriNumeric(m.meetingDate)}هـ (${toGregorianNumeric(m.meetingDate)}م)` : "—";
    const os = outcomesByMeeting.get(m.id) ?? [];
    const atts = attByMeeting.get(m.id) ?? [];
    const mType = m.typeId ? typeName.get(m.typeId) ?? "" : "";
    const minutesNo = m.minutesDocId ? minutesNumberById.get(m.minutesDocId) : null;
    body += `
    <div style="page-break-inside:avoid; margin-bottom:12px;">
      <h3>الاجتماع ${m.seq}: ${esc(orFallback(m.title, `الاجتماع ${m.seq}`))}${mType ? ` — نوع: ${esc(mType)}` : ""} — ${dateText} — ${esc(m.status)}${minutesNo ? ` — محضر رقم ${esc(minutesNo)}` : ""}${m.signedMinutesFileId ? " — محضر موقع مستلم" : ""}</h3>
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

  if (impactRows.length > 0) {
    body += `
  <h2>النتائج والأثر (سجل تاريخي)</h2>
  <table>
    <tr><th>النتيجة</th><th>الأثر</th><th>طريقة القياس</th></tr>
    ${impactRows.map((r) => `<tr><td>${esc(orDash(r.result))}</td><td>${esc(orDash(r.impact))}</td><td>${esc(orDash(r.measurement))}</td></tr>`).join("")}
  </table>`;
  }

  const chair = members.find((m) => m.role === "رئيس" || m.role === "قائد");
  const secretary = members.find((m) => m.role === "مقرر");
  body += `<p style="margin-top:16px">يُعتمد التقرير بتوقيع ${chair ? `الرئيس (${esc(orFallback(chair.name))})` : "الرئيس"} و${secretary ? `المقرر (${esc(orFallback(secretary.name))})` : "المقرر"} عند الحاجة — التوقيع ليس شرطاً إلزامياً لهذا التقرير.</p>`;

  return { c, body };
}

/** إصدار وثيقة نهائية: لقطة أولية → رقم وثيقة → PDF بترقيم صفحات → حفظ */
async function issueCommitteeDocument(opts: {
  docType: "committee_report" | "committee_registry";
  title: string;
  entityType: string;
  entityId?: string;
  body: string;
  issuedBy: string;
}) {
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;
  // الترويسة الرسمية المركزية (v2.3 §8): الهوية والشعارات من الإعدادات
  const identityHeader = await getOfficialHeader();
  const preliminaryHtml = officialPageHtml({ title: opts.title, bodyHtml: opts.body, issuedAtText, identity: identityHeader });
  const doc = await issueDocument({
    docType: opts.docType,
    title: opts.title,
    entityType: opts.entityType,
    entityId: opts.entityId,
    htmlSnapshot: preliminaryHtml,
    withSignature: false,
    withStamp: false,
    issuedBy: opts.issuedBy,
  });
  const finalHtml = officialPageHtml({
    title: opts.title,
    bodyHtml: opts.body,
    issuedAtText,
    docNumber: doc.docNumber,
    verificationCode: doc.verificationCode,
    identity: identityHeader,
  });
  const pdf = await htmlToPdf(finalHtml, { pageNumbers: true });
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    uploadedBy: opts.issuedBy,
  });
  await db.update(documentsTable).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documentsTable.id, doc.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

export async function generateCommitteeReport(opts: { committeeId: string; issuedBy: string }) {
  const { c, body } = await buildCommitteeBody(opts.committeeId);
  return issueCommitteeDocument({
    docType: "committee_report",
    title: `${COMMITTEE_CARD_LABEL}: ${orFallback(c.nameAr)}`,
    entityType: "committee",
    entityId: c.id,
    body,
    issuedBy: opts.issuedBy,
  });
}

/**
 * v2.4 §12: «سجل المجالس واللجان التفصيلي» — وثيقة واحدة بقسم مستقل لكل لجنة/مجلس
 * (البيانات الأساسية، الأعضاء والتكليفات صفاً صفاً، توزيع المهام بحالتها، الاجتماعات
 * والمحاضر، القرارات والتوصيات، النتائج والأثر التاريخية). تحل محل العرض العددي المدموج.
 */
export async function generateCommitteeRegistry(opts: { issuedBy: string; planYearId?: string }) {
  const excluded = await getExcludedIdSets();
  const all = await db
    .select({ id: committees.id, nameAr: committees.nameAr, kind: committees.kind, planYearId: committees.planYearId })
    .from(committees)
    .where(notSynthetic(committees.id, excluded.committees))
    .orderBy(asc(committees.createdAt));
  const scoped = opts.planYearId ? all.filter((c) => c.planYearId === opts.planYearId) : all;
  if (scoped.length === 0) throw new Error("لا لجان مسجلة لإصدار السجل");

  let body = "";
  for (const [i, cRow] of scoped.entries()) {
    const { body: committeeBody } = await buildCommitteeBody(cRow.id);
    body += `
    ${i > 0 ? `<div style="page-break-before:always"></div>` : ""}
    <h2 style="border:none; background:#f2f0eb; padding:6px 10px; border-radius:6px;">${i + 1}. ${esc(cRow.kind)}: ${esc(orFallback(cRow.nameAr))}</h2>
    ${committeeBody}`;
  }

  return issueCommitteeDocument({
    docType: "committee_registry",
    title: COMMITTEE_REGISTRY_LABEL,
    entityType: "committee_registry",
    body,
    issuedBy: opts.issuedBy,
  });
}

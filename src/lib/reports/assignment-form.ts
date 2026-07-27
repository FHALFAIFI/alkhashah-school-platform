import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { committees, committeeMembers, committeeTaskAssignments, people, planYears } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { getDocumentIdentity, resolveHeader, type IdentityToggles } from "@/lib/document-identity";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback, orDash } from "@/lib/format";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * نموذج التكليف على مستوى اللجنة (D-027): قائمتان مستقلتان — «أعضاء اللجنة» (كل الأعضاء الحاليين
 * مع عمود توقيع ورقي) و«مهام اللجنة» (كل المهام غير المستبعدة كقائمة مستقلة، دون ربط كل مهمة بعضو).
 * القائمتان تظهران وإن كانت إحداهما فارغة (لا يُرمى استثناء). عمود التوقيع ورقي يظهر في المطبوع فقط.
 * يستعمل هوية الوثائق المركزية ويُجمّد كلقطة تاريخية (تعديل القوالب لاحقاً لا يمسّ هذه اللقطة).
 */
export async function generateAssignmentForm(opts: {
  committeeId: string;
  issuedBy: string;
  toggles?: Partial<IdentityToggles>;
}) {
  const [c] = await db.select().from(committees).where(eq(committees.id, opts.committeeId));
  if (!c) throw new Error("اللجنة غير موجودة");

  const [members, tasks, [year], identity] = await Promise.all([
    // القائمة الأولى: كل أعضاء اللجنة الحاليين (العضوية الحالية = effectiveTo IS NULL) — مستقلة عن المهام
    db
      .select({
        name: people.fullName,
        role: committeeMembers.role,
        position: committeeMembers.position,
        sortOrder: committeeMembers.sortOrder,
      })
      .from(committeeMembers)
      .leftJoin(people, eq(committeeMembers.personId, people.id))
      .where(and(eq(committeeMembers.committeeId, opts.committeeId), isNull(committeeMembers.effectiveTo)))
      .orderBy(asc(committeeMembers.sortOrder)),
    // القائمة الثانية: كل مهام اللجنة غير المستبعدة — قائمة مستقلة لا تُربط كل مهمة بعضو
    db
      .select({
        title: committeeTaskAssignments.title,
        notes: committeeTaskAssignments.notes,
        sortOrder: committeeTaskAssignments.sortOrder,
      })
      .from(committeeTaskAssignments)
      .where(and(eq(committeeTaskAssignments.committeeId, opts.committeeId), eq(committeeTaskAssignments.excluded, false)))
      .orderBy(asc(committeeTaskAssignments.sortOrder)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
    getDocumentIdentity(),
  ]);

  const header = resolveHeader(identity, opts.toggles);
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  const memberRows =
    members.length === 0
      ? `<tr><td colspan="5">لا أعضاء</td></tr>`
      : members
          .map(
            (m, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(orFallback(m.name))}</td>
        <td>${esc(orDash(m.role))}</td>
        <td>${esc(orDash(m.position))}</td>
        <td></td>
      </tr>`,
          )
          .join("");

  const taskRows =
    tasks.length === 0
      ? `<tr><td colspan="3">لا مهام</td></tr>`
      : tasks
          .map(
            (t, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(orFallback(t.title))}</td>
        <td>${esc(orDash(t.notes))}</td>
      </tr>`,
          )
          .join("");

  const body = `
    <p>بناءً على الصلاحيات الممنوحة، يُوثّق أدناه أعضاء
    <strong>${esc(orFallback(c.nameAr))}</strong> ومهام اللجنة للعام الدراسي ${esc(year?.nameAr ?? identity.academicYear)}،
    في قائمتين مستقلتين:</p>
    <h2>أعضاء اللجنة</h2>
    <table>
      <thead><tr><th>م</th><th>الاسم</th><th>العمل في اللجنة</th><th>الصفة/الدور</th><th>التوقيع</th></tr></thead>
      <tbody>${memberRows}</tbody>
    </table>
    <h2>مهام اللجنة</h2>
    <table>
      <thead><tr><th>م</th><th>المهمة</th><th>ملاحظات</th></tr></thead>
      <tbody>${taskRows}</tbody>
    </table>
    ${c.goal ? `<h2>الهدف</h2><p>${esc(c.goal)}</p>` : ""}
    <p class="meta">يُطبع هذا النموذج ويوقّع الأعضاء في خانة «التوقيع» بجدول الأعضاء، ثم يُرفع الأصل الموقّع عند الحاجة.</p>
  `;

  const title = `نموذج توزيع مهام — ${orFallback(c.nameAr)}`;
  const identityHeader = {
    orgLines: header.orgLines,
    headerNote: header.headerNote,
    footerNote: header.footerNote,
    principalName: header.principalName,
    academicYear: header.academicYear,
  };
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, identity: identityHeader });
  const doc = await issueDocument({
    docType: "committee_assignment",
    title,
    entityType: "committee",
    entityId: opts.committeeId,
    htmlSnapshot: preliminaryHtml,
    issuedBy: opts.issuedBy,
  });
  const finalHtml = officialPageHtml({
    title,
    bodyHtml: body,
    issuedAtText,
    docNumber: doc.docNumber,
    verificationCode: doc.verificationCode,
    identity: identityHeader,
  });
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

import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { committees, committeeMembers, committeeTaskAssignments, people, planYears } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { getDocumentIdentity, resolveHeader, type IdentityToggles } from "@/lib/document-identity";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * نموذج توزيع المهام على مستوى اللجنة (D-027): جدول مهام — المهمة / العضو المكلف / الصفة-الدور /
 * توقيع العضو / ملاحظات — يُطبع ويوقّع. عمود التوقيع ورقي يظهر في المطبوع. يستعمل هوية الوثائق
 * المركزية ويُجمّد كلقطة تاريخية (تعديل قوالب المهام لاحقاً لا يمسّ هذه اللقطة).
 */
export async function generateAssignmentForm(opts: {
  committeeId: string;
  issuedBy: string;
  toggles?: Partial<IdentityToggles>;
}) {
  const [c] = await db.select().from(committees).where(eq(committees.id, opts.committeeId));
  if (!c) throw new Error("اللجنة غير موجودة");

  const [tasks, [year], identity] = await Promise.all([
    db
      .select({
        title: committeeTaskAssignments.title,
        notes: committeeTaskAssignments.notes,
        sortOrder: committeeTaskAssignments.sortOrder,
        memberName: people.fullName,
        memberRole: committeeMembers.role,
      })
      .from(committeeTaskAssignments)
      .leftJoin(committeeMembers, eq(committeeTaskAssignments.assignedMemberId, committeeMembers.id))
      .leftJoin(people, eq(committeeMembers.personId, people.id))
      .where(and(eq(committeeTaskAssignments.committeeId, opts.committeeId), eq(committeeTaskAssignments.excluded, false)))
      .orderBy(asc(committeeTaskAssignments.sortOrder)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
    getDocumentIdentity(),
  ]);

  if (tasks.length === 0) throw new Error("لا مهام موزّعة — حمّل المهام المعرّفة مسبقاً ووزّعها على الأعضاء أولاً");

  const header = resolveHeader(identity, opts.toggles);
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  const rows = tasks
    .map(
      (t, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(t.title)}</td>
        <td>${esc(t.memberName ?? "—")}</td>
        <td>${esc(t.memberRole ?? "—")}</td>
        <td></td>
        <td>${esc(t.notes ?? "")}</td>
      </tr>`,
    )
    .join("");

  const body = `
    <p>بناءً على الصلاحيات الممنوحة، وُزّعت المهام الآتية على أعضاء
    <strong>${esc(c.nameAr)}</strong> للعام الدراسي ${esc(year?.nameAr ?? identity.academicYear)}،
    على النحو الموضّح أدناه:</p>
    <table>
      <thead><tr><th>م</th><th>المهمة</th><th>العضو المكلف</th><th>الصفة/الدور</th><th>توقيع العضو</th><th>ملاحظات</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${c.goal ? `<h2>الهدف</h2><p>${esc(c.goal)}</p>` : ""}
    <p class="meta">يُطبع جدول توزيع المهام ويوقّعه الأعضاء في خانة «توقيع العضو»، ثم يُرفع الأصل الموقّع عند الحاجة.</p>
  `;

  const title = `نموذج توزيع مهام — ${c.nameAr}`;
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

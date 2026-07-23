import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { committees, committeeMembers, people, planYears } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { getDocumentIdentity, resolveHeader, type IdentityToggles } from "@/lib/document-identity";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * نموذج تكليف واحد على مستوى اللجنة (§5): يسرد الأعضاء الفاعلين وأدوارهم للطباعة والتوقيع.
 * يستعمل هوية الوثائق المركزية مع ضبط التضمين/الاستبعاد، ويُجمّد ضمن لقطة الوثيقة.
 */
export async function generateAssignmentForm(opts: {
  committeeId: string;
  issuedBy: string;
  toggles?: Partial<IdentityToggles>;
}) {
  const [c] = await db.select().from(committees).where(eq(committees.id, opts.committeeId));
  if (!c) throw new Error("اللجنة غير موجودة");

  const [members, [year], identity] = await Promise.all([
    db
      .select({
        role: committeeMembers.role,
        position: committeeMembers.position,
        sortOrder: committeeMembers.sortOrder,
        name: people.fullName,
        effectiveTo: committeeMembers.effectiveTo,
      })
      .from(committeeMembers)
      .innerJoin(people, eq(committeeMembers.personId, people.id))
      .where(eq(committeeMembers.committeeId, opts.committeeId))
      .orderBy(asc(committeeMembers.sortOrder)),
    db.select().from(planYears).where(eq(planYears.id, c.planYearId)),
    getDocumentIdentity(),
  ]);

  // نموذج التكليف يسرد الأعضاء الفاعلين وقت الإصدار فقط — لا يعيد كتابة عضويات منتهية
  const active = members.filter((m) => !m.effectiveTo);
  const header = resolveHeader(identity, opts.toggles);
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  const rows = active
    .map(
      (m, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(m.name)}</td>
        <td>${esc(m.position ?? "—")}</td>
        <td>${esc(m.role)}</td>
        <td></td>
      </tr>`,
    )
    .join("");

  const body = `
    <p>بناءً على الصلاحيات الممنوحة، تم تكليف الأعضاء الآتية أسماؤهم بالعمل ضمن
    <strong>${esc(c.nameAr)}</strong> للعام الدراسي ${esc(year?.nameAr ?? identity.academicYear)}،
    وذلك حسب الأدوار الموضحة أدناه:</p>
    <table>
      <thead><tr><th>م</th><th>الاسم</th><th>المسمى الوظيفي</th><th>الدور في اللجنة</th><th>التوقيع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${c.goal ? `<h2>الهدف</h2><p>${esc(c.goal)}</p>` : ""}
    <p class="meta">يُطبع هذا النموذج ويُوقّع ثم يُرفع الأصل الموقّع إلى النظام.</p>
  `;

  const title = `نموذج تكليف — ${c.nameAr}`;
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

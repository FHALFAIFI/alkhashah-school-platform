import "server-only";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { programs, planYears, people } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { documents } from "@/db/schema";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { escapeHtml } from "@/lib/html-escape";
import { orFallback } from "@/lib/format";

/**
 * بطاقة تكليف منفذ البرنامج (v2.3 §20) — وثيقة تُسلَّم للمكلف بالتنفيذ:
 * بيانات البرنامج كاملة، المكلف والمشاركون، الفترة، الأنشطة والمخرجات والشواهد
 * المتوقعة، الميزانية، طريقة المتابعة، تعليمات التسليم، ملاحظات المدير، خانة
 * إقرار وتوقيع، الرقم المرجعي، ورمز QR يعمل محلياً (data URI — لا شبكة).
 *
 * تُصدر عبر خط الوثائق الموحّد: رقم وثيقة + رمز تحقق + لقطة HTML مجمّدة.
 */
export async function generateProgramCard(opts: { programId: string; issuedBy: string }) {
  const [program] = await db.select().from(programs).where(eq(programs.id, opts.programId));
  if (!program) throw new Error("البرنامج غير موجود");
  const [year] = await db.select().from(planYears).where(eq(planYears.id, program.planYearId));
  const owner = program.ownerPersonId
    ? (await db.select().from(people).where(eq(people.id, program.ownerPersonId)))[0] ?? null
    : null;

  const esc = (v: string | null | undefined) => escapeHtml(orFallback(v, "—"));
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;
  const reference = `${year?.key ?? ""}/${program.seq}`;

  const qrDataUrl = await QRCode.toDataURL(`madrasa://plan/${program.id}`, { width: 120, margin: 1 });

  const row = (label: string, value: string | null | undefined) =>
    `<tr><th style="width:22%">${escapeHtml(label)}</th><td>${esc(value)}</td></tr>`;

  const body = `
    <table>
      ${row("اسم البرنامج", program.name)}
      ${row("المجال", program.domain)}
      ${row("الهدف العام", program.generalGoal)}
      ${row("الهدف التفصيلي", program.specificGoal)}
      ${row("الوصف والمبررات", program.rationale)}
      ${row("المكلف بالتنفيذ", owner?.fullName ?? program.ownerPosition)}
      ${row("المشاركون المساندون", program.participants)}
      ${row("فترة التنفيذ", program.periodText)}
      ${row("البداية (هجري)", program.hijriStart ? `${program.hijriStart}هـ` : null)}
      ${row("النهاية (هجري)", program.hijriEnd ? `${program.hijriEnd}هـ` : null)}
      ${row("الفئة المستهدفة", program.targetGroup)}
      ${row("الأنشطة المطلوبة (آلية التنفيذ)", program.mechanism)}
      ${row("المخرجات المتوقعة", program.deliverableText)}
      ${row("الشواهد المتوقعة", program.evidenceText)}
      ${row("الموارد والميزانية", program.budget ? `${program.budget} ريال` : null)}
      ${row("طريقة المتابعة", program.followupText)}
      ${row("ملاحظات مدير المدرسة", program.principalNotes)}
    </table>
    <h2>تعليمات التسليم</h2>
    <p>يُنفَّذ البرنامج ضمن فترته المحددة، وتُرفع الشواهد في منصة الإدارة المدرسية أولاً بأول،
    ويُسلَّم ملخص الإنجاز عند الاكتمال. الشواهد داعمة للتوثيق ولا تشترط لإكمال البرنامج.</p>
    <h2>إقرار المكلف بالتنفيذ</h2>
    <p>اطلعت على بطاقة التكليف وأتولى تنفيذ البرنامج وفق ما ورد فيها.</p>
    <div class="signatures">
      <div class="sig-block"><div class="sig-line">المكلف بالتنفيذ — الاسم والتوقيع والتاريخ</div></div>
      <div class="sig-block"><div class="sig-line" style="border:none;padding-top:0">
        <img src="${qrDataUrl}" alt="رمز البرنامج" style="max-height:90px"><br>
        <span class="meta">الرقم المرجعي: ${escapeHtml(reference)}</span>
      </div></div>
    </div>
  `;

  const identityHeader = await getOfficialHeader();
  const title = `بطاقة تكليف منفذ برنامج — ${orFallback(program.name)}`;
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, identity: identityHeader });
  const doc = await issueDocument({
    docType: "program_card",
    title,
    entityType: "program",
    entityId: program.id,
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
  const pdf = await htmlToPdf(finalHtml, { pageNumbers: true });
  const pdfFile = await saveUploadedFile({
    originalName: `${doc.docNumber}.pdf`,
    mime: "application/pdf",
    data: pdf,
    scope: "reports",
    uploadedBy: opts.issuedBy,
  });
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));
  return { documentId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

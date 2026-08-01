import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { maintenanceIssues, inspectionFindings, inspections, rooms, floors, assets, documents, storedFiles, users } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile, readStoredFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric, dualNumericCell } from "@/lib/dates";
import { escapeHtml } from "@/lib/html-escape";
import { orFallback } from "@/lib/format";

/**
 * خطاب بلاغ الصيانة الرسمي (v2.3 §18) — الوثيقة التي تُرسل لشركة الصيانة وتُتابع
 * حتى الإغلاق: الرقم المرجعي، التاريخ بالتقويمين، الجهة، الموقع كاملاً، الوصف
 * والأولوية والإجراء المطلوب، الصور، خانة التوقيع (المسمى والاسم من الهوية
 * المركزية)، وقسما المتابعة والنتيجة النهائية.
 */
export async function generateMaintenanceLetter(opts: { issueId: string; issuedBy: string }) {
  const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, opts.issueId));
  if (!issue) throw new Error("البلاغ غير موجود");
  if (issue.status === "مسودة") throw new Error("اعتمد البلاغ قبل توليد خطابه");

  const room = issue.roomId ? (await db.select().from(rooms).where(eq(rooms.id, issue.roomId)))[0] ?? null : null;
  const floor = room ? (await db.select().from(floors).where(eq(floors.id, room.floorId)))[0] ?? null : null;
  const asset = issue.assetId ? (await db.select().from(assets).where(eq(assets.id, issue.assetId)))[0] ?? null : null;
  // v2.4 §14: مصدر البلاغ من الفحص — الملاحظة وخطورتها وتاريخ الفحص تظهر في الخطاب
  const finding = issue.inspectionFindingId
    ? ((await db.select().from(inspectionFindings).where(eq(inspectionFindings.id, issue.inspectionFindingId)))[0] ?? null)
    : null;
  const inspection = finding
    ? ((await db.select().from(inspections).where(eq(inspections.id, finding.inspectionId)))[0] ?? null)
    : null;
  const [reporter] = issue.reportedBy
    ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, issue.reportedBy))
    : [];
  const [approver] = issue.approvedBy
    ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, issue.approvedBy))
    : [];

  const esc = (v: string | null | undefined) => escapeHtml(orFallback(v, "—"));
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;
  const identityHeader = await getOfficialHeader();

  // الصور المرفقة تُضمَّن محلياً — لا روابط شبكية في وثيقة تُرسل خارجياً
  const photoImgs: string[] = [];
  for (const fileId of (issue.photos ?? []).slice(0, 4)) {
    try {
      const stored = await readStoredFile(fileId);
      if (stored && stored.file.mime.startsWith("image/")) {
        photoImgs.push(
          `<img class="evidence-img" src="data:${stored.file.mime};base64,${stored.data.toString("base64")}" alt="صورة البلاغ">`,
        );
      }
    } catch {
      // صورة متعذرة لا تمنع الخطاب
    }
  }
  const attachmentNames = await Promise.all(
    (issue.photos ?? []).map(async (fileId) => {
      const [f] = await db.select({ name: storedFiles.originalName }).from(storedFiles).where(eq(storedFiles.id, fileId));
      return f?.name ?? null;
    }),
  );

  const row = (label: string, value: string | null | undefined) =>
    `<tr><th style="width:24%">${escapeHtml(label)}</th><td>${esc(value)}</td></tr>`;

  const location = [floor?.nameAr, room ? `${room.nameAr} (${room.code})` : null, asset ? `الأصل: ${asset.nameAr} (${asset.code})` : null]
    .filter(Boolean)
    .join(" — ");

  const body = `
    <p>الجهة المكرمة: <strong>${esc(issue.sentTo ?? "شركة الصيانة / الجهة المسؤولة")}</strong></p>
    <p>السلام عليكم ورحمة الله وبركاته، نأمل منكم معالجة البلاغ الموضح أدناه وإفادتنا بما يتم.</p>
    <table>
      ${row("رقم البلاغ المرجعي", issue.code)}
      ${row("عنوان البلاغ", issue.title)}
      ${row("الموقع", location || null)}
      ${row("وصف المشكلة", issue.description)}
      ${row("الأولوية", issue.priority)}
      ${
        finding
          ? row(
              "مصدر البلاغ",
              `ملاحظة فحص: «${finding.label}»${inspection?.inspectionDate ? ` — فحص بتاريخ ${dualNumericCell(inspection.inspectionDate)}` : ""}`,
            )
          : row("مصدر البلاغ", "بلاغ مباشر")
      }
      ${finding ? row("أثر السلامة", finding.critical ? "حرج — يمس سلامة مستخدمي المبنى" : `درجة الخطورة: ${finding.severity}`) : ""}
      ${row("الإجراء المطلوب", "الكشف والمعالجة وإفادتنا بالنتيجة")}
      ${row("المبلِّغ", reporter?.name ?? null)}
      ${row(
        "اعتماد المدير",
        issue.approvedAt ? `${approver?.name ?? "—"} — ${toGregorianNumeric(issue.approvedAt)}م` : null,
      )}
      ${row("تاريخ الإرسال", issue.sentAt ? dualNumericCell(issue.sentAt) : null)}
      ${row("للتواصل", identityHeader.resolved.schoolName)}
    </table>
    ${photoImgs.length ? `<h2>الصور</h2>${photoImgs.join("\n")}` : ""}
    ${
      attachmentNames.filter(Boolean).length
        ? `<h2>قائمة المرفقات</h2><ul>${attachmentNames
            .filter((n): n is string => !!n)
            .map((n) => `<li>${escapeHtml(n)}</li>`)
            .join("")}</ul>`
        : ""
    }
    <h2>المتابعة</h2>
    <table>
      <tr><th style="width:24%">تاريخ الزيارة</th><td>${issue.visitDate ? escapeHtml(dualNumericCell(issue.visitDate)) : ""}</td></tr>
      <tr><th>الإجراء المتخذ</th><td>${issue.actionTaken ? esc(issue.actionTaken) : ""}</td></tr>
    </table>
    <h2>النتيجة النهائية</h2>
    <table>
      <tr><th style="width:24%">النتيجة</th><td>${issue.resolution ? esc(issue.resolution) : "☐ تم الإصلاح &nbsp;&nbsp; ☐ لم يتم الإصلاح"}</td></tr>
      <tr><th>ملاحظات الإغلاق</th><td>${issue.closureReason ? esc(issue.closureReason) : ""}</td></tr>
    </table>
  `;

  const title = `خطاب بلاغ صيانة — ${issue.code}`;
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, identity: identityHeader });
  const doc = await issueDocument({
    docType: "maintenance_letter",
    title,
    entityType: "maintenance",
    entityId: issue.id,
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
  // ربط الخطاب بالبلاغ للمتابعة — آخر خطاب مولَّد
  await db.update(maintenanceIssues).set({ documentId: doc.id, updatedAt: new Date() }).where(eq(maintenanceIssues.id, issue.id));
  return { documentId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

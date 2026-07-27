import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { floors, rooms, assets, inspections, maintenanceIssues, documents } from "@/db/schema";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { issueDocument } from "@/lib/documents";
import { saveUploadedFile } from "@/lib/storage";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback } from "@/lib/format";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** بيانات تقرير المبنى (مجمع البنين): الغرف والأبعاد، الأصول، الفحوص والجاهزية، الصيانة. */
export async function collectBuildingReportData() {
  const flrs = await db.select().from(floors).where(eq(floors.zoneKey, "boys")).orderBy(asc(floors.sortOrder));
  const floorIds = flrs.map((f) => f.id);
  const floorName = new Map(flrs.map((f) => [f.id, f.nameAr]));
  const rms = floorIds.length ? await db.select().from(rooms).where(inArray(rooms.floorId, floorIds)).orderBy(asc(rooms.code)) : [];
  const roomIds = rms.map((r) => r.id);
  const roomName = new Map(rms.map((r) => [r.id, `${orFallback(r.nameAr)} (${r.code})`]));
  const asts = roomIds.length ? await db.select().from(assets).where(inArray(assets.roomId, roomIds)) : [];
  const insp = roomIds.length ? await db.select().from(inspections).where(inArray(inspections.roomId, roomIds)) : [];
  const maint = roomIds.length ? await db.select().from(maintenanceIssues).where(inArray(maintenanceIssues.roomId, roomIds)) : [];
  return { flrs, rms, asts, insp, maint, floorName, roomName };
}

export async function generateBuildingReport(opts: { issuedBy: string }) {
  const { flrs, rms, asts, insp, maint, floorName, roomName } = await collectBuildingReportData();
  const now = new Date();
  const issuedAtText = `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`;

  const roomsByFloor = new Map<string, typeof rms>();
  for (const r of rms) {
    const arr = roomsByFloor.get(r.floorId) ?? [];
    arr.push(r);
    roomsByFloor.set(r.floorId, arr);
  }

  let body = `<p>مجمع البنين — مخطط تشغيلي وليس رسماً هندسياً معتمداً · الإحداثيات: 17.2484051، 43.0609594 · مجمع البنات سياق جغرافي فقط.</p>
  <h2>الغرف والأبعاد (${rms.length})</h2>`;
  for (const f of flrs) {
    const list = roomsByFloor.get(f.id) ?? [];
    if (list.length === 0) continue;
    body += `<h3>${esc(f.nameAr)}</h3>
    <table>
      <tr><th>الرمز</th><th>الاسم</th><th>النوع</th><th>الطول×العرض</th><th>المساحة</th><th>السعة</th></tr>
      ${list
        .map(
          (r) =>
            `<tr><td>${esc(r.code)}</td><td>${esc(orFallback(r.nameAr))}</td><td>${esc(orFallback(r.roomType))}</td><td>${r.lengthM && r.widthM ? `${Number(r.lengthM)}×${Number(r.widthM)}م` : "—"}</td><td>${r.areaM2 ? `${Number(r.areaM2)} م²` : "—"}</td><td>${r.capacity ?? "—"}</td></tr>`,
        )
        .join("")}
    </table>`;
  }

  body += `<h2>الأصول (${asts.length})</h2>
  <table>
    <tr><th>الرمز</th><th>الاسم</th><th>الفئة</th><th>الغرفة</th><th>الكمية</th><th>الحالة</th></tr>
    ${asts.map((a) => `<tr><td>${esc(a.code)}</td><td>${esc(orFallback(a.nameAr))}</td><td>${esc(a.category ?? "—")}</td><td>${esc(a.roomId ? roomName.get(a.roomId) ?? "—" : "—")}</td><td>${a.quantity}</td><td>${esc(a.condition)}</td></tr>`).join("")}
    ${asts.length === 0 ? `<tr><td colspan="6">لا أصول مسجلة</td></tr>` : ""}
  </table>

  <h2>الفحوص والجاهزية (${insp.length})</h2>
  <table>
    <tr><th>الغرفة</th><th>التاريخ</th><th>الحالة</th><th>البنود المطابقة</th></tr>
    ${insp
      .map((i) => {
        const results = (i.results ?? []) as { ok: boolean }[];
        const ok = results.filter((x) => x.ok).length;
        return `<tr><td>${esc(roomName.get(i.roomId) ?? "—")}</td><td>${i.inspectionDate.toLocaleDateString("ar-SA-u-nu-latn")}</td><td>${esc(i.status)}</td><td>${ok}/${results.length}</td></tr>`;
      })
      .join("")}
    ${insp.length === 0 ? `<tr><td colspan="4">لا فحوص</td></tr>` : ""}
  </table>

  <h2>بلاغات الصيانة — المفتوحة والمكتملة (${maint.length})</h2>
  <table>
    <tr><th>الرمز</th><th>العنوان</th><th>الغرفة</th><th>الأولوية</th><th>الحالة</th></tr>
    ${maint.map((m) => `<tr><td>${esc(m.code)}</td><td>${esc(orFallback(m.title))}</td><td>${esc(m.roomId ? roomName.get(m.roomId) ?? "—" : "—")}</td><td>${esc(m.priority)}</td><td>${esc(m.status)}</td></tr>`).join("")}
    ${maint.length === 0 ? `<tr><td colspan="5">لا بلاغات</td></tr>` : ""}
  </table>`;

  const title = "تقرير المبنى المدرسي (مجمع البنين)";
  const preliminaryHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText });
  const doc = await issueDocument({ docType: "building_report", title, entityType: "building", htmlSnapshot: preliminaryHtml, withSignature: false, withStamp: false, issuedBy: opts.issuedBy });
  const finalHtml = officialPageHtml({ title, bodyHtml: body, issuedAtText, docNumber: doc.docNumber, verificationCode: doc.verificationCode });
  const pdf = await htmlToPdf(finalHtml);
  const pdfFile = await saveUploadedFile({ originalName: `${doc.docNumber}.pdf`, mime: "application/pdf", data: pdf, scope: "reports", uploadedBy: opts.issuedBy });
  await db.update(documents).set({ htmlSnapshot: finalHtml, pdfFileId: pdfFile.id }).where(eq(documents.id, doc.id));
  return { docId: doc.id, docNumber: doc.docNumber, pdfFileId: pdfFile.id };
}

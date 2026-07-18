import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { collectBuildingReportData } from "@/lib/reports/building-report";
import { audit } from "@/lib/audit";

/** تصدير Excel لتقرير المبنى: أوراق الغرف والأصول والفحوص والصيانة (مجمع البنين) */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.generate") || !user.permissions.has("building.read")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }
  const { rms, asts, insp, maint, floorName, roomName } = await collectBuildingReportData();
  const wb = new ExcelJS.Workbook();

  const wsR = wb.addWorksheet("الغرف والأبعاد", { views: [{ rightToLeft: true }] });
  wsR.columns = [
    { header: "الرمز", key: "code", width: 14 },
    { header: "الاسم", key: "name", width: 26 },
    { header: "الطابق", key: "floor", width: 16 },
    { header: "النوع", key: "type", width: 14 },
    { header: "الطول (م)", key: "len", width: 12 },
    { header: "العرض (م)", key: "wid", width: 12 },
    { header: "المساحة (م²)", key: "area", width: 14 },
    { header: "السعة", key: "cap", width: 8 },
  ];
  wsR.getRow(1).font = { bold: true };
  for (const r of rms) wsR.addRow({ code: r.code, name: r.nameAr, floor: floorName.get(r.floorId) ?? "—", type: r.roomType, len: r.lengthM ? Number(r.lengthM) : "—", wid: r.widthM ? Number(r.widthM) : "—", area: r.areaM2 ? Number(r.areaM2) : "—", cap: r.capacity ?? "—" });

  const wsA = wb.addWorksheet("الأصول", { views: [{ rightToLeft: true }] });
  wsA.columns = [
    { header: "الرمز", key: "code", width: 14 },
    { header: "الاسم", key: "name", width: 26 },
    { header: "الفئة", key: "cat", width: 16 },
    { header: "الغرفة", key: "room", width: 24 },
    { header: "الكمية", key: "qty", width: 8 },
    { header: "الحالة", key: "cond", width: 14 },
  ];
  wsA.getRow(1).font = { bold: true };
  for (const a of asts) wsA.addRow({ code: a.code, name: a.nameAr, cat: a.category ?? "—", room: a.roomId ? roomName.get(a.roomId) ?? "—" : "—", qty: a.quantity, cond: a.condition });

  const wsI = wb.addWorksheet("الفحوص والجاهزية", { views: [{ rightToLeft: true }] });
  wsI.columns = [
    { header: "الغرفة", key: "room", width: 24 },
    { header: "التاريخ", key: "date", width: 14 },
    { header: "الحالة", key: "status", width: 14 },
    { header: "المطابق", key: "ok", width: 10 },
  ];
  wsI.getRow(1).font = { bold: true };
  for (const i of insp) {
    const results = (i.results ?? []) as { ok: boolean }[];
    wsI.addRow({ room: roomName.get(i.roomId) ?? "—", date: i.inspectionDate.toISOString().slice(0, 10), status: i.status, ok: `${results.filter((x) => x.ok).length}/${results.length}` });
  }

  const wsM = wb.addWorksheet("الصيانة", { views: [{ rightToLeft: true }] });
  wsM.columns = [
    { header: "الرمز", key: "code", width: 14 },
    { header: "العنوان", key: "title", width: 30 },
    { header: "الغرفة", key: "room", width: 24 },
    { header: "الأولوية", key: "priority", width: 12 },
    { header: "الحالة", key: "status", width: 16 },
  ];
  wsM.getRow(1).font = { bold: true };
  for (const m of maint) wsM.addRow({ code: m.code, title: m.title, room: m.roomId ? roomName.get(m.roomId) ?? "—" : "—", priority: m.priority, status: m.status });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await audit({ actorId: user.id, action: "export.building_xlsx", summary: "تصدير Excel لتقرير المبنى" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("تقرير_المبنى.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}

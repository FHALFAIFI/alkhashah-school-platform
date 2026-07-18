import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildWordReport } from "@/lib/reports/word-export";
import { collectBuildingReportData } from "@/lib/reports/building-report";
import { audit } from "@/lib/audit";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";

/** تصدير تقرير المبنى Word: الغرف والأبعاد، الأصول، الفحوص، الصيانة (مجمع البنين) */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.generate") || !user.permissions.has("building.read")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }
  const { flrs, rms, asts, insp, maint, floorName, roomName } = await collectBuildingReportData();
  const now = new Date();
  const buf = await buildWordReport({
    title: "تقرير المبنى المدرسي (مجمع البنين)",
    meta: [
      ["تاريخ الإصدار", `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`],
      ["الإحداثيات", "17.2484051، 43.0609594"],
      ["ملاحظة", "مخطط تشغيلي وليس رسماً هندسياً معتمداً — مجمع البنات سياق جغرافي فقط"],
    ],
    sections: [
      {
        heading: "الغرف والأبعاد",
        table: {
          headers: ["الرمز", "الاسم", "الطابق", "النوع", "الطول×العرض", "المساحة"],
          rows: rms.map((r) => [
            r.code,
            r.nameAr,
            floorName.get(r.floorId) ?? "—",
            r.roomType,
            r.lengthM && r.widthM ? `${Number(r.lengthM)}×${Number(r.widthM)}م` : "—",
            r.areaM2 ? `${Number(r.areaM2)} م²` : "—",
          ]),
        },
      },
      { heading: "الأصول", table: { headers: ["الرمز", "الاسم", "الفئة", "الغرفة", "الكمية", "الحالة"], rows: asts.map((a) => [a.code, a.nameAr, a.category ?? "—", a.roomId ? roomName.get(a.roomId) ?? "—" : "—", String(a.quantity), a.condition]) } },
      {
        heading: "الفحوص والجاهزية",
        table: {
          headers: ["الغرفة", "التاريخ", "الحالة", "المطابق"],
          rows: insp.map((i) => {
            const results = (i.results ?? []) as { ok: boolean }[];
            return [roomName.get(i.roomId) ?? "—", i.inspectionDate.toLocaleDateString("ar-SA-u-nu-latn"), i.status, `${results.filter((x) => x.ok).length}/${results.length}`];
          }),
        },
      },
      { heading: "بلاغات الصيانة (المفتوحة والمكتملة)", table: { headers: ["الرمز", "العنوان", "الغرفة", "الأولوية", "الحالة"], rows: maint.map((m) => [m.code, m.title, m.roomId ? roomName.get(m.roomId) ?? "—" : "—", m.priority, m.status]) } },
    ],
  });
  void flrs;
  await audit({ actorId: user.id, action: "export.building_docx", summary: "تصدير Word لتقرير المبنى" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("تقرير_المبنى.docx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}

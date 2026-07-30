import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { reportByKey, isSortableColumn, type ReportFilters } from "@/lib/reports/catalog";
import { runReportForExport } from "@/lib/reports/loaders";
import { toCsv, safeFileName, sanitizeCell, MAX_EXPORT_ROWS } from "@/lib/reports/export-safety";
import { dualNumericCell } from "@/lib/dates";

/**
 * تصدير تقارير مركز التقارير (v2.2 §D10/§10).
 *
 * الضمانات:
 *  - المصادقة والتفويض على حدود الخادم: تسجيل دخول + `reports.generate` + صلاحية التقرير
 *    نفسه المعلَنة في السجل. لا يكفي إخفاء زر التصدير.
 *  - الأعمدة من تعريف التقرير حصراً — لا يختار المستخدم أعمدة، فلا يُكشف حقل غير معلَن.
 *  - كل خلية تمرّ بمعطِّل حقن الصيغ قبل الكتابة في CSV أو Excel.
 *  - سقف صفوف صريح يمنع التصدير غير المحدود، ويُبلَّغ عنه بدل الاقتطاع الصامت.
 *  - كل تصدير يُسجَّل في سجل التدقيق (من، أي تقرير، أي صيغة، كم صفاً).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.read") || !user.permissions.has("reports.generate")) {
    return NextResponse.json({ error: "لا تملك صلاحية تصدير التقارير" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const reportKey = sp.get("report") ?? "";
  const def = reportByKey(reportKey);
  if (!def) return NextResponse.json({ error: "تقرير غير معروف" }, { status: 404 });
  // صلاحية التقرير نفسه — تُفحص بعد وجوده وقبل أي استعلام
  if (!user.permissions.has(def.permission)) {
    return NextResponse.json({ error: "لا تملك صلاحية هذا التقرير" }, { status: 403 });
  }

  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const sort = sp.get("sort");
  const filters: ReportFilters = {
    search: sp.get("search") ?? undefined,
    dateFrom: sp.get("dateFrom") ?? undefined,
    dateTo: sp.get("dateTo") ?? undefined,
    status: sp.get("status") ?? undefined,
    personId: sp.get("personId") ?? undefined,
    itemId: sp.get("itemId") ?? undefined,
    // الترتيب مقيَّد بأعمدة التقرير — لا يمر اسم عمود عشوائي من عنوان URL
    sort: sort && isSortableColumn(reportKey, sort) ? sort : undefined,
    dir: sp.get("dir") === "desc" ? "desc" : "asc",
  };

  let rows: Awaited<ReturnType<typeof runReportForExport>>;
  try {
    rows = await runReportForExport(reportKey, filters);
  } catch {
    // لا تُعاد رسالة قاعدة البيانات ولا أثر المكدس إلى المتصفّح
    return NextResponse.json({ error: "تعذّر توليد التقرير" }, { status: 500 });
  }

  const headers = def.columns.map((c) => c.label);
  // أعمدة التاريخ تُصدَّر بالعرض المزدوج نفسه الظاهر على الشاشة — D-033
  const cellOf = (row: Record<string, unknown>, c: (typeof def.columns)[number]) => {
    const v = row[c.key];
    if (v === null || v === undefined || v === "") return "";
    if (c.type === "date" && (typeof v === "string" || v instanceof Date)) return dualNumericCell(v);
    return v as string | number;
  };
  const matrix = rows.rows.map((row) => def.columns.map((c) => cellOf(row, c)));

  await audit({
    actorId: user.id,
    action: "report.exported",
    entityType: "report",
    entityId: def.key,
    summary: `تصدير «${def.label}» بصيغة ${format === "xlsx" ? "Excel" : "CSV"} — ${rows.rows.length} صف${rows.truncated ? ` (اقتُطع عند ${MAX_EXPORT_ROWS})` : ""}`,
  });

  const fileName = safeFileName(def.label, format);
  // ترميز RFC 5987 للاسم العربي، مع بديل ASCII بسيط للمتصفّحات القديمة
  const disposition = `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

  if (format === "csv") {
    const csv = toCsv(headers, matrix);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition,
        // التقارير قد تحوي بيانات مدرسية — لا تُخزَّن في وسيط مشترك
        "Cache-Control": "no-store",
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("التقرير", { views: [{ rightToLeft: true }] });
  ws.columns = def.columns.map((c) => ({ header: c.label, key: c.key, width: 20 }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows.rows) {
    // كل قيمة نصية تمرّ بمعطِّل حقن الصيغ؛ الأرقام تُكتب أرقاماً فتبقى قابلة للحساب
    const record: Record<string, string | number> = {};
    for (const c of def.columns) {
      const v = cellOf(row, c);
      record[c.key] = typeof v === "number" ? v : sanitizeCell(v);
    }
    ws.addRow(record);
  }
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}

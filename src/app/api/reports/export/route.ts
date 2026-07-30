import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { reportByKey, isSortableColumn, type ReportFilters } from "@/lib/reports/catalog";
import { runReportForExport } from "@/lib/reports/loaders";
import { toCsv, safeFileName, sanitizeCell, MAX_EXPORT_ROWS } from "@/lib/reports/export-safety";
import { dualNumericCell, todayIso } from "@/lib/dates";
import { officialPageHtml, htmlToPdf } from "@/lib/pdf";
import { getOfficialHeader } from "@/lib/document-header";
import { buildWordReport } from "@/lib/reports/word-export";
import { escapeHtml } from "@/lib/html-escape";

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

  const FORMATS = ["csv", "xlsx", "pdf", "docx"] as const;
  const requested = sp.get("format") ?? "csv";
  const format = (FORMATS as readonly string[]).includes(requested) ? (requested as (typeof FORMATS)[number]) : "csv";
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

  const formatLabel = { csv: "CSV", xlsx: "Excel", pdf: "PDF", docx: "Word" }[format];
  await audit({
    actorId: user.id,
    action: "report.exported",
    entityType: "report",
    entityId: def.key,
    summary: `تصدير «${def.label}» بصيغة ${formatLabel} — ${rows.rows.length} صف${rows.truncated ? ` (اقتُطع عند ${MAX_EXPORT_ROWS})` : ""}`,
  });

  // المرشّحات الفعّالة تُعرض داخل التقرير المولَّد (v2.3 §7)
  const activeFilters: [string, string][] = [];
  if (filters.search) activeFilters.push(["بحث", filters.search]);
  if (filters.dateFrom) activeFilters.push(["من تاريخ", dualNumericCell(filters.dateFrom)]);
  if (filters.dateTo) activeFilters.push(["إلى تاريخ", dualNumericCell(filters.dateTo)]);
  if (filters.status) activeFilters.push(["الحالة", filters.status]);

  // اسم الملف: نوع التقرير + اسم المدرسة + تاريخ التوليد (v2.3 §7)
  const identityHeader = format === "pdf" || format === "docx" ? await getOfficialHeader() : null;
  const schoolName = identityHeader?.resolved.schoolName ?? "";
  const fileName = safeFileName(
    [def.label, schoolName, todayIso()].filter(Boolean).join(" — "),
    format,
  );
  // ترميز RFC 5987 للاسم العربي، مع بديل ASCII بسيط للمتصفّحات القديمة
  const disposition = `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const noStore = { "Cache-Control": "no-store" };

  if (format === "csv") {
    const csv = toCsv(headers, matrix);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition,
        // التقارير قد تحوي بيانات مدرسية — لا تُخزَّن في وسيط مشترك
        ...noStore,
      },
    });
  }

  if (format === "pdf") {
    // معاينة مولَّدة لا وثيقة مُصدَرة: بلا رقم وثيقة ولا لقطة (v2.3 §7 — المسودات تُعاد
    // دون أن تصبح إصدارات). الجداول الطويلة: ترويسة الجدول تتكرر مع كل صفحة (thead)
    // وأرقام الصفحات من مولّد PDF نفسه.
    const filtersHtml = activeFilters.length
      ? `<p class="meta">المرشّحات الفعّالة: ${activeFilters
          .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
          .join(" · ")}</p>`
      : "";
    const truncNote = rows.truncated
      ? `<p class="truncation-note">اقتُطع التقرير عند ${MAX_EXPORT_ROWS} صف — ضيّق المرشّحات للاطلاع على البقية.</p>`
      : "";
    const tableHtml = `
      <table>
        <thead><tr>${def.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
        <tbody>
          ${matrix
            .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c === "" ? "—" : c))}</td>`).join("")}</tr>`)
            .join("\n")}
        </tbody>
      </table>`;
    const bodyHtml = `
      <p class="meta">${escapeHtml(def.description)}</p>
      ${filtersHtml}
      <p class="meta">عدد الصفوف: ${rows.rows.length} — توليد بتاريخ ${escapeHtml(dualNumericCell(todayIso()))}</p>
      ${truncNote}
      ${tableHtml}`;
    const html = officialPageHtml({
      title: def.label,
      bodyHtml,
      issuedAtText: dualNumericCell(todayIso()),
      identity: identityHeader ?? undefined,
    });
    const pdf = await htmlToPdf(html, { pageNumbers: true });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        ...noStore,
      },
    });
  }

  if (format === "docx") {
    const buffer = await buildWordReport({
      title: def.label,
      meta: [
        ...activeFilters,
        ["عدد الصفوف", String(rows.rows.length)],
        ["تاريخ التوليد", dualNumericCell(todayIso())],
      ],
      sections: [
        {
          heading: def.label,
          paragraphs: [def.description],
          table: { headers, rows: matrix.map((r) => r.map((c) => String(c === "" ? "—" : c))) },
        },
      ],
      header: identityHeader
        ? {
            orgLines: identityHeader.resolved.orgLines,
            principalName: identityHeader.resolved.principalName,
            principalTitle: identityHeader.resolved.principalTitle,
            academicYear: identityHeader.resolved.academicYear,
            footerNote: identityHeader.resolved.footerNote,
          }
        : undefined,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": disposition,
        ...noStore,
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

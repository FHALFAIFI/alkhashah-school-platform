import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { listFeedback, type FeedbackFilters } from "@/lib/feedback/service";
import { orFallback } from "@/lib/format";

function parseDate(s: string | null): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T00:00:00.000Z");
  return isNaN(d.getTime()) ? undefined : d;
}

/** تصدير Excel لملاحظات التشغيل محافظاً على المرشّحات — لأدوار الإدارة المخوَّلة فقط */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("feedback.manage")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const archivedRaw = q.get("archived") ?? "active";
  const to = parseDate(q.get("to"));
  const filters: FeedbackFilters = {
    module: q.get("module") || undefined,
    category: q.get("category") || undefined,
    severity: q.get("severity") || undefined,
    status: q.get("status") || undefined,
    from: parseDate(q.get("from")),
    to: to ? new Date(to.getTime() + 24 * 3600 * 1000 - 1) : undefined,
    archived: (["all", "active", "archived"].includes(archivedRaw) ? archivedRaw : "active") as
      | "all"
      | "active"
      | "archived",
  };

  const rows = await listFeedback(filters);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ملاحظات التشغيل", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: "الرقم", key: "ref", width: 12 },
    { header: "العنوان", key: "title", width: 36 },
    { header: "الوحدة", key: "module", width: 18 },
    { header: "الفئة", key: "category", width: 16 },
    { header: "الأهمية", key: "severity", width: 18 },
    { header: "الحالة", key: "status", width: 16 },
    { header: "يعيق العمل", key: "blocked", width: 12 },
    { header: "المُرسِل", key: "by", width: 20 },
    { header: "الصفحة", key: "path", width: 28 },
    { header: "التاريخ (هجري)", key: "hijri", width: 20 },
    { header: "التاريخ (ميلادي)", key: "greg", width: 16 },
    { header: "مؤرشفة", key: "archived", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      ref: r.ref,
      title: orFallback(r.title),
      module: r.module,
      category: r.category,
      severity: r.severity,
      status: r.status,
      blocked: r.blocked ? "نعم" : "لا",
      by: r.createdByName ?? "—",
      path: r.pagePath,
      hijri: new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "medium" }).format(r.createdAt),
      greg: new Intl.DateTimeFormat("en-GB", { dateStyle: "short" }).format(r.createdAt),
      archived: r.archivedAt ? "نعم" : "لا",
    });
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await audit({
    actorId: user.id,
    action: "export.feedback_xlsx",
    entityType: "feedback",
    summary: `تصدير Excel لملاحظات التشغيل (${rows.length} سجل)`,
  });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("ملاحظات_التشغيل.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}

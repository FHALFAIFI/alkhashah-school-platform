import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { programs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { programsEvidenceSummary } from "@/lib/plan/program-service";

/** تصدير Excel تحليلي للخطة التشغيلية — التقدم مباشر من البرنامج وعدد الشواهد فعلي (D-024/D-025) */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("plan.read") || !user.permissions.has("reports.generate")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }

  const excluded = await getExcludedIdSets();
  const allPrograms = await db.select().from(programs).where(notSynthetic(programs.id, excluded.programs)).orderBy(asc(programs.seq));
  const evidenceByProgram = await programsEvidenceSummary(allPrograms.map((p) => p.id));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("البرامج", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: "م", key: "seq", width: 6 },
    { header: "المجال", key: "domain", width: 20 },
    { header: "البرنامج", key: "name", width: 32 },
    { header: "مسؤول التنفيذ", key: "owner", width: 18 },
    { header: "تاريخ البدء (هجري)", key: "start", width: 16 },
    { header: "تاريخ الانتهاء (هجري)", key: "end", width: 16 },
    { header: "نسبة الإنجاز", key: "progress", width: 12 },
    { header: "حالة التنفيذ", key: "execution", width: 14 },
    { header: "الحالة", key: "status", width: 12 },
    { header: "عدد الشواهد", key: "evidence", width: 12 },
    { header: "الميزانية", key: "budget", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const p of allPrograms) {
    ws.addRow({
      seq: p.seq,
      domain: p.domain,
      name: p.name,
      owner: p.ownerPosition,
      start: p.hijriStart,
      end: p.hijriEnd,
      progress: p.progress / 100,
      execution: p.executionStatus,
      status: p.status,
      evidence: evidenceByProgram.get(p.id)?.count ?? 0,
      budget: p.budget ? Number(p.budget) : 0,
    });
  }
  ws.getColumn("progress").numFmt = "0%";

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await audit({ actorId: user.id, action: "export.plan_xlsx", summary: "تصدير Excel تحليلي للخطة" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("الخطة_التشغيلية_تحليلي.xlsx")}`,
      "Cache-Control": "private, no-store",
    },
  });
}

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { programs, programMilestones } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

/** تصدير Excel تحليلي للخطة التشغيلية */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("plan.read") || !user.permissions.has("reports.generate")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }

  const [allPrograms, allMilestones] = await Promise.all([
    db.select().from(programs).orderBy(asc(programs.seq)),
    db.select().from(programMilestones),
  ]);

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
    { header: "الحالة", key: "status", width: 12 },
    { header: "عدد المعالم", key: "milestones", width: 12 },
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
      status: p.status,
      milestones: allMilestones.filter((m) => m.programId === p.id).length,
      budget: p.budget ? Number(p.budget) : 0,
    });
  }
  ws.getColumn("progress").numFmt = "0%";

  const ws2 = wb.addWorksheet("المعالم", { views: [{ rightToLeft: true }] });
  ws2.columns = [
    { header: "البرنامج", key: "program", width: 32 },
    { header: "المعلم", key: "title", width: 40 },
    { header: "الوزن", key: "weight", width: 10 },
    { header: "الإنجاز", key: "progress", width: 10 },
    { header: "الحالة", key: "status", width: 14 },
  ];
  ws2.getRow(1).font = { bold: true };
  const programName = new Map(allPrograms.map((p) => [p.id, p.name]));
  for (const m of allMilestones) {
    ws2.addRow({
      program: programName.get(m.programId) ?? "",
      title: m.title,
      weight: m.weight / 100,
      progress: m.progress / 100,
      status: m.status,
    });
  }
  ws2.getColumn("weight").numFmt = "0%";
  ws2.getColumn("progress").numFmt = "0%";

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

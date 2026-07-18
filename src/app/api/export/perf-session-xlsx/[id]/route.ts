import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { weightedScore } from "@/lib/performance/scoring";
import { audit } from "@/lib/audit";

/** تصدير Excel لجلسة الأداء — التقديرات والدرجات الموزونة (حساب الخادم حصراً) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.generate") || !user.permissions.has("performance.individual.read")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });

  const [session] = await db.select().from(perfSessions).where(eq(perfSessions.id, id));
  if (!session) return NextResponse.json({ error: "الجلسة غير موجودة" }, { status: 404 });
  const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, session.cycleId));
  const [person] = await db.select().from(people).where(eq(people.id, cycle.personId));
  const snapshot = cycle.modelSnapshot as { model: { nameAr: string }; indicators: { id: string; nameAr: string; weight: string }[] };
  const ratings = await db.select().from(perfRatings).where(eq(perfRatings.sessionId, id));
  const ratingBy = new Map(ratings.map((r) => [r.indicatorId, r]));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("التقديرات", { views: [{ rightToLeft: true }] });
  ws.columns = [
    { header: "المؤشر", key: "name", width: 44 },
    { header: "الوزن", key: "weight", width: 10 },
    { header: "التقدير (1–5)", key: "rating", width: 14 },
    { header: "الدرجة الموزونة", key: "score", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  let totalScore = 0;
  for (const ind of snapshot.indicators) {
    const r = ratingBy.get(ind.id);
    const weight = Number(ind.weight);
    const score = r?.rating != null ? weightedScore(r.rating, weight) : null;
    if (score !== null) totalScore += score;
    ws.addRow({ name: ind.nameAr, weight: weight / 100, rating: r?.rating ?? "—", score: score != null ? score / 100 : "—" });
  }
  ws.addRow({ name: "الإجمالي", weight: "", rating: "", score: session.sessionResult != null ? Number(session.sessionResult) / 100 : Math.round(totalScore) / 100 });
  ws.getColumn("weight").numFmt = "0%";
  ws.getColumn("score").numFmt = "0%";

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await audit({ actorId: user.id, action: "export.perf_session_xlsx", entityType: "perf_session", entityId: id, summary: `تصدير Excel لجلسة أداء ${person.fullName}` });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`جلسة_${person.fullName}.xlsx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

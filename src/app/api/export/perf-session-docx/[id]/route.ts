import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { buildWordReport } from "@/lib/reports/word-export";
import { getWordHeader } from "@/lib/document-header";
import { weightedScore } from "@/lib/performance/scoring";
import { audit } from "@/lib/audit";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";
import { orFallback } from "@/lib/format";

/** تصدير تقرير جلسة الأداء Word قابل للتحرير — التقديرات والدرجات الموزونة (حساب الخادم) */
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

  let totalWeight = 0;
  let totalScore = 0;
  const rows = snapshot.indicators.map((ind) => {
    const r = ratingBy.get(ind.id);
    const weight = Number(ind.weight);
    totalWeight += weight;
    const score = r?.rating != null ? weightedScore(r.rating, weight) : null;
    if (score !== null) totalScore += score;
    return [orFallback(ind.nameAr), `${weight}٪`, r?.rating != null ? String(r.rating) : "—", score != null ? `${score}٪` : "—"];
  });
  rows.push(["الإجمالي", `${totalWeight}٪`, "", `${Math.round(totalScore * 100) / 100}٪`]);

  const now = new Date();
  const buf = await buildWordReport({
    // v2.4 §15: الهوية الرسمية المركزية بدل السطر الثابت الاحتياطي
    header: await getWordHeader(),
    title: `تقرير جلسة أداء: ${person.fullName}`,
    meta: [
      ["تاريخ الإصدار", `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`],
      ["النموذج", orFallback(snapshot.model.nameAr)],
      ["نوع الجلسة", session.sessionType],
      ["تاريخ الجلسة", session.sessionDate ?? "—"],
      ["النتيجة", session.sessionResult != null ? `${session.sessionResult}٪` : "—"],
    ],
    sections: [
      { heading: "التقديرات (التقدير 1–5 × الوزن ÷ 5 = الدرجة الموزونة)", table: { headers: ["المؤشر", "الوزن", "التقدير", "الدرجة الموزونة"], rows } },
      {
        heading: "ملاحظات الجلسة",
        paragraphs: [
          session.notes ? `الملاحظات: ${session.notes}` : "",
          session.strengths ? `مواطن القوة: ${session.strengths}` : "",
          session.improvementAreas ? `مجالات التحسين: ${session.improvementAreas}` : "",
          session.actionsText ? `التوصيات: ${session.actionsText}` : "",
        ].filter(Boolean),
      },
    ],
  });

  await audit({ actorId: user.id, action: "export.perf_session_docx", entityType: "perf_session", entityId: id, summary: `تصدير Word لجلسة أداء ${person.fullName}` });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`تقرير_جلسة_${person.fullName}.docx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

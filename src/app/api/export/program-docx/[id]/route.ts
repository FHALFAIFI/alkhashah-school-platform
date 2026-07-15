import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { programs, programMilestones, programDeliverables } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { buildWordReport } from "@/lib/reports/word-export";
import { audit } from "@/lib/audit";
import { toHijriNumeric, toGregorianNumeric } from "@/lib/dates";

/** تصدير تقرير البرنامج بصيغة Word قابلة للتحرير */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.generate")) {
    return NextResponse.json({ error: "لا تملك الصلاحية" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });

  const [program] = await db.select().from(programs).where(eq(programs.id, id));
  if (!program) return NextResponse.json({ error: "البرنامج غير موجود" }, { status: 404 });
  const milestones = await db
    .select()
    .from(programMilestones)
    .where(eq(programMilestones.programId, id))
    .orderBy(asc(programMilestones.sortOrder));
  const deliverables = await db.select().from(programDeliverables).where(eq(programDeliverables.programId, id));

  const now = new Date();
  const buf = await buildWordReport({
    title: `تقرير برنامج: ${program.name}`,
    meta: [
      ["تاريخ الإصدار", `${toHijriNumeric(now)}هـ (${toGregorianNumeric(now)}م)`],
      ["المجال", program.domain],
      ["الحالة", `${program.status} — الإنجاز ${program.progress}٪`],
    ],
    sections: [
      {
        heading: "بطاقة البرنامج",
        table: {
          headers: ["البند", "القيمة"],
          rows: (
            [
              ["الهدف العام", program.generalGoal],
              ["الهدف الخاص", program.specificGoal],
              ["آلية التنفيذ", program.mechanism],
              ["مسؤول التنفيذ", program.ownerPosition],
              ["مؤشر النجاح", program.kpiText],
              ["المستهدف", program.targetText],
              ["تاريخ البدء", program.hijriStart ? `${program.hijriStart}هـ` : null],
              ["تاريخ الانتهاء", program.hijriEnd ? `${program.hijriEnd}هـ` : null],
            ] as [string, string | null][]
          )
            .filter(([, v]) => v)
            .map(([k, v]) => [k, v!]),
        },
      },
      {
        heading: "المعالم الموزونة",
        table: {
          headers: ["المعلم", "الوزن", "الإنجاز", "الحالة"],
          rows: milestones.map((m) => [m.title, `${m.weight}٪`, `${m.progress}٪`, m.status]),
        },
      },
      {
        heading: "المخرجات وحزم الشواهد",
        table: {
          headers: ["المخرج", "الشواهد المقبولة", "حالة الحزمة"],
          rows: deliverables.map((d) => [d.mainOutput ?? "—", d.acceptedEvidence ?? "—", d.packageStatus]),
        },
      },
    ],
  });

  await audit({ actorId: user.id, action: "export.program_docx", entityType: "program", entityId: id, summary: `تصدير Word لبرنامج ${program.name}` });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`تقرير_${program.name}.docx`)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

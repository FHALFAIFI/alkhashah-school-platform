import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { programs, programDeliverables } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { buildWordReport } from "@/lib/reports/word-export";
import { audit } from "@/lib/audit";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
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

  const excluded = await getExcludedIdSets();
  const [program] = await db
    .select()
    .from(programs)
    .where(and(eq(programs.id, id), notSynthetic(programs.id, excluded.programs)));
  if (!program) return NextResponse.json({ error: "البرنامج غير موجود" }, { status: 404 });
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
        heading: "المخرجات",
        table: {
          headers: ["المخرج", "الشواهد المقبولة", "موعد التسليم"],
          rows: deliverables.map((d) => [d.mainOutput ?? "—", d.acceptedEvidence ?? "—", d.dueText ?? "—"]),
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

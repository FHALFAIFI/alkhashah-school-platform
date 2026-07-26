import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { programs, evidenceItems, evidenceLinks } from "@/db/schema";

/**
 * قراءة البرنامج ومعلومات شواهده. البرنامج نفسه هو وحدة التنفيذ والمتابعة (D-024):
 * التقدم والحالة يُحفظان مباشرةً على البرنامج (`programs.progress` / `programs.executionStatus`)
 * ولا يُشتقّان من الأنشطة. جداول الأنشطة والمعالم محفوظة للتدقيق والتراجع فقط ولا تُقرأ هنا.
 */

export async function getProgram(programId: string) {
  const [program] = await db.select().from(programs).where(eq(programs.id, programId));
  return program ?? null;
}

/**
 * ملخص شواهد البرنامج — العدد الفعلي غير المؤرشف وأحدث تاريخ رفع. معلوماتي فقط:
 * لا هدف ولا حصة ولا نسبة ولا «متبقٍّ»، ولا يحدد إمكانية إكمال البرنامج (D-025).
 */
export async function programEvidenceSummary(
  programId: string,
): Promise<{ count: number; latestAt: Date | null }> {
  const [row] = await db
    .select({
      // نوع نصّي: max على timestamptz يعود سلسلةً من مشغّل pg للأعمدة المحسوبة، لا Date — نحوّله في JS
      count: sql<number>`count(*)::int`,
      latestAt: sql<string | null>`max(${evidenceItems.createdAt})`,
    })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(
      and(
        eq(evidenceLinks.entityType, "program"),
        eq(evidenceLinks.entityId, programId),
        isNull(evidenceItems.archivedAt),
      ),
    );
  return { count: row?.count ?? 0, latestAt: row?.latestAt ? new Date(row.latestAt) : null };
}

/** نسخة مجمّعة لعدة برامج — لصفحة المتابعة الأسبوعية (استعلام واحد بدل N). */
export async function programsEvidenceSummary(
  programIds: string[],
): Promise<Map<string, { count: number; latestAt: Date | null }>> {
  const map = new Map<string, { count: number; latestAt: Date | null }>();
  if (programIds.length === 0) return map;
  const rows = await db
    .select({
      entityId: evidenceLinks.entityId,
      count: sql<number>`count(*)::int`,
      latestAt: sql<string | null>`max(${evidenceItems.createdAt})`,
    })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(
      and(
        eq(evidenceLinks.entityType, "program"),
        inArray(evidenceLinks.entityId, programIds),
        isNull(evidenceItems.archivedAt),
      ),
    )
    .groupBy(evidenceLinks.entityId);
  // max(timestamptz) يعود سلسلةً للأعمدة المحسوبة — نحوّله إلى Date في JS
  for (const r of rows) map.set(r.entityId, { count: r.count, latestAt: r.latestAt ? new Date(r.latestAt) : null });
  return map;
}

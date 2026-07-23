import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { perfSessions, perfCycles, people } from "@/db/schema";

/**
 * الجلسات التي أُنجز تقييمها لكن لم يُرفع تقريرها الموقع — تظهر على لوحة الأداء.
 * «اكتمل التقييم» (evaluationCompletedAt مضبوط أو الجلسة مقيّمة) لكن signedReportFileId فارغ.
 */
export type MissingSignedReport = {
  sessionId: string;
  cycleId: string;
  sessionType: string;
  personName: string;
  evaluationCompletedAt: Date | null;
};

export async function missingSignedReports(): Promise<MissingSignedReport[]> {
  const rows = await db
    .select({
      sessionId: perfSessions.id,
      cycleId: perfSessions.cycleId,
      sessionType: perfSessions.sessionType,
      personName: people.fullName,
      evaluationCompletedAt: perfSessions.evaluationCompletedAt,
    })
    .from(perfSessions)
    .innerJoin(perfCycles, eq(perfSessions.cycleId, perfCycles.id))
    .innerJoin(people, eq(perfCycles.personId, people.id))
    .where(
      and(
        isNull(perfSessions.signedReportFileId),
        // إمّا معلّمة «اكتمل التقييم»، أو صدر تقريرها غير الموقع
        sql`(${perfSessions.evaluationCompletedAt} is not null or ${perfSessions.reportDocId} is not null)`,
      ),
    );
  return rows;
}

export async function missingSignedReportCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(perfSessions)
    .where(and(isNull(perfSessions.signedReportFileId), isNotNull(perfSessions.reportDocId)));
  return row?.c ?? 0;
}

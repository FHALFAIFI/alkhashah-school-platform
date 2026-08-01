import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  perfModels,
  perfIndicators,
  perfCycles,
  perfSessions,
  perfRatings,
  perfSignedReportVersions,
  improvementPlans,
  evidenceLinks,
  documents,
} from "@/db/schema";

/**
 * v2.4: إدارة دورة حياة نماذج الأداء (أرشفة/حذف).
 *
 * القواعد:
 * - النموذج «مستخدم» إذا ارتبطت به أي دورة تقييم — عندها الأرشفة هي المسار الوحيد
 *   (الحذف النهائي للبيانات التقييمية خارج نطاق هذا الإصدار عمداً).
 * - النموذج غير المستخدم (مسودة أو معتمد) يحذف نهائياً بعد تأكيد صريح.
 * - لا يخفى آخر نموذج معتمد نشط لفئته — تبقى الفئة بلا نموذج صالح للدورات الجديدة.
 * - الأرشفة لا تمس الدورات التاريخية: كل دورة تحمل لقطة النموذج المجمدة (modelSnapshot).
 */

export type ModelLinkedRecords = {
  indicators: number;
  /** عدد الموظفين المرتبطين (أشخاص مميزون عبر الدورات) */
  employees: number;
  cycles: number;
  sessions: number;
  ratings: number;
  improvementPlans: number;
  signedReports: number;
  evidenceLinks: number;
  documents: number;
};

/** عدّ كل السجلات المرتبطة بالنموذج — يشمل المسارات غير المباشرة (التقديرات عبر المؤشرات). */
export async function modelLinkedRecords(modelId: string): Promise<ModelLinkedRecords> {
  const [indicatorRows, cycleRows] = await Promise.all([
    db.select({ id: perfIndicators.id }).from(perfIndicators).where(eq(perfIndicators.modelId, modelId)),
    db
      .select({ id: perfCycles.id, personId: perfCycles.personId })
      .from(perfCycles)
      .where(eq(perfCycles.modelId, modelId)),
  ]);
  const indicatorIds = indicatorRows.map((r) => r.id);
  const cycleIds = cycleRows.map((r) => r.id);
  const sessionRows = cycleIds.length
    ? await db.select({ id: perfSessions.id }).from(perfSessions).where(inArray(perfSessions.cycleId, cycleIds))
    : [];
  const sessionIds = sessionRows.map((r) => r.id);

  const countWhere = async (q: Promise<{ n: number }[]> | null) => (q ? Number((await q)[0]?.n ?? 0) : 0);
  const [ratings, plans, signed, evidence, docs] = await Promise.all([
    countWhere(
      indicatorIds.length
        ? db.select({ n: count() }).from(perfRatings).where(inArray(perfRatings.indicatorId, indicatorIds))
        : null,
    ),
    countWhere(
      cycleIds.length
        ? db.select({ n: count() }).from(improvementPlans).where(inArray(improvementPlans.cycleId, cycleIds))
        : null,
    ),
    countWhere(
      sessionIds.length
        ? db
            .select({ n: count() })
            .from(perfSignedReportVersions)
            .where(inArray(perfSignedReportVersions.sessionId, sessionIds))
        : null,
    ),
    countWhere(
      sessionIds.length
        ? db
            .select({ n: count() })
            .from(evidenceLinks)
            .where(and(eq(evidenceLinks.entityType, "perf_session"), inArray(evidenceLinks.entityId, sessionIds)))
        : null,
    ),
    countWhere(
      sessionIds.length
        ? db
            .select({ n: count() })
            .from(documents)
            .where(and(eq(documents.entityType, "perf_session"), inArray(documents.entityId, sessionIds)))
        : null,
    ),
  ]);

  return {
    indicators: indicatorRows.length,
    employees: new Set(cycleRows.map((r) => r.personId)).size,
    cycles: cycleIds.length,
    sessions: sessionIds.length,
    ratings,
    improvementPlans: plans,
    signedReports: signed,
    evidenceLinks: evidence,
    documents: docs,
  };
}

export function modelInUse(c: ModelLinkedRecords): boolean {
  return c.cycles > 0;
}

/** ملخص عربي للسجلات المرتبطة — يعرض في رسائل التأكيد ويسجل في التدقيق. */
export function linkedSummaryAr(c: ModelLinkedRecords): string {
  const parts = [
    `${c.employees} موظف`,
    `${c.cycles} دورة تقييم`,
    `${c.sessions} جلسة`,
    `${c.ratings} تقدير`,
    `${c.evidenceLinks} شاهد`,
  ];
  if (c.documents > 0) parts.push(`${c.documents} تقرير مُصدَر`);
  if (c.signedReports > 0) parts.push(`${c.signedReports} تقرير موقع`);
  if (c.improvementPlans > 0) parts.push(`${c.improvementPlans} خطة تحسين`);
  return parts.join("، ");
}

/**
 * هل هذا النموذج هو آخر نموذج معتمد نشط (غير مؤرشف) لفئته؟
 * إخفاؤه يترك الفئة بلا نموذج ويعيد تفعيل مسار D-014 الاستثنائي دون داع.
 */
export async function isLastActiveApprovedForAudience(model: {
  id: string;
  audience: string;
  status: string;
  archivedAt: Date | null;
}): Promise<boolean> {
  if (model.status !== "معتمد" || model.archivedAt) return false;
  const others = await db
    .select({ id: perfModels.id })
    .from(perfModels)
    .where(
      and(
        eq(perfModels.audience, model.audience),
        eq(perfModels.status, "معتمد"),
        isNull(perfModels.archivedAt),
        ne(perfModels.id, model.id),
      ),
    );
  return others.length === 0;
}

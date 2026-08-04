import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { perfCycles, perfSessions, perfRatings, people } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { employeeTypeOf } from "@/lib/employee-type";
import { getExcludedIdSets } from "@/lib/synthetic";
import {
  computeOverallAnalytics,
  type AnalyticsCycleInput,
  type OverallAnalytics,
} from "./analytics";

/**
 * محمّل تحليلات الأداء (v2.3 §11) — يجمع الدورات والجلسات والتقديرات ويمررها
 * لوحدة الحساب النقية. العتبة قابلة للضبط من الإعدادات؛ أدنى عينة ثابت معلن.
 */

export const WEAK_THRESHOLD_SETTING = "performance.weak_threshold";
export const DEFAULT_WEAK_THRESHOLD = 60;
/** أدنى عدد تقييمات تُقبل به رؤية — معلن في الواجهة */
export const MIN_INSIGHT_SAMPLE = 3;

type SnapshotShape = {
  model?: { nameAr?: string };
  indicators?: { id: string; nameAr: string; weight: string | number }[];
};

export async function loadAnalyticsCycles(personId?: string): Promise<AnalyticsCycleInput[]> {
  const ex = await getExcludedIdSets();
  const cycles = await db
    .select()
    .from(perfCycles)
    .where(personId ? eq(perfCycles.personId, personId) : undefined)
    .orderBy(asc(perfCycles.yearKey));
  if (cycles.length === 0) return [];

  const cycleIds = cycles.map((c) => c.id);
  const sessions = await db
    .select()
    .from(perfSessions)
    .where(inArray(perfSessions.cycleId, cycleIds))
    .orderBy(asc(perfSessions.createdAt));
  const sessionIds = sessions.map((s) => s.id);
  const ratings = sessionIds.length
    ? await db.select().from(perfRatings).where(inArray(perfRatings.sessionId, sessionIds))
    : [];
  const personIds = [...new Set(cycles.map((c) => c.personId))];
  const persons = await db
    .select({ id: people.id, name: people.fullName, category: people.category, employeeType: people.employeeType })
    .from(people)
    .where(inArray(people.id, personIds));
  const personName = new Map(persons.map((p) => [p.id, p.name]));
  // D-019: النوع المعتمد يُشتق من `category` المصدري عند فراغ `employee_type` — لا يُعاد كتابة أي صف
  const personCategory = new Map(persons.map((p) => [p.id, employeeTypeOf(p)]));

  const ratingsBySession = new Map<string, typeof ratings>();
  for (const r of ratings) {
    const list = ratingsBySession.get(r.sessionId) ?? [];
    list.push(r);
    ratingsBySession.set(r.sessionId, list);
  }

  return cycles
    .filter((c) => !ex.people.has(c.personId))
    .map((c) => {
      const snapshot = (c.modelSnapshot ?? {}) as SnapshotShape;
      const indicators = (snapshot.indicators ?? []).map((i) => ({
        id: i.id,
        nameAr: i.nameAr,
        weight: Number(i.weight),
      }));
      const weightById = new Map(indicators.map((i) => [i.id, i.weight]));
      return {
        id: c.id,
        personId: c.personId,
        personName: personName.get(c.personId) ?? "—",
        personCategory: personCategory.get(c.personId) ?? "غير محدد",
        modelId: c.modelId,
        modelName: snapshot.model?.nameAr ?? "نموذج غير معروف",
        yearKey: c.yearKey,
        status: c.status,
        indicators,
        sessions: sessions
          .filter((s) => s.cycleId === c.id)
          .map((s) => ({
            sessionType: s.sessionType,
            status: s.status,
            sessionDate: s.sessionDate,
            createdAt: s.createdAt,
            ratings: (ratingsBySession.get(s.id) ?? []).map((r) => ({
              indicatorId: r.indicatorId,
              weight: weightById.get(r.indicatorId) ?? 0,
              rating: r.rating,
            })),
          })),
      };
    });
}

export async function loadOverallAnalytics(): Promise<{ analytics: OverallAnalytics; threshold: number }> {
  const ex = await getExcludedIdSets();
  const [cycleInputs, activeRows, threshold] = await Promise.all([
    loadAnalyticsCycles(),
    db
      .select({ id: people.id, name: people.fullName, category: people.category, employeeType: people.employeeType })
      .from(people)
      .where(eq(people.active, true)),
    getSetting<number>(WEAK_THRESHOLD_SETTING, DEFAULT_WEAK_THRESHOLD),
  ]);
  const activePeople = activeRows
    .filter((p) => !ex.people.has(p.id))
    .map((p) => ({ id: p.id, name: p.name ?? "—", category: employeeTypeOf(p) }));
  const analytics = computeOverallAnalytics({
    cycles: cycleInputs,
    activePeople,
    weakThresholdPercent: Number(threshold) || DEFAULT_WEAK_THRESHOLD,
    minSample: MIN_INSIGHT_SAMPLE,
  });
  return { analytics, threshold: Number(threshold) || DEFAULT_WEAK_THRESHOLD };
}

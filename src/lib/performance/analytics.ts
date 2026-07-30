/**
 * تحليلات الأداء العام (v2.3 §11) — قواعد حسابية شفافة حصراً، بلا ذكاء اصطناعي.
 *
 * وحدة نقية: المدخلات سجلات محمّلة مسبقاً والمخرجات مؤشرات ورؤى حتمية، كل رؤية
 * تحمل رابطاً إلى السجلات التي حُسبت منها، ولا تُعرض رؤية إلا إذا كانت عينة
 * حسابها كافية (سقف أدنى معلن — لا استنتاج من سجل واحد).
 *
 * التقدير 1..5 يُعرض نسبةً مئوية: (المتوسط ÷ 5) × 100.
 * جلسات «تخطيط» مستثناة من كل حساب (D-028) — تمر المدخلات عبر cycleProgress.
 */

import { cycleProgress, type RatingEntry } from "./scoring";

export type AnalyticsCycleInput = {
  id: string;
  personId: string;
  personName: string;
  modelId: string | null;
  modelName: string;
  yearKey: string;
  status: string;
  /** مؤشرات النموذج المجمَّد وقت إنشاء الدورة: المعرف والاسم والوزن */
  indicators: { id: string; nameAr: string; weight: number }[];
  sessions: {
    sessionType: string;
    status: string;
    sessionDate: string | null;
    createdAt: Date;
    ratings: RatingEntry[];
  }[];
};

export type AnalyticsInput = {
  cycles: AnalyticsCycleInput[];
  /** المنسوبون النشطون — لكشف من لا دورة تقييم له */
  activePeople: { id: string; name: string }[];
  /** عتبة الضعف كنسبة مئوية (قابلة للضبط من الإعدادات) */
  weakThresholdPercent: number;
  /** أدنى حجم عينة تُقبل به رؤية معيار (عدد التقييمات) */
  minSample: number;
};

export type CriterionStat = {
  name: string;
  /** متوسط النسبة المئوية عبر كل التقييمات التي قيّمته */
  averagePercent: number;
  sampleSize: number;
  /** الدورات التي كان المعيار فيها دون العتبة */
  belowThresholdCycleIds: string[];
  insufficientData: boolean;
};

export type EmployeeStat = {
  personId: string;
  personName: string;
  cycleId: string;
  yearKey: string;
  resultPercent: number | null;
  evaluated: boolean;
  weakCriteria: string[];
};

export type Insight = {
  text: string;
  href: string;
  /** حجم العينة التي بُنيت عليها الرؤية */
  sample: number;
};

export type OverallAnalytics = {
  criteria: CriterionStat[];
  byModel: { modelName: string; averagePercent: number; sampleSize: number }[];
  employees: EmployeeStat[];
  highest: CriterionStat[];
  lowest: CriterionStat[];
  belowThreshold: CriterionStat[];
  needsFollowUp: EmployeeStat[];
  counts: {
    notStarted: number;
    inProgress: number;
    completed: number;
    awaitingFinalApproval: number;
  };
  distribution: { bucket: string; count: number }[];
  /** التغير بين آخر فترتين لكل موظف له دورتان */
  periodChange: { personId: string; personName: string; fromYear: string; toYear: string; deltaPercent: number }[];
  recurringWeaknesses: { name: string; affectedCycles: number; affectedPeople: number }[];
  missingEvaluations: { id: string; name: string }[];
  insights: Insight[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeOverallAnalytics(input: AnalyticsInput): OverallAnalytics {
  const threshold = input.weakThresholdPercent;
  const minSample = Math.max(1, input.minSample);

  // ── تقدم كل دورة (أحدث تقدير لكل مؤشر، بلا جلسات تخطيط) ────────────────
  const perCycle = input.cycles.map((c) => {
    const progress = cycleProgress(c.sessions);
    const indicatorName = new Map(c.indicators.map((i) => [i.id, i.nameAr]));
    const totalWeight = c.indicators.reduce((s, i) => s + i.weight, 0);
    const resultPercent =
      progress.evaluated && totalWeight > 0 ? round1((progress.result / totalWeight) * 100) : null;
    return { cycle: c, progress, indicatorName, resultPercent };
  });

  // ── المعايير: متوسط النسبة عبر كل التقييمات باسم المعيار ────────────────
  const byCriterion = new Map<string, { percents: number[]; belowCycles: string[] }>();
  for (const { cycle, progress, indicatorName } of perCycle) {
    for (const e of progress.entries) {
      const name = indicatorName.get(e.indicatorId) ?? e.indicatorId;
      const percent = ((e.rating ?? 0) / 5) * 100;
      const cur = byCriterion.get(name) ?? { percents: [], belowCycles: [] };
      cur.percents.push(percent);
      if (percent < threshold) cur.belowCycles.push(cycle.id);
      byCriterion.set(name, cur);
    }
  }
  const criteria: CriterionStat[] = [...byCriterion.entries()]
    .map(([name, v]) => ({
      name,
      averagePercent: round1(v.percents.reduce((s, p) => s + p, 0) / v.percents.length),
      sampleSize: v.percents.length,
      belowThresholdCycleIds: v.belowCycles,
      insufficientData: v.percents.length < minSample,
    }))
    .sort((a, b) => b.averagePercent - a.averagePercent);

  const sufficient = criteria.filter((c) => !c.insufficientData);
  const highest = sufficient.slice(0, 3);
  const lowest = [...sufficient].sort((a, b) => a.averagePercent - b.averagePercent).slice(0, 3);
  const belowThreshold = sufficient.filter((c) => c.averagePercent < threshold);

  // ── حسب النموذج ─────────────────────────────────────────────────────────
  const byModelMap = new Map<string, number[]>();
  for (const { cycle, resultPercent } of perCycle) {
    if (resultPercent === null) continue;
    const list = byModelMap.get(cycle.modelName) ?? [];
    list.push(resultPercent);
    byModelMap.set(cycle.modelName, list);
  }
  const byModel = [...byModelMap.entries()].map(([modelName, list]) => ({
    modelName,
    averagePercent: round1(list.reduce((s, p) => s + p, 0) / list.length),
    sampleSize: list.length,
  }));

  // ── الموظفون ────────────────────────────────────────────────────────────
  const employees: EmployeeStat[] = perCycle.map(({ cycle, progress, indicatorName, resultPercent }) => ({
    personId: cycle.personId,
    personName: cycle.personName,
    cycleId: cycle.id,
    yearKey: cycle.yearKey,
    resultPercent,
    evaluated: progress.evaluated,
    weakCriteria: progress.entries
      .filter((e) => e.rating !== null && (e.rating / 5) * 100 < threshold)
      .map((e) => indicatorName.get(e.indicatorId) ?? e.indicatorId),
  }));

  const needsFollowUp = employees.filter(
    (e) => e.evaluated && ((e.resultPercent !== null && e.resultPercent < threshold) || e.weakCriteria.length >= 2),
  );

  // ── حالات التقييم ───────────────────────────────────────────────────────
  const finalOf = (c: AnalyticsCycleInput) => c.sessions.find((s) => s.sessionType === "نهائي");
  let notStarted = 0;
  let inProgress = 0;
  let completed = 0;
  let awaitingFinalApproval = 0;
  for (const { cycle, progress } of perCycle) {
    const final = finalOf(cycle);
    // «بانتظار الاعتماد النهائي» = جلسة نهائية مقيَّمة لم تُقفل بعد (خطوة الاعتماد)
    const finalRated = final
      ? final.ratings.some((r) => r.rating !== null && r.rating >= 1 && r.rating <= 5)
      : false;
    if (!progress.evaluated) notStarted += 1;
    else if (cycle.status === "مكتملة" || final?.status === "مقفلة") completed += 1;
    else if (final && finalRated) awaitingFinalApproval += 1;
    else inProgress += 1;
  }

  // ── توزيع الدرجات ───────────────────────────────────────────────────────
  const buckets: [string, (p: number) => boolean][] = [
    ["أقل من 60٪", (p) => p < 60],
    ["60–74٪", (p) => p >= 60 && p < 75],
    ["75–89٪", (p) => p >= 75 && p < 90],
    ["90٪ فأعلى", (p) => p >= 90],
  ];
  const evaluatedPercents = perCycle
    .map((c) => c.resultPercent)
    .filter((p): p is number => p !== null);
  const distribution = buckets.map(([bucket, test]) => ({
    bucket,
    count: evaluatedPercents.filter(test).length,
  }));

  // ── التغير بين الفترات لكل موظف ─────────────────────────────────────────
  const byPerson = new Map<string, typeof perCycle>();
  for (const pc of perCycle) {
    const list = byPerson.get(pc.cycle.personId) ?? [];
    list.push(pc);
    byPerson.set(pc.cycle.personId, list);
  }
  const periodChange: OverallAnalytics["periodChange"] = [];
  for (const list of byPerson.values()) {
    const withResults = list
      .filter((c) => c.resultPercent !== null)
      .sort((a, b) => a.cycle.yearKey.localeCompare(b.cycle.yearKey));
    if (withResults.length >= 2) {
      const prev = withResults[withResults.length - 2];
      const last = withResults[withResults.length - 1];
      periodChange.push({
        personId: last.cycle.personId,
        personName: last.cycle.personName,
        fromYear: prev.cycle.yearKey,
        toYear: last.cycle.yearKey,
        deltaPercent: round1((last.resultPercent ?? 0) - (prev.resultPercent ?? 0)),
      });
    }
  }

  // ── الضعف المتكرر عبر الموظفين ─────────────────────────────────────────
  const weaknessSpread = new Map<string, { cycles: Set<string>; people: Set<string> }>();
  for (const e of employees) {
    for (const name of e.weakCriteria) {
      const cur = weaknessSpread.get(name) ?? { cycles: new Set(), people: new Set() };
      cur.cycles.add(e.cycleId);
      cur.people.add(e.personId);
      weaknessSpread.set(name, cur);
    }
  }
  const recurringWeaknesses = [...weaknessSpread.entries()]
    .map(([name, v]) => ({ name, affectedCycles: v.cycles.size, affectedPeople: v.people.size }))
    .filter((w) => w.affectedPeople >= 2)
    .sort((a, b) => b.affectedPeople - a.affectedPeople);

  // ── من لا دورة تقييم له ─────────────────────────────────────────────────
  const withCycle = new Set(input.cycles.map((c) => c.personId));
  const missingEvaluations = input.activePeople.filter((p) => !withCycle.has(p.id));

  // ── الرؤى الحتمية — كل رؤية بعينة كافية ورابط ───────────────────────────
  const insights: Insight[] = [];
  const totalEvaluated = perCycle.filter((c) => c.progress.evaluated).length;

  for (const c of lowest.slice(0, 1)) {
    if (c.sampleSize >= minSample && c.averagePercent < threshold) {
      insights.push({
        text: `معيار «${c.name}» هو الأضعف على مستوى المجمع — متوسطه ${c.averagePercent}٪ عبر ${c.sampleSize} تقييماً.`,
        href: "/performance/analytics#criteria",
        sample: c.sampleSize,
      });
    }
  }
  for (const c of belowThreshold) {
    if (c.belowThresholdCycleIds.length >= Math.max(2, Math.ceil(c.sampleSize / 2))) {
      insights.push({
        text: `معيار «${c.name}» أقل من الحد المستهدف (${threshold}٪) في ${c.belowThresholdCycleIds.length} من أصل ${c.sampleSize} تقييماً.`,
        href: "/performance/analytics#criteria",
        sample: c.sampleSize,
      });
    }
  }
  const improved = periodChange.filter((p) => p.deltaPercent >= 5);
  for (const p of improved.slice(0, 3)) {
    insights.push({
      text: `تحسن أداء ${p.personName} بمقدار ${p.deltaPercent}٪ بين ${p.fromYear} و${p.toYear}.`,
      href: `/performance/employees/${p.personId}`,
      sample: 2,
    });
  }
  if (notStarted > 0 && input.cycles.length >= minSample) {
    insights.push({
      text: `${notStarted} من أصل ${input.cycles.length} دورة تقييم لم يبدأ تقييمها الفعلي بعد.`,
      href: "/performance",
      sample: input.cycles.length,
    });
  }
  if (missingEvaluations.length > 0) {
    insights.push({
      text: `${missingEvaluations.length} من المنسوبين النشطين بلا دورة تقييم مسجلة.`,
      href: "/performance/analytics#missing",
      sample: input.activePeople.length,
    });
  }
  for (const w of recurringWeaknesses.slice(0, 2)) {
    insights.push({
      text: `ضعف متكرر في «${w.name}» لدى ${w.affectedPeople} منسوبين — يصلح برنامجاً تطويرياً مشتركاً.`,
      href: "/performance/analytics#criteria",
      sample: w.affectedCycles,
    });
  }
  if (totalEvaluated < minSample) {
    // عينة كلية غير كافية — لا رؤى تقييمية تُعرض غير الملاحظات التشغيلية أعلاه
    const operational = insights.filter(
      (i) => i.href === "/performance" || i.href.endsWith("#missing"),
    );
    return {
      criteria,
      byModel,
      employees,
      highest,
      lowest,
      belowThreshold,
      needsFollowUp,
      counts: { notStarted, inProgress, completed, awaitingFinalApproval },
      distribution,
      periodChange,
      recurringWeaknesses,
      missingEvaluations,
      insights: operational,
    };
  }

  return {
    criteria,
    byModel,
    employees,
    highest,
    lowest,
    belowThreshold,
    needsFollowUp,
    counts: { notStarted, inProgress, completed, awaitingFinalApproval },
    distribution,
    periodChange,
    recurringWeaknesses,
    missingEvaluations,
    insights,
  };
}

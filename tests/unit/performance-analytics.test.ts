import { describe, it, expect } from "vitest";
import { computeOverallAnalytics, type AnalyticsCycleInput } from "@/lib/performance/analytics";

/**
 * v2.3 §11 — تحليلات الأداء الحتمية:
 * متوسطات المعايير، العتبة، حالات التقييم، التوزيع، التغير بين الفترات،
 * الضعف المتكرر، كفاية العينة، واستثناء جلسات التخطيط (D-028).
 */

const IND = [
  { id: "i-plan", nameAr: "التخطيط", weight: 40 },
  { id: "i-tech", nameAr: "استخدام التقنية", weight: 60 },
];

let seq = 0;
function cycle(over: {
  personId: string;
  personName: string;
  yearKey?: string;
  ratings?: { id: string; rating: number }[];
  sessionType?: string;
  sessionStatus?: string;
  cycleStatus?: string;
}): AnalyticsCycleInput {
  seq += 1;
  const ratings = over.ratings ?? [];
  return {
    id: `c${seq}`,
    personId: over.personId,
    personName: over.personName,
    modelId: "m1",
    modelName: "نموذج المعلم",
    yearKey: over.yearKey ?? "1448",
    status: over.cycleStatus ?? "نشطة",
    indicators: IND,
    sessions: ratings.length
      ? [
          {
            sessionType: over.sessionType ?? "نهائي",
            status: over.sessionStatus ?? "مسودة",
            sessionDate: "2026-05-01",
            createdAt: new Date(Date.UTC(2026, 4, 1)),
            ratings: ratings.map((r) => ({ indicatorId: r.id, weight: IND.find((i) => i.id === r.id)!.weight, rating: r.rating })),
          },
        ]
      : [],
  };
}

const base = { weakThresholdPercent: 60, minSample: 3 };

describe("متوسطات المعايير والعتبة", () => {
  it("يحسب متوسط كل معيار نسبةً ويعلّم ما دون العتبة", () => {
    const a = computeOverallAnalytics({
      cycles: [
        cycle({ personId: "p1", personName: "أ", ratings: [{ id: "i-plan", rating: 2 }, { id: "i-tech", rating: 5 }] }),
        cycle({ personId: "p2", personName: "ب", ratings: [{ id: "i-plan", rating: 3 }, { id: "i-tech", rating: 4 }] }),
        cycle({ personId: "p3", personName: "ج", ratings: [{ id: "i-plan", rating: 2 }, { id: "i-tech", rating: 5 }] }),
      ],
      activePeople: [],
      ...base,
    });
    const plan = a.criteria.find((c) => c.name === "التخطيط")!;
    // (40+60+40)/3 = 46.7٪
    expect(plan.averagePercent).toBeCloseTo(46.7, 1);
    expect(plan.sampleSize).toBe(3);
    expect(plan.insufficientData).toBe(false);
    expect(a.belowThreshold.map((c) => c.name)).toContain("التخطيط");
    const tech = a.criteria.find((c) => c.name === "استخدام التقنية")!;
    expect(tech.averagePercent).toBeCloseTo(93.3, 1);
    expect(a.lowest[0].name).toBe("التخطيط");
    expect(a.highest[0].name).toBe("استخدام التقنية");
  });

  it("جلسات «تخطيط» مستثناة من كل الحسابات (D-028)", () => {
    const a = computeOverallAnalytics({
      cycles: [
        cycle({ personId: "p1", personName: "أ", sessionType: "تخطيط", ratings: [{ id: "i-plan", rating: 1 }] }),
      ],
      activePeople: [],
      ...base,
    });
    expect(a.criteria).toHaveLength(0);
    expect(a.counts.notStarted).toBe(1);
  });

  it("عينة أقل من الحد لا تنتج رؤى تقييمية — وتُعلَّم «عينة غير كافية»", () => {
    const a = computeOverallAnalytics({
      cycles: [cycle({ personId: "p1", personName: "أ", ratings: [{ id: "i-plan", rating: 1 }] })],
      activePeople: [],
      ...base,
    });
    expect(a.criteria[0].insufficientData).toBe(true);
    // لا رؤية «أضعف معيار» على عينة واحدة
    expect(a.insights.filter((i) => i.text.includes("الأضعف"))).toHaveLength(0);
  });
});

describe("حالات التقييم والتوزيع", () => {
  it("لم يبدأ / قيد / بانتظار الاعتماد / مكتملة", () => {
    const a = computeOverallAnalytics({
      cycles: [
        cycle({ personId: "p1", personName: "أ" }), // لا جلسات ← لم يبدأ
        cycle({ personId: "p2", personName: "ب", ratings: [{ id: "i-plan", rating: 4 }] }), // نهائي مسودة ← بانتظار؟
        cycle({ personId: "p3", personName: "ج", ratings: [{ id: "i-plan", rating: 4 }], sessionType: "منتصف" }), // قيد التقييم
        cycle({ personId: "p4", personName: "د", ratings: [{ id: "i-plan", rating: 4 }], cycleStatus: "مكتملة" }),
      ],
      activePeople: [],
      ...base,
    });
    expect(a.counts.notStarted).toBe(1);
    expect(a.counts.completed).toBe(1);
    expect(a.counts.inProgress).toBe(1);
    expect(a.counts.awaitingFinalApproval).toBe(1);
  });

  it("توزيع النتائج على الشرائح", () => {
    const a = computeOverallAnalytics({
      cycles: [
        cycle({ personId: "p1", personName: "أ", ratings: [{ id: "i-plan", rating: 5 }, { id: "i-tech", rating: 5 }] }), // 100٪
        cycle({ personId: "p2", personName: "ب", ratings: [{ id: "i-plan", rating: 2 }, { id: "i-tech", rating: 2 }] }), // 40٪
      ],
      activePeople: [],
      ...base,
    });
    expect(a.distribution.find((d) => d.bucket === "90٪ فأعلى")?.count).toBe(1);
    expect(a.distribution.find((d) => d.bucket === "أقل من 60٪")?.count).toBe(1);
  });
});

describe("التغير بين الفترات والضعف المتكرر ومن بلا تقييم", () => {
  it("يحسب التغير بين آخر فترتين لكل منسوب", () => {
    const a = computeOverallAnalytics({
      cycles: [
        cycle({ personId: "p1", personName: "أ", yearKey: "1447", ratings: [{ id: "i-plan", rating: 3 }, { id: "i-tech", rating: 3 }] }), // 60
        cycle({ personId: "p1", personName: "أ", yearKey: "1448", ratings: [{ id: "i-plan", rating: 4 }, { id: "i-tech", rating: 4 }] }), // 80
      ],
      activePeople: [],
      ...base,
    });
    expect(a.periodChange).toHaveLength(1);
    expect(a.periodChange[0].deltaPercent).toBe(20);
  });

  it("الضعف المتكرر يتطلب منسوبَين على الأقل — ورؤيته تحمل رابطاً", () => {
    const cycles = [
      cycle({ personId: "p1", personName: "أ", ratings: [{ id: "i-plan", rating: 2 }, { id: "i-tech", rating: 5 }] }),
      cycle({ personId: "p2", personName: "ب", ratings: [{ id: "i-plan", rating: 1 }, { id: "i-tech", rating: 5 }] }),
      cycle({ personId: "p3", personName: "ج", ratings: [{ id: "i-plan", rating: 5 }, { id: "i-tech", rating: 5 }] }),
    ];
    const a = computeOverallAnalytics({ cycles, activePeople: [], ...base });
    expect(a.recurringWeaknesses).toHaveLength(1);
    expect(a.recurringWeaknesses[0].name).toBe("التخطيط");
    expect(a.recurringWeaknesses[0].affectedPeople).toBe(2);
    for (const i of a.insights) {
      expect(i.href.length).toBeGreaterThan(0);
      expect(i.sample).toBeGreaterThan(0);
    }
  });

  it("المنسوب النشط بلا دورة يظهر في «بلا تقييم»", () => {
    const a = computeOverallAnalytics({
      cycles: [cycle({ personId: "p1", personName: "أ", ratings: [{ id: "i-plan", rating: 4 }] })],
      activePeople: [
        { id: "p1", name: "أ" },
        { id: "p9", name: "بلا دورة" },
      ],
      ...base,
    });
    expect(a.missingEvaluations).toEqual([{ id: "p9", name: "بلا دورة" }]);
  });
});

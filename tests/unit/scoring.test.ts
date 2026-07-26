import { describe, it, expect } from "vitest";
import { weightedScore, sessionResult, cycleProgress, validRating, weakIndicators } from "@/lib/performance/scoring";

describe("معادلة الدرجات الرسمية (A4)", () => {
  it("الدرجة الموزونة = (التقدير ÷ 5) × الوزن", () => {
    expect(weightedScore(5, 20)).toBe(20);
    expect(weightedScore(4, 20)).toBe(16);
    expect(weightedScore(3, 10)).toBe(6);
    expect(weightedScore(1, 15)).toBe(3);
  });

  it("نتيجة الجلسة مجموع الدرجات الموزونة والتغطية نسبة المقيم", () => {
    const { result, coverage } = sessionResult([
      { indicatorId: "a", weight: 50, rating: 5 },
      { indicatorId: "b", weight: 30, rating: 4 },
      { indicatorId: "c", weight: 20, rating: null },
    ]);
    expect(result).toBe(74); // 50 + 24
    expect(coverage).toBeCloseTo(0.67, 1);
  });

  it("نموذج كامل بتقدير 5 لكل المؤشرات = 100٪", () => {
    const { result } = sessionResult([
      { indicatorId: "a", weight: 40, rating: 5 },
      { indicatorId: "b", weight: 35, rating: 5 },
      { indicatorId: "c", weight: 25, rating: 5 },
    ]);
    expect(result).toBe(100);
  });

  it("يرفض أي تقدير خارج 1..5 أو غير صحيح", () => {
    expect(validRating(0)).toBeNull();
    expect(validRating(6)).toBeNull();
    expect(validRating(3.5)).toBeNull();
    expect(validRating("نص")).toBeNull();
    expect(validRating(3)).toBe(3);
  });

  it("تقدم الدورة يستخدم أحدث تقدير لكل مؤشر حسب تاريخ الجلسة", () => {
    const early = new Date("2026-09-01");
    const late = new Date("2026-12-01");
    const { entries, result } = cycleProgress([
      {
        sessionDate: "2026-12-01",
        createdAt: late,
        ratings: [{ indicatorId: "a", weight: 100, rating: 5 }],
      },
      {
        sessionDate: "2026-09-01",
        createdAt: early,
        ratings: [{ indicatorId: "a", weight: 100, rating: 2 }],
      },
    ]);
    expect(entries[0].rating).toBe(5); // الأحدث زمنياً وليس ترتيب الإدخال
    expect(result).toBe(100);
  });

  it("التقديرات الضعيفة (≤2) تحدد للاقتراح دون فرض", () => {
    expect(
      weakIndicators([
        { indicatorId: "a", weight: 50, rating: 2 },
        { indicatorId: "b", weight: 50, rating: 4 },
      ]),
    ).toEqual(["a"]);
  });
});

describe("استثناء جلسة التخطيط من حساب مؤشرات الأداء (D-028)", () => {
  const finalSession = {
    sessionType: "نهائي",
    sessionDate: "2026-12-01",
    createdAt: new Date("2026-12-01"),
    ratings: [
      { indicatorId: "a", weight: 60, rating: 4 },
      { indicatorId: "b", weight: 40, rating: 5 },
    ],
  };

  it("تغيير تقديرات جلسة «التخطيط» عبر المدى 1..5 لا يغيّر أي نتيجة محسوبة للدورة", () => {
    const baseline = cycleProgress([finalSession]);
    for (let r = 1; r <= 5; r++) {
      const withPlanning = cycleProgress([
        {
          sessionType: "تخطيط",
          sessionDate: "2026-09-01",
          createdAt: new Date("2026-09-01"),
          ratings: [
            { indicatorId: "a", weight: 60, rating: r },
            { indicatorId: "b", weight: 40, rating: r },
          ],
        },
        finalSession,
      ]);
      expect(withPlanning.result).toBe(baseline.result);
      expect(withPlanning.coverage).toBe(baseline.coverage);
      expect(withPlanning.entries).toEqual(baseline.entries);
      expect(withPlanning.evaluated).toBe(true);
    }
  });

  it("دورة بجلسة تخطيط فقط: evaluated=false ولا تنتج نتيجة تقييمية (تُعرض «لم يبدأ التقييم بعد»)", () => {
    const onlyPlanning = cycleProgress([
      {
        sessionType: "تخطيط",
        sessionDate: "2026-09-01",
        createdAt: new Date("2026-09-01"),
        ratings: [
          { indicatorId: "a", weight: 60, rating: 5 },
          { indicatorId: "b", weight: 40, rating: 1 },
        ],
      },
    ]);
    expect(onlyPlanning.evaluated).toBe(false);
    expect(onlyPlanning.entries).toHaveLength(0);
    expect(onlyPlanning.result).toBe(0);
  });

  it("جلسة بلا نوع محدد تُعامل كجلسة تقييمية (توافق خلفي)", () => {
    const p = cycleProgress([
      { sessionDate: "2026-12-01", createdAt: new Date("2026-12-01"), ratings: [{ indicatorId: "a", weight: 100, rating: 3 }] },
    ]);
    expect(p.evaluated).toBe(true);
    expect(p.result).toBe(60);
  });
});

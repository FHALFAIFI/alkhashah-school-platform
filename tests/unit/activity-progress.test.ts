import { describe, it, expect } from "vitest";
import {
  ACTIVITY_STATUS,
  WEIGHTING_MODE,
  computeProgramProgressFromActivities,
  countsTowardProgress,
  effectiveActivityProgress,
  effectiveWeights,
  validateWeights,
  type ActivityForProgress,
} from "@/lib/plan/activity-progress";

const act = (o: Partial<ActivityForProgress> & { id: string }): ActivityForProgress => ({
  status: ACTIVITY_STATUS.notStarted,
  progress: 0,
  weight: null,
  ...o,
});

describe("نسبة إنجاز النشاط", () => {
  it("«لم يبدأ» و«مسودة» = 0٪ مهما كانت القيمة المسجّلة", () => {
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.notStarted, progress: 80 })).toBe(0);
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.draft, progress: 99 })).toBe(0);
  });

  it("«مكتمل» = 100٪ مهما كانت القيمة المسجّلة", () => {
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.completed, progress: 10 })).toBe(100);
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.completed, progress: 0 })).toBe(100);
  });

  it("«قيد التنفيذ» يأخذ القيمة المسجّلة صراحةً ضمن 1..99", () => {
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.inProgress, progress: 37 })).toBe(37);
    // لا يبلغ 100 دون حالة «مكتمل»
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.inProgress, progress: 100 })).toBe(99);
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.inProgress, progress: -5 })).toBe(0);
  });

  it("لا تُخترع قيمة افتراضية (لا 50٪) لمجرد أن النشاط جارٍ", () => {
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.inProgress, progress: 0 })).toBe(0);
    expect(effectiveActivityProgress({ status: ACTIVITY_STATUS.inProgress, progress: NaN })).toBe(0);
  });

  it("المؤرشف والملغى خارج الحساب", () => {
    expect(countsTowardProgress(act({ id: "a", status: ACTIVITY_STATUS.archived }))).toBe(false);
    expect(countsTowardProgress(act({ id: "b", status: ACTIVITY_STATUS.cancelled }))).toBe(false);
    expect(countsTowardProgress(act({ id: "c", archivedAt: new Date() }))).toBe(false);
    expect(countsTowardProgress(act({ id: "d", status: ACTIVITY_STATUS.inProgress }))).toBe(true);
  });
});

describe("أوزان الأنشطة", () => {
  it("الوضع المتساوي: كل نشاط محتسب يأخذ وزناً متساوياً", () => {
    const acts = [act({ id: "a" }), act({ id: "b" }), act({ id: "c" }), act({ id: "d", status: ACTIVITY_STATUS.archived })];
    const w = effectiveWeights(acts, WEIGHTING_MODE.equal);
    expect(w.size).toBe(3);
    expect([...w.values()].every((v) => Math.abs(v - 100 / 3) < 1e-9)).toBe(true);
    expect(validateWeights(acts, WEIGHTING_MODE.equal).valid).toBe(true);
  });

  it("الوضع المخصص الصحيح: المجموع 100 وكل وزن موجب", () => {
    const acts = [act({ id: "a", weight: 60 }), act({ id: "b", weight: 40 })];
    const v = validateWeights(acts, WEIGHTING_MODE.custom);
    expect(v.valid).toBe(true);
    expect(v.total).toBe(100);
  });

  it("مجموع مخصص مخالف لا يُطبَّع صامتاً — يبقى مخالفاً ويُبلَّغ عنه", () => {
    const acts = [act({ id: "a", weight: 20 }), act({ id: "b", weight: 20 }), act({ id: "c", weight: 20 }), act({ id: "d", weight: 20 })];
    const v = validateWeights(acts, WEIGHTING_MODE.custom);
    expect(v.valid).toBe(false);
    expect(v.total).toBe(80);
    expect(v.problemsAr.join(" ")).toContain("80");
    expect(v.problemsAr.join(" ")).toContain("100");
  });

  it("وزن مفقود أو غير موجب يُبلَّغ عنه في الوضع المخصص", () => {
    const missing = validateWeights([act({ id: "a", weight: 100 }), act({ id: "b", weight: null })], WEIGHTING_MODE.custom);
    expect(missing.valid).toBe(false);
    expect(missing.problemsAr.join(" ")).toContain("بلا وزن");

    const zero = validateWeights([act({ id: "a", weight: 100 }), act({ id: "b", weight: 0 })], WEIGHTING_MODE.custom);
    expect(zero.valid).toBe(false);
    expect(zero.problemsAr.join(" ")).toContain("صفري");
  });

  it("الأنشطة المؤرشفة مستبعدة من مجموع الأوزان", () => {
    const acts = [act({ id: "a", weight: 60 }), act({ id: "b", weight: 40 }), act({ id: "c", weight: 50, status: ACTIVITY_STATUS.archived })];
    expect(validateWeights(acts, WEIGHTING_MODE.custom).total).toBe(100);
  });
});

describe("تقدم البرنامج من الأنشطة", () => {
  it("بلا أنشطة = 0٪", () => {
    const r = computeProgramProgressFromActivities([], WEIGHTING_MODE.equal);
    expect(r.display).toBe(0);
    expect(r.countedActivities).toBe(0);
  });

  it("الوضع المتساوي: نشاطان أحدهما مكتمل = 50٪", () => {
    const r = computeProgramProgressFromActivities(
      [act({ id: "a", status: ACTIVITY_STATUS.completed }), act({ id: "b" })],
      WEIGHTING_MODE.equal,
    );
    expect(r.display).toBe(50);
  });

  it("الوضع المخصص: يحترم الأوزان المعلنة", () => {
    const r = computeProgramProgressFromActivities(
      [
        act({ id: "a", weight: 70, status: ACTIVITY_STATUS.completed }),
        act({ id: "b", weight: 30, status: ACTIVITY_STATUS.inProgress, progress: 50 }),
      ],
      WEIGHTING_MODE.custom,
    );
    // 0.70*100 + 0.30*50 = 85
    expect(r.display).toBe(85);
    expect(r.weights.valid).toBe(true);
  });

  it("الدقة تُحفظ داخلياً والتقريب للعرض فقط", () => {
    const r = computeProgramProgressFromActivities(
      [act({ id: "a", status: ACTIVITY_STATUS.completed }), act({ id: "b" }), act({ id: "c" })],
      WEIGHTING_MODE.equal,
    );
    expect(r.display).toBe(33);
    expect(r.exact).toBeCloseTo(100 / 3, 9);
  });

  it("المؤرشف لا يخفض التقدم ولا يُحتسب", () => {
    const r = computeProgramProgressFromActivities(
      [act({ id: "a", status: ACTIVITY_STATUS.completed }), act({ id: "b", status: ACTIVITY_STATUS.archived })],
      WEIGHTING_MODE.equal,
    );
    expect(r.display).toBe(100);
    expect(r.countedActivities).toBe(1);
  });

  it("مجموع مخصص مخالف: التقدم يبقى ضمن 0..100 والبطلان يظل معلناً", () => {
    const acts = [
      act({ id: "a", weight: 20, status: ACTIVITY_STATUS.completed }),
      act({ id: "b", weight: 20, status: ACTIVITY_STATUS.completed }),
      act({ id: "c", weight: 20 }),
      act({ id: "d", weight: 20 }),
    ];
    const r = computeProgramProgressFromActivities(acts, WEIGHTING_MODE.custom);
    expect(r.display).toBe(50);
    expect(r.display).toBeLessThanOrEqual(100);
    expect(r.weights.valid).toBe(false);
  });
});

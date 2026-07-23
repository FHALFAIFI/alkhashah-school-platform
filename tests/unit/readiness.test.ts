import { describe, it, expect } from "vitest";
import { ACTIVITY_STATUS, WEIGHTING_MODE } from "@/lib/plan/activity-progress";
import { computeReadiness, type ReadinessInput } from "@/lib/plan/readiness";

const fullProgram: ReadinessInput["program"] = {
  name: "برنامج",
  domain: "مجال",
  generalGoal: "هدف عام",
  specificGoal: "هدف تفصيلي",
  ownerPersonId: "p1",
  ownerPosition: null,
  hijriStart: "1448/3/2",
  hijriEnd: "1449/1/5",
  status: "معتمد",
  weightingMode: WEIGHTING_MODE.equal,
};

const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  programId: "prog-1",
  program: fullProgram,
  activities: [],
  deliverables: [],
  evidenceRequirements: [],
  ...over,
});

describe("جاهزية اكتمال البرنامج", () => {
  it("برنامج مستوفٍ بلا متطلبات منطبقة: جاهز 100٪", () => {
    const r = computeReadiness(base());
    expect(r.ready).toBe(true);
    expect(r.percent).toBe(100);
    expect(r.missing).toEqual([]);
    expect(r.statusAr).toContain("جاهز للإقفال");
  });

  it("بيان ناقص في البرنامج يظهر في القائمة بنص عربي صريح", () => {
    const r = computeReadiness(base({ program: { ...fullProgram, specificGoal: null, hijriEnd: "  " } }));
    expect(r.ready).toBe(false);
    const labels = r.missing.map((m) => m.labelAr).join(" | ");
    expect(labels).toContain("الهدف التفصيلي");
    expect(labels).toContain("تاريخ النهاية");
    expect(r.missing.every((m) => m.href)).toBe(true);
  });

  it("نشاط إلزامي غير مكتمل يمنع الجاهزية ويذكر اسمه وحالته", () => {
    const r = computeReadiness(
      base({
        activities: [
          { id: "a1", name: "زيارة صفية", status: ACTIVITY_STATUS.inProgress, progress: 40, weight: null, requiredForCompletion: true },
          { id: "a2", name: "تقرير", status: ACTIVITY_STATUS.completed, progress: 100, weight: null, requiredForCompletion: true },
        ],
      }),
    );
    expect(r.ready).toBe(false);
    const m = r.missing.find((x) => x.check === "required_activities");
    expect(m?.labelAr).toContain("زيارة صفية");
    expect(m?.labelAr).toContain(ACTIVITY_STATUS.inProgress);
    expect(m?.href).toContain("a1");
  });

  it("النشاط غير الإلزامي لا يمنع الجاهزية", () => {
    const r = computeReadiness(
      base({
        activities: [
          { id: "a1", name: "اختياري", status: ACTIVITY_STATUS.notStarted, progress: 0, weight: null, requiredForCompletion: false },
        ],
      }),
    );
    expect(r.ready).toBe(true);
  });

  it("وزن مخصص مخالف لـ100 يظهر في قائمة الجاهزية ويمنع الاكتمال الطبيعي", () => {
    const r = computeReadiness(
      base({
        program: { ...fullProgram, weightingMode: WEIGHTING_MODE.custom },
        activities: [
          { id: "a1", name: "ن1", status: ACTIVITY_STATUS.completed, progress: 100, weight: 20, requiredForCompletion: true },
          { id: "a2", name: "ن2", status: ACTIVITY_STATUS.completed, progress: 100, weight: 20, requiredForCompletion: true },
          { id: "a3", name: "ن3", status: ACTIVITY_STATUS.completed, progress: 100, weight: 20, requiredForCompletion: true },
          { id: "a4", name: "ن4", status: ACTIVITY_STATUS.completed, progress: 100, weight: 20, requiredForCompletion: true },
        ],
      }),
    );
    // كل الأنشطة مكتملة لكن المجموع 80 — الجاهزية تمنع الإقفال
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => m.check === "activity_weights" && m.labelAr.includes("80"))).toBe(true);
  });

  it("مخرج إلزامي غير منجز يمنع الجاهزية", () => {
    const r = computeReadiness(
      base({
        activities: [{ id: "a1", name: "ن", status: ACTIVITY_STATUS.completed, progress: 100, weight: null, requiredForCompletion: true }],
        deliverables: [{ id: "d1", activityId: "a1", name: "محضر التسليم", required: true, completed: false }],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => m.labelAr.includes("محضر التسليم"))).toBe(true);
  });

  it("متطلب شاهد غير مستوفٍ يذكر المطلوب والمتوفر — لا يُحسب من عدد الملفات", () => {
    const r = computeReadiness(
      base({
        activities: [{ id: "a1", name: "ن", status: ACTIVITY_STATUS.completed, progress: 100, weight: null, requiredForCompletion: true }],
        evidenceRequirements: [
          { id: "e1", activityId: "a1", label: "شاهد تنفيذ", required: true, minCount: 2, satisfiedCount: 1 },
        ],
      }),
    );
    expect(r.ready).toBe(false);
    const m = r.missing.find((x) => x.check === "required_evidence");
    expect(m?.labelAr).toContain("المطلوب 2");
    expect(m?.labelAr).toContain("المتوفر 1");
  });

  it("متطلبات الأنشطة المؤرشفة لا تمنع الجاهزية", () => {
    const r = computeReadiness(
      base({
        activities: [{ id: "a1", name: "ملغى", status: ACTIVITY_STATUS.archived, progress: 0, weight: null, requiredForCompletion: true }],
        deliverables: [{ id: "d1", activityId: "a1", name: "مخرج معلّق", required: true, completed: false }],
        evidenceRequirements: [{ id: "e1", activityId: "a1", label: "شاهد", required: true, minCount: 1, satisfiedCount: 0 }],
      }),
    );
    expect(r.ready).toBe(true);
  });

  it("اعتماد مطلوب غير مستوفٍ يمنع الجاهزية", () => {
    const r = computeReadiness(base({ approvals: [{ key: "signed", labelAr: "محضر موقّع", satisfied: false }] }));
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => m.labelAr.includes("محضر موقّع"))).toBe(true);
  });

  it("النسبة تُحسب من الفحوص المنطبقة فقط", () => {
    // منطبق: بيانات البرنامج + الأوزان + الأنشطة الإلزامية = 3، ناجح منها 2
    const r = computeReadiness(
      base({
        activities: [{ id: "a1", name: "ن", status: ACTIVITY_STATUS.notStarted, progress: 0, weight: null, requiredForCompletion: true }],
      }),
    );
    expect(r.percent).toBe(67);
    expect(r.checks.filter((c) => c.applicable).length).toBe(3);
  });

  it("التقدم والجاهزية منفصلان: تقدم 100٪ لا يعني جاهزية 100٪", () => {
    const r = computeReadiness(
      base({
        activities: [{ id: "a1", name: "ن", status: ACTIVITY_STATUS.completed, progress: 100, weight: null, requiredForCompletion: true }],
        evidenceRequirements: [{ id: "e1", activityId: "a1", label: "شاهد أثر", required: true, minCount: 1, satisfiedCount: 0 }],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.statusAr).toContain("غير جاهز");
  });
});

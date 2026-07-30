import { describe, it, expect } from "vitest";
import { programLifecycle, nextLifecycleAction, PROGRAM_LIFECYCLE, LIFECYCLE_ACTIONS } from "@/lib/plan/lifecycle";

/**
 * الحالة ثلاثية مشتقة حصراً من العمودين الزمنيين — لا شواهد ولا نسب ولا معالم
 * ولا حقول إلزامية تدخل في الاشتقاق (D-024/D-025).
 */
describe("اشتقاق حالة البرنامج ثلاثية الحالات", () => {
  it("لا اكتمال ولا إقفال ← «قيد التنفيذ»", () => {
    expect(programLifecycle({ completedAt: null, closedAt: null })).toBe("قيد التنفيذ");
  });

  it("اكتمال بلا إقفال ← «مكتمل»", () => {
    expect(programLifecycle({ completedAt: new Date(), closedAt: null })).toBe("مكتمل");
  });

  it("الإقفال يغلب: مغلق حتى مع وجود تاريخ اكتمال", () => {
    expect(programLifecycle({ completedAt: new Date(), closedAt: new Date() })).toBe("مغلق");
  });

  it("برنامج مغلق قبل التصحيح (بلا اكتمال) يُعرض «مغلق» كذلك", () => {
    expect(programLifecycle({ completedAt: null, closedAt: new Date() })).toBe("مغلق");
  });

  it("الإجراء التالي يتبع الحالة: اكتمال ← إقفال ← إعادة فتح", () => {
    expect(nextLifecycleAction({ completedAt: null, closedAt: null })).toBe("تعليم البرنامج كمكتمل");
    expect(nextLifecycleAction({ completedAt: new Date(), closedAt: null })).toBe("إقفال البرنامج نهائياً");
    expect(nextLifecycleAction({ completedAt: new Date(), closedAt: new Date() })).toBe("إعادة فتح البرنامج");
  });

  it("قيم الحالات والأفعال العربية ثابتة كما في الواجهة والتقارير", () => {
    expect(Object.values(PROGRAM_LIFECYCLE)).toEqual(["قيد التنفيذ", "مكتمل", "مغلق"]);
    expect(Object.values(LIFECYCLE_ACTIONS)).toEqual(["اكتمال", "إقفال", "إعادة فتح", "إعادة للتنفيذ"]);
  });
});

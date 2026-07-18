import { describe, it, expect } from "vitest";
import { isAwaitingFaresIndicator, snapshotAwaitingFaresCells, AWAITING_FARES_LABEL } from "@/lib/performance/d014";

describe("D-014 — بانتظار المطابقة مع نظام فارس", () => {
  it("يعلّم خلايا D-014 الثلاث في النماذج الرسمية الأصلية (النسخة 1، الوزن 5٪)", () => {
    expect(
      isAwaitingFaresIndicator({ modelKey: "school-principal", modelOfficial: true, modelVersion: 1, indicatorNameAr: "ينفذ إجراءات علمية لتحسين نتائج التعلم", weight: 5 }),
    ).toBe(true);
    expect(
      isAwaitingFaresIndicator({ modelKey: "kindergarten-teacher", modelOfficial: true, modelVersion: 1, indicatorNameAr: "تهيئ بيئة تعلمية آمنة ومعززة للتطور النمائي والتعلم", weight: 5 }),
    ).toBe(true);
  });

  it("لا يعلّم غير خلايا D-014، ولا نموذجاً غير رسمي، ولا نسخة مُطابَقة جديدة", () => {
    // مؤشر آخر
    expect(isAwaitingFaresIndicator({ modelKey: "teacher", modelOfficial: true, modelVersion: 1, indicatorNameAr: "الإدارة الصفية", weight: 5 })).toBe(false);
    // نموذج داخلي غير رسمي
    expect(isAwaitingFaresIndicator({ modelKey: "school-vice", modelOfficial: false, modelVersion: 1, indicatorNameAr: "ينفذ إجراءات علمية لتحسين نتائج التعلم", weight: 5 })).toBe(false);
    // بعد المطابقة تُنشأ نسخة جديدة (2) فلا تعود معلّقة
    expect(isAwaitingFaresIndicator({ modelKey: "school-vice", modelOfficial: true, modelVersion: 2, indicatorNameAr: "ينفذ إجراءات علمية لتحسين نتائج التعلم", weight: 5 })).toBe(false);
  });

  it("يستخرج خلايا D-014 المعلّقة من لقطة نموذج الدورة", () => {
    const snap = {
      model: { key: "school-vice", official: true, version: 1 },
      indicators: [
        { nameAr: "ينفذ إجراءات علمية لتحسين نتائج التعلم", weight: 5 },
        { nameAr: "أداء الواجبات الوظيفية", weight: 10 },
      ],
    };
    expect(snapshotAwaitingFaresCells(snap)).toEqual(["ينفذ إجراءات علمية لتحسين نتائج التعلم"]);
    expect(snapshotAwaitingFaresCells({ model: { official: false }, indicators: [] })).toEqual([]);
  });

  it("النص الموحّد", () => {
    expect(AWAITING_FARES_LABEL).toBe("بانتظار المطابقة مع نظام فارس");
  });
});

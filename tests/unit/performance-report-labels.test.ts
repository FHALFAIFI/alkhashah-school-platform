import { describe, it, expect } from "vitest";
import {
  OVERALL_REPORT_LABEL,
  OVERALL_REPORT_SECTIONS,
  individualReportLabel,
  resultBandLabel,
  trainingRecommendation,
} from "@/lib/performance/report-labels";
import {
  COMMITTEE_CARD_LABEL,
  COMMITTEE_REGISTRY_LABEL,
  MEMBER_TASK_HEADERS,
} from "@/lib/committees/report-labels";

/**
 * v2.4.1 §1.4 / §1.5 / §5.5 / §5.6 — مسميات التقارير وفئات النتيجة.
 *
 * القاعدة المحمية: صياغة المدير تظهر حرفياً حيث تنطبق، والمنسوب غير المعلم لا يُسمّى
 * «معلماً» (D-019). ولا تقدير لفظي مخترع للنتيجة — الفئة شريحة رقمية معلنة.
 */

describe("§1.4 — تسميات تقارير الأداء", () => {
  it("التقرير الفردي بصياغة المدير للمعلم، وبالمحايدة لغيره", () => {
    expect(individualReportLabel("معلم")).toBe("تقرير تفصيلي للمعلم");
    expect(individualReportLabel("موظف إداري")).toBe("تقرير تفصيلي للموظف");
  });

  it("التقرير الشامل بصياغة المدير حرفياً", () => {
    expect(OVERALL_REPORT_LABEL).toBe("تقرير تفصيلي وإحصائي للجميع");
  });

  it("أقسام التقرير الشامل أربعة بالترتيب المطلوب", () => {
    const sections = Object.values(OVERALL_REPORT_SECTIONS);
    expect(sections).toHaveLength(4);
    expect(OVERALL_REPORT_SECTIONS.summary).toContain("الملخص الإحصائي");
    expect(OVERALL_REPORT_SECTIONS.strengthsWeaknesses).toContain("القوة والضعف");
    expect(OVERALL_REPORT_SECTIONS.training).toContain("التدريب والتطوير");
    expect(OVERALL_REPORT_SECTIONS.appendix).toContain("بالأسماء");
  });
});

describe("§1.4 — الفئة النهائية شريحة رقمية لا تقدير لفظي", () => {
  it("تعيد الشريحة المعتمدة نفسها لا وصفاً مخترعاً", () => {
    expect(resultBandLabel(null)).toBe("لم يكتمل التقييم بعد");
    expect(resultBandLabel(0)).toBe("أقل من 60٪");
    expect(resultBandLabel(59.9)).toBe("أقل من 60٪");
    expect(resultBandLabel(60)).toBe("60–74٪");
    expect(resultBandLabel(74.9)).toBe("60–74٪");
    expect(resultBandLabel(75)).toBe("75–89٪");
    expect(resultBandLabel(89.9)).toBe("75–89٪");
    expect(resultBandLabel(90)).toBe("90٪ فأعلى");
    expect(resultBandLabel(100)).toBe("90٪ فأعلى");
  });

  it("لا تحتوي أي شريحة تقديراً لفظياً مثل «ممتاز» أو «ضعيف»", () => {
    const verbal = ["ممتاز", "جيد جداً", "جيد", "ضعيف", "مقبول"];
    for (const p of [null, 0, 60, 75, 90]) {
      const label = resultBandLabel(p);
      for (const v of verbal) expect(label).not.toContain(v);
    }
  });
});

describe("§1.4 — التوصية التدريبية تشير ولا تخترع برنامجاً", () => {
  it("تعيد ذكر المعيار وعدد المتأثرين وتترك القرار للمدير", () => {
    const text = trainingRecommendation("إدارة الصف", 4);
    expect(text).toContain("إدارة الصف");
    expect(text).toContain("4");
    expect(text).toContain("تطوير مهني");
  });
});

describe("§1.5 — مسميات تقارير اللجان وترويسة جدول الأعضاء", () => {
  it("الاسمان بصياغة المدير حرفياً ومتمايزان", () => {
    expect(COMMITTEE_REGISTRY_LABEL).toBe("سجل المجالس واللجان التفصيلي");
    expect(COMMITTEE_CARD_LABEL).toBe("بطاقة مجلس أو لجنة");
    expect(COMMITTEE_REGISTRY_LABEL).not.toBe(COMMITTEE_CARD_LABEL);
  });

  it("ترويسة العضو/المهمة أربعة أعمدة بالترتيب المطلوب", () => {
    expect([...MEMBER_TASK_HEADERS]).toEqual(["العضو", "الصفة", "المهمة", "حالة التنفيذ"]);
  });
});

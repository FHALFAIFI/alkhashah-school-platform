import { describe, it, expect } from "vitest";
import {
  APPROVE_AND_ISSUE_CTA,
  CREATE_ALL_SEPARATE_CTA,
  CREATE_ISSUE_CTA,
  CREATE_SELECTED_CTA,
  DEFAULT_REQUESTED_ACTION,
  DOWNLOAD_PDF_CTA,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_FIELD_UNSET,
  PRINT_REPORT_CTA,
  REVIEW_BEFORE_CREATE_CTA,
  RUN_INSPECTION_CTA,
  SKIP_FOR_NOW_CTA,
  VIEW_ISSUE_CTA,
  inspectionResultMessage,
  isMaintenanceCategory,
  safetyImpactFromFinding,
} from "@/lib/building/maintenance-report";

/**
 * v2.4.1 §1.2 / §5.2 — نصوص سير «الفحص ← الصيانة».
 *
 * النتيجة بعد الفحص هي أول ما يقرؤه المدير، وصياغتها العربية تفرّق المفرد والمثنى
 * والجمع. أثر السلامة **مشتق من خطورة الملاحظة نفسها** لا من تقدير جديد.
 */

describe("§1.2 — رسالة نتيجة الفحص", () => {
  it("تقول الصيغة العربية الصحيحة لكل عدد", () => {
    expect(inspectionResultMessage(0)).toBe("لم تُسجَّل ملاحظات تحتاج إلى صيانة");
    expect(inspectionResultMessage(1)).toBe("تم تسجيل ملاحظة واحدة تحتاج إلى صيانة");
    expect(inspectionResultMessage(2)).toBe("تم تسجيل ملاحظتين تحتاجان إلى صيانة");
    expect(inspectionResultMessage(3)).toBe("تم تسجيل 3 ملاحظات تحتاج إلى صيانة");
    expect(inspectionResultMessage(11)).toBe("تم تسجيل 11 ملاحظات تحتاج إلى صيانة");
  });

  it("الصياغة التي طلبها المدير للثلاث ملاحظات محفوظة حرفياً", () => {
    expect(inspectionResultMessage(3)).toContain("تم تسجيل 3 ملاحظات تحتاج إلى صيانة");
  });
});

describe("§1.2 — أثر السلامة مشتق لا مُخترع", () => {
  it("البند الحرج يُقال حرجاً ويُربط بمنع الجاهزية", () => {
    const text = safetyImpactFromFinding({ critical: true, severity: "حرج" });
    expect(text).toContain("حرج");
    expect(text).toContain("سلامة");
  });

  it("البند غير الحرج يعيد ذكر درجة خطورته كما هي في القالب — بلا تقدير جديد", () => {
    expect(safetyImpactFromFinding({ critical: false, severity: "متوسط" })).toContain("متوسط");
    expect(safetyImpactFromFinding({ critical: false, severity: "منخفض" })).toContain("منخفض");
  });
});

describe("§1.2 — تصنيفات الصيانة قائمة مغلقة", () => {
  it("تقبل القيم المعرّفة فقط", () => {
    for (const c of MAINTENANCE_CATEGORIES) expect(isMaintenanceCategory(c)).toBe(true);
  });

  it("ترفض أي قيمة خارج القائمة — حارس ضد نص حر مُلفَّق", () => {
    for (const bad of ["", "  ", "<script>", "كهرباء ", "أخرىxx"]) {
      expect(isMaintenanceCategory(bad)).toBe(false);
    }
  });

  it("النص البديل للحقل غير المُدخل معلن ولا يساوي «—»", () => {
    expect(MAINTENANCE_FIELD_UNSET).toBe("غير محدد");
    expect(MAINTENANCE_FIELD_UNSET).not.toBe("—");
  });
});

describe("§1.2 / Phase B — المسميات الظاهرة كما طلبها المدير", () => {
  it("نصوص الأزرار مطابقة حرفياً", () => {
    expect(RUN_INSPECTION_CTA).toBe("إجراء فحص");
    expect(CREATE_ISSUE_CTA).toBe("إنشاء بلاغ صيانة");
    expect(VIEW_ISSUE_CTA).toBe("عرض بلاغ الصيانة");
    expect(PRINT_REPORT_CTA).toBe("طباعة تقرير الصيانة");
    expect(DOWNLOAD_PDF_CTA).toBe("تنزيل PDF");
    expect(APPROVE_AND_ISSUE_CTA).toBe("اعتماد البلاغ وإصدار التقرير");
  });

  it("خيارات ما بعد الفحص أربعة ومتمايزة", () => {
    const options = [CREATE_SELECTED_CTA, CREATE_ALL_SEPARATE_CTA, REVIEW_BEFORE_CREATE_CTA, SKIP_FOR_NOW_CTA];
    expect(new Set(options).size).toBe(4);
    expect(CREATE_ALL_SEPARATE_CTA).toContain("منفصل");
  });

  it("الإجراء المطلوب الافتراضي نص إداري ثابت لا بيانات مُختلقة", () => {
    expect(DEFAULT_REQUESTED_ACTION).toBe("الكشف والمعالجة وإفادتنا بالنتيجة");
  });
});

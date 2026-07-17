import { describe, it, expect } from "vitest";
import {
  rowValidationDisplay,
  CLASSIFICATION_WARNING,
  CLASSIFICATION_RESOLVED_NOTE,
} from "@/lib/imports/validation-display";

describe("عرض تحذيرات التحقق حسب حالة القرار (البند الراسب 3)", () => {
  const v = { errors: ["رقم وظيفة مكرر مع الصف 2"], warnings: [CLASSIFICATION_WARNING, "اسم مكرر مع الصف 4"] };

  it("قبل الحسم (يحتاج مراجعة/مؤجل): التحذيرات نشطة ولا ملاحظة حسم", () => {
    for (const status of ["يحتاج مراجعة", "مؤجل"]) {
      const d = rowValidationDisplay(status, v);
      expect(d.activeWarnings).toEqual(v.warnings);
      expect(d.resolvedNotes).toEqual([]);
      expect(d.errors).toEqual(v.errors);
    }
  });

  it("بعد الحسم (جاهز/مستبعد/منفذ): تحذير التصنيف يستبدل بـ«تمت مراجعة التصنيف»", () => {
    for (const status of ["جاهز", "مستبعد", "منفذ"]) {
      const d = rowValidationDisplay(status, v);
      expect(d.activeWarnings).toEqual([]);
      expect(d.resolvedNotes).toEqual([CLASSIFICATION_RESOLVED_NOTE]);
      expect(d.errors).toEqual(v.errors); // الأخطاء تعرض دائماً
    }
  });

  it("صف محسوم بلا تحذير تصنيف: لا ملاحظة حسم", () => {
    const d = rowValidationDisplay("جاهز", { errors: [], warnings: ["اسم مكرر مع الصف 4"] });
    expect(d.resolvedNotes).toEqual([]);
    expect(d.activeWarnings).toEqual([]);
  });

  it("يتحمل غياب التحقق كلياً", () => {
    const d = rowValidationDisplay("جاهز", null);
    expect(d).toEqual({ errors: [], activeWarnings: [], resolvedNotes: [] });
  });
});

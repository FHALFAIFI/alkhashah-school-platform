import { describe, it, expect } from "vitest";
import { programStatusLabel, committeeStatusLabel, REOPEN_LABEL } from "@/lib/plan/status-labels";

/**
 * قرار المصطلحات: إجراء «اعتماد وإقفال» يعرض الحالة «معتمد ومقفل»/«معتمدة ومقفلة»
 * وإعادة الفتح «إعادة فتح بسبب موثق». دوال عرض فقط — لا تغيّر القيمة المخزَّنة.
 */
describe("status-labels — تسميات العرض لإجراءات الاعتماد والإقفال", () => {
  it("حالة البرنامج «معتمد» تُعرض «معتمد ومقفل»", () => {
    expect(programStatusLabel("معتمد")).toBe("معتمد ومقفل");
  });

  it("حالات البرنامج الأخرى تبقى كما هي (لا تعديل)", () => {
    expect(programStatusLabel("مسودة")).toBe("مسودة");
    expect(programStatusLabel("مقفل")).toBe("مقفل");
  });

  it("حالة اللجنة «معتمدة» تُعرض «معتمدة ومقفلة»", () => {
    expect(committeeStatusLabel("معتمدة")).toBe("معتمدة ومقفلة");
    expect(committeeStatusLabel("مسودة")).toBe("مسودة");
    expect(committeeStatusLabel("مقفلة")).toBe("مقفلة");
  });

  it("نص إعادة الفتح موحَّد", () => {
    expect(REOPEN_LABEL).toBe("إعادة فتح بسبب موثق");
  });
});

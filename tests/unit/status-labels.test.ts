import { describe, it, expect } from "vitest";
import { programStatusLabel, committeeStatusLabel, REOPEN_LABEL } from "@/lib/plan/status-labels";

/**
 * قرار المصطلحات (v2.3 §3, D-034): الفعل «اعتماد» والحالة «معتمد»/«معتمدة»
 * وإعادة الفتح «إعادة فتح بسبب موثق». دوال عرض فقط — لا تغيّر القيمة المخزَّنة.
 */
describe("status-labels — تسميات العرض لإجراءات الاعتماد (D-034)", () => {
  it("حالة البرنامج «معتمد» تُعرض «معتمد» كما هي", () => {
    expect(programStatusLabel("معتمد")).toBe("معتمد");
  });

  it("حالات البرنامج الأخرى تبقى كما هي (لا تعديل)", () => {
    expect(programStatusLabel("مسودة")).toBe("مسودة");
    expect(programStatusLabel("مقفل")).toBe("مقفل");
  });

  it("حالة اللجنة «معتمدة» تُعرض «معتمدة» كما هي", () => {
    expect(committeeStatusLabel("معتمدة")).toBe("معتمدة");
    expect(committeeStatusLabel("مسودة")).toBe("مسودة");
    expect(committeeStatusLabel("مقفلة")).toBe("مقفلة");
  });

  it("نص إعادة الفتح موحَّد", () => {
    expect(REOPEN_LABEL).toBe("إعادة فتح بسبب موثق");
  });
});

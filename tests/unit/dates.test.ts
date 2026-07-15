import { describe, it, expect } from "vitest";
import {
  parseIsoDate,
  toHijriNumeric,
  dualDisplay,
  holidayWarnings,
} from "@/lib/dates";

describe("التواريخ الهجرية (أم القرى)", () => {
  it("يحول تاريخ عودة المعلمين 2026-08-23 إلى 1448/3/10 كما في التقويم الرسمي", () => {
    const d = parseIsoDate("2026-08-23")!;
    expect(toHijriNumeric(d)).toBe("1448/3/10");
  });

  it("يحول بداية الدراسة 2026-08-30 إلى 1448/3/17", () => {
    const d = parseIsoDate("2026-08-30")!;
    expect(toHijriNumeric(d)).toBe("1448/3/17");
  });

  it("سياق المعلم: هجري أولاً — سياق الموظف: ميلادي أولاً", () => {
    const t = dualDisplay("2026-08-23", "teacher")!;
    expect(t.primary).toContain("1448");
    expect(t.secondary).toContain("2026");
    const e = dualDisplay("2026-08-23", "employee")!;
    expect(e.primary).toContain("2026");
    expect(e.secondary).toContain("1448");
  });

  it("النص الهجري الرسمي يعرض حرفياً دون إعادة حساب", () => {
    const t = dualDisplay("2026-08-23", "teacher", "1448/3/10")!;
    expect(t.primary).toBe("1448/3/10هـ");
  });

  it("تاريخ بلا مقابل ميلادي (يُعتمد هجرياً) يعرض النص الرسمي", () => {
    const t = dualDisplay("غير متاح", "teacher", "1449/1/5")!;
    expect(t.primary).toBe("1449/1/5هـ");
  });

  it("الإجازات تنبه ولا تمنع", () => {
    const events = [
      { nameAr: "إجازة الخريف", gregFrom: "2026-11-20", gregTo: "2026-11-28", isHoliday: true },
      { nameAr: "عودة المعلمين", gregFrom: "2026-08-23", gregTo: "2026-08-23", isHoliday: false },
    ];
    expect(holidayWarnings("2026-11-25", events)).toEqual(["إجازة الخريف"]);
    expect(holidayWarnings("2026-08-23", events)).toEqual([]);
  });
});

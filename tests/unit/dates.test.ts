import { describe, it, expect } from "vitest";
import {
  parseIsoDate,
  toHijriNumeric,
  dualDisplay,
  holidayWarnings,
  hijriPartsOf,
  hijriToIso,
  hijriToDate,
  hijriMonthLength,
  isValidHijriDate,
  isValidIsoDate,
  fullDualLine,
  HIJRI_MONTHS,
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

describe("التحويل العكسي هجري ← ميلادي (أم القرى)", () => {
  it("يحول 1448/3/10 إلى 2026-08-23 (عودة المعلمين — مثبت من التقويم الرسمي)", () => {
    expect(hijriToIso({ year: 1448, month: 3, day: 10 })).toBe("2026-08-23");
  });

  it("يحول 1448/3/17 إلى 2026-08-30 (بداية الدراسة)", () => {
    expect(hijriToIso({ year: 1448, month: 3, day: 17 })).toBe("2026-08-30");
  });

  it("رحلة كاملة ذهاباً وعودة عبر سنتين هجريتين كاملتين يوماً بيوم", () => {
    // من 1447/1/1 حتى نهاية 1448: كل يوم يعود إلى نفسه بالاتجاهين
    for (const year of [1447, 1448]) {
      for (let month = 1; month <= 12; month++) {
        const len = hijriMonthLength(year, month);
        expect([29, 30]).toContain(len);
        for (const day of [1, 15, len]) {
          const iso = hijriToIso({ year, month, day });
          expect(iso).not.toBeNull();
          const back = hijriPartsOf(parseIsoDate(iso!)!);
          expect(back).toEqual({ year, month, day });
        }
      }
    }
  });

  it("حدود الشهر: اليوم التالي لآخر يوم في الشهر هو أول يوم في الشهر التالي", () => {
    for (let month = 1; month <= 11; month++) {
      const len = hijriMonthLength(1448, month);
      const lastIso = hijriToIso({ year: 1448, month, day: len })!;
      const next = new Date(parseIsoDate(lastIso)!.getTime() + 86_400_000);
      expect(hijriPartsOf(next)).toEqual({ year: 1448, month: month + 1, day: 1 });
    }
  });

  it("حدود السنة: بعد آخر يوم من ذي الحجة يأتي 1 محرم من السنة التالية", () => {
    const len = hijriMonthLength(1447, 12);
    const lastIso = hijriToIso({ year: 1447, month: 12, day: len })!;
    const next = new Date(parseIsoDate(lastIso)!.getTime() + 86_400_000);
    expect(hijriPartsOf(next)).toEqual({ year: 1448, month: 1, day: 1 });
  });

  it("يرفض التواريخ الهجرية المستحيلة", () => {
    // يوم 30 في شهر طوله 29
    for (let month = 1; month <= 12; month++) {
      if (hijriMonthLength(1448, month) === 29) {
        expect(hijriToIso({ year: 1448, month, day: 30 })).toBeNull();
      }
    }
    expect(hijriToIso({ year: 1448, month: 13, day: 1 })).toBeNull();
    expect(hijriToIso({ year: 1448, month: 0, day: 1 })).toBeNull();
    expect(hijriToIso({ year: 1448, month: 1, day: 31 })).toBeNull();
    expect(hijriToIso({ year: 1448, month: 1, day: 0 })).toBeNull();
    expect(isValidHijriDate({ year: 1448, month: 3, day: 10 })).toBe(true);
  });

  it("يتحقق من صحة ISO الميلادي ويرفض المستحيل", () => {
    expect(isValidIsoDate("2026-08-23")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true); // كبيسة
    expect(isValidIsoDate("26-08-23")).toBe(false);
    expect(isValidIsoDate("نص")).toBe(false);
  });

  it("السطر المزدوج الكامل يعرض اسمي الشهرين", () => {
    const line = fullDualLine("2026-08-23")!;
    expect(line).toContain("أغسطس");
    expect(line).toContain("2026م");
    expect(line).toContain("ربيع الأول");
    expect(line).toContain("1448هـ");
  });

  it("أسماء الأشهر الهجرية الاثنا عشر بترتيبها", () => {
    expect(HIJRI_MONTHS).toHaveLength(12);
    expect(HIJRI_MONTHS[0]).toBe("محرم");
    expect(HIJRI_MONTHS[8]).toBe("رمضان");
    expect(HIJRI_MONTHS[11]).toBe("ذو الحجة");
  });

  it("التحويل مثبت على منتصف اليوم UTC فلا ينزلق اليوم بين المناطق الزمنية", () => {
    const d = hijriToDate({ year: 1448, month: 3, day: 10 })!;
    expect(d.getUTCHours()).toBe(12);
  });
});

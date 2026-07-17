import { describe, it, expect } from "vitest";
import { cellNumber, cellText } from "@/lib/imports/xlsx";

describe("cellNumber — قراءة الأرقام من خلايا Excel (البند الراسب: صف الإجمالي الشبح)", () => {
  it("يعيد الأرقام كما هي", () => {
    expect(cellNumber(0)).toBe(0);
    expect(cellNumber(1448)).toBe(1448);
    expect(cellNumber("5200")).toBe(5200);
    expect(cellNumber("300")).toBe(300);
    expect(cellNumber("-12.5")).toBe(-12.5);
  });

  it("نص عربي بلا أرقام يعيد null لا صفراً — كي لا تتسرّب صفوف العناوين/الإجماليات كسجل seq=0", () => {
    expect(cellNumber("إجمالي الميزانية المدرسية المباشرة")).toBeNull();
    expect(cellNumber("البند")).toBeNull();
    expect(cellNumber("م")).toBeNull();
    expect(cellNumber("—")).toBeNull();
    expect(cellNumber("")).toBeNull();
    expect(cellNumber(null)).toBeNull();
    expect(cellNumber(undefined)).toBeNull();
  });

  it("يستخرج الرقم من نص مختلط", () => {
    expect(cellNumber("1000 ريال")).toBe(1000);
    expect(cellNumber("رقم 42")).toBe(42);
  });
});

describe("cellText", () => {
  it("يحوّل التاريخ إلى صيغة ISO مقصوصة والقيم الفارغة إلى نص فارغ", () => {
    expect(cellText(null)).toBe("");
    expect(cellText("  نص  ")).toBe("نص");
    expect(cellText(new Date("2026-07-17T00:00:00Z"))).toBe("2026-07-17");
  });
});

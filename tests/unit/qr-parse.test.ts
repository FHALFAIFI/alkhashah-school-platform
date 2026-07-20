import { describe, it, expect } from "vitest";
import { parseScanInput } from "@/lib/building/qr-parse";

describe("parseScanInput — تحليل رمز QR/الإدخال اليدوي", () => {
  it("رابط غرفة يحوي uuid → غرفة بالمعرّف", () => {
    const r = parseScanInput("https://school.ts.net/building/rooms/1b52b5a0-0000-4000-8000-000000000abc");
    expect(r).toEqual({ kind: "room", by: "id", value: "1b52b5a0-0000-4000-8000-000000000abc" });
  });
  it("رابط أصل يحوي ?رمز=CODE → أصل بالرمز", () => {
    const r = parseScanInput("https://school.ts.net/building/assets?%D8%B1%D9%85%D8%B2=KHS-AST-0007");
    expect(r).toEqual({ kind: "asset", by: "code", value: "KHS-AST-0007" });
  });
  it("رمز غرفة خام", () => {
    expect(parseScanInput("KHS-RM-0012")).toEqual({ kind: "room", by: "code", value: "KHS-RM-0012" });
  });
  it("رمز أصل خام (غير حساس لحالة الأحرف)", () => {
    expect(parseScanInput("khs-ast-0003")).toEqual({ kind: "asset", by: "code", value: "khs-ast-0003" });
  });
  it("مدخل فارغ أو غير معروف → null", () => {
    expect(parseScanInput("")).toBeNull();
    expect(parseScanInput("مرحبا")).toBeNull();
  });
});

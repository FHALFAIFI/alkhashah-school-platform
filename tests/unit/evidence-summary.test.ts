import { describe, it, expect } from "vitest";
import { evidenceCountPhrase } from "@/lib/plan/evidence-summary";

// D-025: عدد الشواهد معلوماتي فقط بصياغة عربية صحيحة — بلا هدف أو حصة أو نسبة أو «متبقٍّ».
describe("evidenceCountPhrase — صياغة الحالة الفعلية لعدد الشواهد", () => {
  it("لا شواهد → «لم يتم رفع أي شاهد حتى الآن» (ويعامل السالب كصفر)", () => {
    expect(evidenceCountPhrase(0)).toBe("لم يتم رفع أي شاهد حتى الآن");
    expect(evidenceCountPhrase(-3)).toBe("لم يتم رفع أي شاهد حتى الآن");
  });
  it("مفرد ومثنى", () => {
    expect(evidenceCountPhrase(1)).toBe("تم رفع شاهد واحد");
    expect(evidenceCountPhrase(2)).toBe("تم رفع شاهدان");
  });
  it("جمع القلة 3–10 → «N شواهد»", () => {
    expect(evidenceCountPhrase(3)).toBe("تم رفع 3 شواهد");
    expect(evidenceCountPhrase(5)).toBe("تم رفع 5 شواهد");
    expect(evidenceCountPhrase(10)).toBe("تم رفع 10 شواهد");
  });
  it("التمييز ≥ 11 → «N شاهداً»", () => {
    expect(evidenceCountPhrase(11)).toBe("تم رفع 11 شاهداً");
    expect(evidenceCountPhrase(25)).toBe("تم رفع 25 شاهداً");
  });
});

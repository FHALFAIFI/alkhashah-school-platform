import { describe, it, expect } from "vitest";
import { assertNonProduction } from "../helpers/assert-non-production";

// أمان بيئة الاختبار: يجب أن يفشل الحارس مغلقاً إن أشار أي هدف إلى الإنتاج (فحص فعلي لا اسمي).
describe("assertNonProduction — حارس عدم-الإنتاج يفشل مغلقاً", () => {
  it("يقبل قاعدة اختبار سليمة (madrasa_test على 5544)", () => {
    expect(() => assertNonProduction("t", "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test")).not.toThrow();
  });
  it("يرفض قاعدة الإنتاج «madrasa» (لا ينتهي اسمها بـ _test)", () => {
    expect(() => assertNonProduction("t", "postgresql://madrasa:x@localhost:5544/madrasa")).toThrow(/_test/);
  });
  it("يرفض مؤشّر حاوية الإنتاج «madrasa-prod-db-1»", () => {
    expect(() => assertNonProduction("t", "postgresql://madrasa:x@madrasa-prod-db-1:5432/madrasa_test")).toThrow(/madrasa-prod/);
  });
  it("يرفض عنوان التطبيق الإنتاجي 192.168.0.48", () => {
    expect(() => assertNonProduction("t", "postgresql://madrasa:x@192.168.0.48:5544/madrasa_test")).toThrow(/192\.168\.0\.48/);
  });
  it("يرفض المنفذ الداخلي 5432 لحاوية الإنتاج", () => {
    expect(() => assertNonProduction("t", "postgresql://madrasa:x@localhost:5432/madrasa_test")).toThrow(/5432/);
  });
});

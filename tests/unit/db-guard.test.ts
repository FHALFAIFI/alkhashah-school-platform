import { describe, it, expect } from "vitest";
import {
  databaseNameFromUrl,
  isIsolatedTestDatabaseName,
  assertTestDatabase,
  assertConnectionSafety,
} from "@/db/guard";

const REAL = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa";
const TEST = "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa_test";

describe("حارس قاعدة البيانات — fail-closed", () => {
  it("يستخرج اسم القاعدة من الرابط", () => {
    expect(databaseNameFromUrl(REAL)).toBe("madrasa");
    expect(databaseNameFromUrl(TEST)).toBe("madrasa_test");
  });

  it("يميّز قاعدة الاختبار المعزولة بالاسم فقط", () => {
    expect(isIsolatedTestDatabaseName("madrasa_test")).toBe(true);
    expect(isIsolatedTestDatabaseName("test")).toBe(true);
    expect(isIsolatedTestDatabaseName("madrasa")).toBe(false);
    expect(isIsolatedTestDatabaseName("madrasa_prod")).toBe(false);
    // «latest» ينتهي بـ test نصياً لكنه ليس مقطعاً معزولاً
    expect(isIsolatedTestDatabaseName("latest")).toBe(false);
  });

  it("يرفض القاعدة الحقيقية في بيئة الاختبار (fail-closed)", () => {
    expect(() => assertTestDatabase(REAL)).toThrow(/fail-closed|رفض التشغيل/);
    expect(() => assertTestDatabase("postgresql://u:p@h:5544/madrasa_prod")).toThrow();
  });

  it("يقبل قاعدة الاختبار المعزولة", () => {
    expect(assertTestDatabase(TEST)).toBe("madrasa_test");
  });

  it("يرفض عند غياب الرابط أو تعذّر تحليله (الغموض = رفض)", () => {
    // تمرير صريح لرابط فارغ/غير صالح — الوسيط الافتراضي يقرأ من البيئة المضبوطة للاختبار
    expect(() => assertTestDatabase("")).toThrow();
    expect(() => assertTestDatabase("not a url")).toThrow();
    expect(() => databaseNameFromUrl(undefined)).toThrow();
  });

  it("assertConnectionSafety: يحرس فقط في بيئة الاختبار، وخامل في التطوير/الإنتاج", () => {
    const prev = process.env.MADRASA_ENV;
    // بيئة اختبار: يرفض القاعدة الحقيقية ويقبل قاعدة الاختبار
    process.env.MADRASA_ENV = "test";
    expect(() => assertConnectionSafety(REAL)).toThrow(/fail-closed|رفض التشغيل/);
    expect(() => assertConnectionSafety(TEST)).not.toThrow();
    // خارج بيئة الاختبار: خامل تماماً (لا يمنع القاعدة الحقيقية في التطوير)
    delete process.env.MADRASA_ENV;
    expect(() => assertConnectionSafety(REAL)).not.toThrow();
    if (prev === undefined) delete process.env.MADRASA_ENV;
    else process.env.MADRASA_ENV = prev;
  });
});

import { describe, it, expect } from "vitest";
import {
  sanitizeFeedbackText,
  moduleFromPath,
  deviceClassFromViewport,
  normalizeViewport,
  browserFamilyFromUA,
  isSafeInternalPath,
  statusRequiresNote,
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
} from "@/lib/feedback/constants";

describe("feedback constants & pure helpers", () => {
  it("الفئات والأهمية والحالات بالعربية وثابتة", () => {
    expect(FEEDBACK_CATEGORIES).toContain("مشكلة");
    expect(FEEDBACK_CATEGORIES).toContain("أخرى");
    expect(FEEDBACK_SEVERITIES).toEqual(["ملاحظة بسيطة", "تؤثر جزئياً على العمل", "تمنع إكمال العمل"]);
    expect(FEEDBACK_STATUSES).toEqual(["جديدة", "قيد المراجعة", "مخطط لمعالجتها", "تم الحل", "لن تُنفذ"]);
  });

  it("sanitizeFeedbackText يزيل محارف التحكم ويبقي السطر الجديد ويقص الطول", () => {
    const NUL = String.fromCharCode(0);
    const BEL = String.fromCharCode(7);
    const DEL = String.fromCharCode(127);
    const withControls = `أول${NUL}${BEL}ثان${DEL}\nسطر ثانٍ`;
    const out = sanitizeFeedbackText(withControls, 100);
    expect(out).not.toContain(NUL);
    expect(out).not.toContain(BEL);
    expect(out).not.toContain(DEL);
    expect(out).toContain("أولثان"); // النص العربي محفوظ بلا محارف التحكم
    expect(out).toContain("\n"); // السطر الجديد محفوظ
    expect(sanitizeFeedbackText("abcdef", 3)).toBe("abc"); // قص الطول
    expect(sanitizeFeedbackText("  محاط  ", 100)).toBe("محاط"); // قص الفراغات
    expect(sanitizeFeedbackText(null, 10)).toBe("");
  });

  it("sanitizeFeedbackText لا يفسّر HTML (يبقى نصاً خاماً — React يهرّبه عند العرض)", () => {
    const s = sanitizeFeedbackText("<script>alert(1)</script>", 200);
    expect(s).toBe("<script>alert(1)</script>"); // نص فقط، لا تنفيذ
  });

  it("moduleFromPath يشتق الوحدة العربية من المسار", () => {
    expect(moduleFromPath("/dashboard")).toBe("لوحة القيادة");
    expect(moduleFromPath("/plan/followup")).toBe("الخطة التشغيلية");
    expect(moduleFromPath("/committees/123/meetings/456")).toBe("اللجان والمجالس");
    expect(moduleFromPath("/admin/feedback")).toBe("الإدارة");
    expect(moduleFromPath("/pilot")).toBe("مركز التشغيل التجريبي");
    expect(moduleFromPath("/unknown-route")).toBe("أخرى");
    expect(moduleFromPath("")).toBe("أخرى");
  });

  it("deviceClassFromViewport يصنّف حسب العرض", () => {
    expect(deviceClassFromViewport(390)).toBe("جوال");
    expect(deviceClassFromViewport(768)).toBe("لوحي");
    expect(deviceClassFromViewport(1440)).toBe("سطح مكتب");
    expect(deviceClassFromViewport(0)).toBe("سطح مكتب"); // قيمة غير صالحة → افتراضي آمن
  });

  it("normalizeViewport يقبل الأرقام الصحيحة فقط", () => {
    expect(normalizeViewport("390x844")).toBe("390×844");
    expect(normalizeViewport("390×844")).toBe("390×844");
    expect(normalizeViewport("abc")).toBe("");
    expect(normalizeViewport("999999x1")).toBe(""); // خارج الحد
    expect(normalizeViewport(null)).toBe("");
  });

  it("browserFamilyFromUA يعيد عائلة عامة آمنة فقط", () => {
    expect(browserFamilyFromUA("Mozilla/5.0 ... Chrome/120 Safari/537")).toBe("Chrome");
    expect(browserFamilyFromUA("Mozilla/5.0 ... Version/17 Safari/605")).toBe("Safari");
    expect(browserFamilyFromUA("Mozilla/5.0 ... Firefox/121")).toBe("Firefox");
    expect(browserFamilyFromUA("")).toBe("غير معروف");
  });

  it("isSafeInternalPath يقبل المسارات الداخلية فقط ويرفض إعادة التوجيه", () => {
    expect(isSafeInternalPath("/committees/123")).toBe(true);
    expect(isSafeInternalPath("/")).toBe(true);
    expect(isSafeInternalPath("//evil.com")).toBe(false);
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("relative")).toBe(false);
    expect(isSafeInternalPath("/path with space")).toBe(false);
    expect(isSafeInternalPath(null)).toBe(false);
  });

  it("statusRequiresNote للحالات النهائية فقط", () => {
    expect(statusRequiresNote("لن تُنفذ")).toBe(true);
    expect(statusRequiresNote("تم الحل")).toBe(true);
    expect(statusRequiresNote("جديدة")).toBe(false);
    expect(statusRequiresNote("قيد المراجعة")).toBe(false);
  });
});

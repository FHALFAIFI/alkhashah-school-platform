import { describe, it, expect } from "vitest";
import {
  sanitizeCell,
  toCsv,
  safeFileName,
  clampPage,
  clampPageSize,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from "@/lib/reports/export-safety";
import {
  REPORT_CATEGORIES,
  REPORTS,
  reportByKey,
  reportsInCategory,
  isSortableColumn,
  reportHref,
} from "@/lib/reports/catalog";

/**
 * Scope v2.2 §D10/§10 — report catalogue integrity and export safety.
 */

describe("حقن الصيغ في التصدير", () => {
  it("يعطّل كل محارف بدء الصيغة", () => {
    for (const payload of ["=1+1", "+1", "-1", "@SUM(A1)", "=cmd|'/c calc'!A1"]) {
      const out = sanitizeCell(payload);
      expect(out.startsWith("'")).toBe(true);
      // النص الأصلي يبقى مقروءاً — لا تُحذف معلومة من المستخدم
      expect(out.slice(1)).toBe(payload);
    }
  });

  it("يعطّل محارف التحكم المستعملة لبدء صيغة", () => {
    expect(sanitizeCell("\tSUM(1)").startsWith("'")).toBe(true);
    expect(sanitizeCell("\r=1").startsWith("'")).toBe(true);
  });

  it("لا يمسّ النص العربي والأرقام العادية", () => {
    expect(sanitizeCell("المستلزمات")).toBe("المستلزمات");
    expect(sanitizeCell("1500")).toBe("1500");
    expect(sanitizeCell(1500)).toBe("1500");
  });

  it("يحوّل الفارغ إلى نص فارغ لا «null» ولا «undefined»", () => {
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(undefined)).toBe("");
  });

  it("CSV يهرّب الاقتباس ويعطّل الصيغ ويبدأ بـBOM", () => {
    const csv = toCsv(["العمود"], [['=HYPERLINK("http://x")']]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""http://x""');
  });

  it("CSV يعطّل صيغة في رأس العمود أيضاً", () => {
    expect(toCsv(["=BAD()"], [])).toContain("'=BAD()");
  });
});

describe("اسم ملف التصدير", () => {
  it("يمنع الخروج من المجلد وفواصل المسار", () => {
    const name = safeFileName("../../etc/passwd", "csv");
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("يحذف محارف التحكم", () => {
    const name = safeFileName("تقرير\r\nSet-Cookie: x=1", "csv");
    expect(name).not.toContain("\n");
    expect(name).not.toContain("\r");
  });

  it("يبقي العربية ويضيف الامتداد", () => {
    expect(safeFileName("سجل الإيرادات", "xlsx")).toBe("سجل الإيرادات.xlsx");
  });

  it("يعطي اسماً افتراضياً حين يفرغ الاسم", () => {
    expect(safeFileName("///", "csv")).toBe("تقرير.csv");
  });
});

describe("حدود الصفحات والتصدير", () => {
  it("يحصر حجم الصفحة ضمن الحد الأعلى", () => {
    expect(clampPageSize(999999)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize("50")).toBe(50);
  });

  it("القيم المشوّهة تسقط إلى الافتراضي الآمن", () => {
    for (const v of ["abc", -5, 0, null, undefined, NaN]) {
      expect(clampPageSize(v)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it("رقم الصفحة لا يكون أقل من 1", () => {
    expect(clampPage(-3)).toBe(1);
    expect(clampPage("abc")).toBe(1);
    expect(clampPage("7")).toBe(7);
  });
});

describe("تكامل فهرس التقارير", () => {
  it("الفئات الثلاث عشرة المطلوبة موجودة", () => {
    expect(REPORT_CATEGORIES).toHaveLength(13);
  });

  it("مفاتيح التقارير فريدة", () => {
    const keys = REPORTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("كل تقرير ينتمي إلى فئة معرّفة ويعلن صلاحية وأعمدة", () => {
    const categoryKeys = new Set(REPORT_CATEGORIES.map((c) => c.key));
    for (const r of REPORTS) {
      expect(categoryKeys.has(r.category), `${r.key} فئته غير معرّفة`).toBe(true);
      expect(r.permission.length).toBeGreaterThan(0);
      expect(r.columns.length).toBeGreaterThan(0);
      // مفاتيح الأعمدة فريدة داخل التقرير الواحد
      const colKeys = r.columns.map((c) => c.key);
      expect(new Set(colKeys).size, `${r.key} أعمدته مكرّرة`).toBe(colKeys.length);
    }
  });

  it("كل فئة فيها تقرير واحد على الأقل", () => {
    for (const c of REPORT_CATEGORIES) {
      expect(reportsInCategory(c.key).length, `${c.key} بلا تقارير`).toBeGreaterThan(0);
    }
  });

  it("الترتيب مقيَّد بأعمدة التقرير نفسه (قائمة بيضاء)", () => {
    expect(isSortableColumn("programs-active", "name")).toBe(true);
    // اسم عمود من تقرير آخر أو من قاعدة البيانات لا يُقبل
    expect(isSortableColumn("programs-active", "password_hash")).toBe(false);
    expect(isSortableColumn("programs-active", "amount")).toBe(false);
    expect(isSortableColumn("لا-يوجد", "name")).toBe(false);
  });

  it("لا يعرّف أي تقرير عموداً حسّاساً", () => {
    const forbidden = ["password", "passwordHash", "sessionId", "token", "secret", "sha256", "storagePath", "htmlSnapshot"];
    for (const r of REPORTS) {
      for (const c of r.columns) {
        expect(forbidden, `${r.key}.${c.key} عمود حسّاس`).not.toContain(c.key);
      }
    }
  });

  it("الربط العميق يبني رابطاً صحيحاً بالفئة والتقرير والمرشّحات", () => {
    expect(reportHref("finance")).toBe("/reports?category=finance");
    const href = reportHref("finance", "expense-register", { itemId: "abc", empty: undefined });
    expect(href).toContain("category=finance");
    expect(href).toContain("report=expense-register");
    expect(href).toContain("itemId=abc");
    expect(href).not.toContain("empty");
  });

  /**
   * تحديث مقصود: صار للتحليل الرباعي نموذج بيانات حقيقي (`plan_swot_items`) يُستورد من
   * ورقة «التحليل الرباعي» الرسمية، فله تقاريره. القاعدة لم تتغيّر — التقرير يُبنى على
   * بيانات موجودة فعلاً — بل تغيّرت الحقيقة التي تُقاس عليها.
   */
  it("تقارير التحليل الرباعي معرَّفة على بيانات موجودة فعلاً", () => {
    const register = reportByKey("swot-register");
    expect(register).toBeDefined();
    expect(register!.category).toBe("risks");
    expect(register!.columns.map((c) => c.key)).toContain("implication");
    expect(reportByKey("swot-by-category")).toBeDefined();
  });

  it("لا يُعرَّف تقرير حضور اجتماعات — لا نموذج حضور في المنصة", () => {
    // قرار منتَج موثّق: العضوية تُسجَّل عند التشكيل فقط، بلا حضور ولا غياب ولا نصاب.
    // لا يُختلق تقرير لبيانات غير موجودة، ولا يُعرض زر يفتح تقريراً فارغاً.
    const attendanceLike = REPORTS.filter(
      (r) => r.key.includes("attendance") || r.label.includes("حضور") || r.label.includes("غياب"),
    );
    expect(attendanceLike).toHaveLength(0);
  });
});

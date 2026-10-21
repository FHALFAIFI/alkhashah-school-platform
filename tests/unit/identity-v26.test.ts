import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_IDENTITY, resolveHeader } from "@/lib/document-identity";
import { parseTemplateConfig } from "@/lib/templates/schema";

/**
 * D-057 (v2.6 §E) — «إدارة التعليم» هي الجهة المخاطَبة، و«مكتب التعليم» خرج من نظام
 * الهوية نهائياً: لا يُصيَّر في أي ترويسة ولا يبقى له ذكر في الشيفرة — الاستثناء الوحيد
 * هو نص المصدر الوزاري الحرفي في `src/db/seed-data/committee-templates.ts`.
 *
 * تُثبَّت هنا أيضاً ألوان الهوية المركزية (v2.6 §E): تمريرها عبر `resolveHeader`
 * وسقوط القيمة المخزّنة غير الصالحة إلى اللون الافتراضي.
 */

const OFFICE_PHRASE = /مكتب التعليم|مكتب تعليم/;

describe("D-057 — لا مكتب تعليم في الترويسة", () => {
  it("الترويسة الافتراضية لا تحمل سطراً لمكتب التعليم", () => {
    const h = resolveHeader(DEFAULT_IDENTITY);
    expect(h.orgLines.some((line) => OFFICE_PHRASE.test(line))).toBe(false);
  });

  it("هوية مخزّنة قديمة تحمل قيمة لمكتب التعليم لا تُصيَّر", () => {
    // صفوف إعدادات قديمة قد تحمل الحقل المهجور بقيمته — لا يقرؤه العرض إطلاقاً
    const legacy = { ...DEFAULT_IDENTITY, educationOffice: "مكتب تعليم العيدابي" };
    const h = resolveHeader(legacy);
    expect(h.orgLines.some((line) => OFFICE_PHRASE.test(line))).toBe(false);
  });

  it("التجاوز لكل وثيقة لا يعيد مكتب التعليم أيضاً", () => {
    const h = resolveHeader(DEFAULT_IDENTITY, {}, { educationOffice: "مكتب تعليم العيدابي" });
    expect(h.orgLines.some((line) => OFFICE_PHRASE.test(line))).toBe(false);
  });
});

describe("D-057 — لا ذكر لمكتب التعليم في الشيفرة", () => {
  const root = process.cwd();

  /** الاستثناء الوحيد: نص المصدر الوزاري الحرفي — لا يُمس (سياسة المصدر الحرفي) */
  const ALLOWLIST = new Set(["src/db/seed-data/committee-templates.ts"]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
      else out.push(rel);
    }
    return out;
  }

  it("لا ملف تحت src/ يحوي «مكتب التعليم» عدا نص المصدر الوزاري", () => {
    const offenders = walk("src")
      .filter((f) => !ALLOWLIST.has(f))
      .filter((f) => OFFICE_PHRASE.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("D-057 — إعدادات قوالب مخزّنة قديمة", () => {
  it("إعداد مخزّن يحمل مفتاح officeText القديم يُقبل ويُحذف المفتاح بصمت", () => {
    // نسخ `template_versions` الصادرة قبل D-057 قد تحمل المفتاح — لا تسقط إلى الافتراضي
    const parsed = parseTemplateConfig({ identity: { schoolName: "مدرسة", officeText: "قيمة قديمة" } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.identity?.schoolName).toBe("مدرسة");
      expect("officeText" in (parsed.config.identity ?? {})).toBe(false);
    }
  });

  it("المفاتيح المجهولة الأخرى تبقى مرفوضة — strict كما هو", () => {
    expect(parseTemplateConfig({ identity: { unknownKey: "x" } }).ok).toBe(false);
  });
});

describe("ألوان الهوية المركزية (v2.6 §E)", () => {
  it("القيم الافتراضية تمر عبر resolveHeader", () => {
    const h = resolveHeader(DEFAULT_IDENTITY);
    expect(h.primaryColor).toBe("#1f5244");
    expect(h.accentColor).toBe("#348066");
  });

  it("لون مخزّن صالح يمر كما هو", () => {
    const h = resolveHeader({ ...DEFAULT_IDENTITY, primaryColor: "#123abc", accentColor: "#FFF" });
    expect(h.primaryColor).toBe("#123abc");
    expect(h.accentColor).toBe("#FFF");
  });

  it("لون مخزّن غير صالح يسقط إلى الافتراضي", () => {
    const h = resolveHeader({ ...DEFAULT_IDENTITY, primaryColor: "red", accentColor: "javascript:alert(1)" });
    expect(h.primaryColor).toBe("#1f5244");
    expect(h.accentColor).toBe("#348066");
  });

  it("التجاوز لكل وثيقة يخضع للتحقق نفسه", () => {
    const valid = resolveHeader(DEFAULT_IDENTITY, {}, { primaryColor: "#7a1f1f" });
    expect(valid.primaryColor).toBe("#7a1f1f");
    const invalid = resolveHeader(DEFAULT_IDENTITY, {}, { primaryColor: "#zzzzzz" });
    expect(invalid.primaryColor).toBe("#1f5244");
  });
});

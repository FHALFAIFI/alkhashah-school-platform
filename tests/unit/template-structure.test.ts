import { describe, it, expect } from "vitest";
import {
  DOC_SECTIONS,
  SECTION_KEYS,
  columnsFor,
  resolveColumns,
  resolveSections,
  validateStructureKeys,
  allDocTypesHaveColumnDefinitions,
} from "@/lib/templates/structure";
import { renderTemplate, sampleValues, sampleTable } from "@/lib/templates/render";
import { DEFAULT_TEMPLATE_CONFIG, TEMPLATE_DOC_TYPES, parseTemplateConfig } from "@/lib/templates/schema";

/**
 * تحرير الأقسام والأعمدة (v2.2 §E2).
 *
 * الاختبارات تُثبت أن ما يختاره المدير في المحرّر **يظهر في الوثيقة المُصيَّرة فعلاً**:
 * الترتيب والإخفاء وإعادة التسمية والعرض. ولا يمرّ مفتاح خارج السجل المغلق.
 */

describe("سجل الأقسام والأعمدة", () => {
  it("كل نوع وثيقة له تعريف أعمدة (ولو فارغاً)", () => {
    expect(allDocTypesHaveColumnDefinitions()).toBe(true);
    expect(TEMPLATE_DOC_TYPES.length).toBe(14);
  });

  it("الخطاب الرسمي بلا جدول — قائمة أعمدة فارغة لا خيارات وهمية", () => {
    expect(columnsFor("official_letter")).toHaveLength(0);
  });

  it("مفاتيح الأقسام فريدة ولها تسميات عربية", () => {
    expect(new Set(SECTION_KEYS).size).toBe(SECTION_KEYS.length);
    for (const s of DOC_SECTIONS) {
      expect(s.label.trim()).not.toBe("");
      expect(/[a-zA-Z]/.test(s.label)).toBe(false);
    }
  });

  it("مفاتيح الأعمدة فريدة داخل كل نوع", () => {
    for (const t of TEMPLATE_DOC_TYPES) {
      const keys = columnsFor(t).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("التحقق من مفاتيح البنية", () => {
  it("يقبل المفاتيح المعروفة", () => {
    const res = validateStructureKeys(
      { sections: [{ key: "intro" }], columns: [{ key: "name" }] },
      "program_report",
    );
    expect(res.ok).toBe(true);
  });

  it("يرفض قسماً غير معروف ويسمّيه", () => {
    const res = validateStructureKeys({ sections: [{ key: "hacked" }] }, "program_report");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("hacked");
  });

  it("يرفض عموداً لا ينتمي لهذا النوع", () => {
    // «indicator» عمود تقرير الأداء لا تقرير البرنامج
    const res = validateStructureKeys({ columns: [{ key: "indicator" }] }, "program_report");
    expect(res.ok).toBe(false);
  });

  it("يرفض التكرار في الأقسام والأعمدة", () => {
    expect(validateStructureKeys({ sections: [{ key: "intro" }, { key: "intro" }] }, "program_report").ok).toBe(false);
    expect(validateStructureKeys({ columns: [{ key: "name" }, { key: "name" }] }, "program_report").ok).toBe(false);
  });

  it("النوع بلا أعمدة يرفض أي عمود", () => {
    expect(validateStructureKeys({ columns: [{ key: "name" }] }, "official_letter").ok).toBe(false);
  });
});

describe("دمج الأقسام والأعمدة", () => {
  it("الإعداد الفارغ يُبقي كل الأقسام ظاهرة بترتيبها الافتراضي", () => {
    const resolved = resolveSections(undefined);
    expect(resolved.map((s) => s.key)).toEqual([...SECTION_KEYS]);
    expect(resolved.every((s) => s.visible)).toBe(true);
  });

  it("إعادة الترتيب تُطبَّق، والقسم غير المذكور يبقى ظاهراً", () => {
    const resolved = resolveSections([
      { key: "notes", order: 0 },
      { key: "header", order: 1 },
    ]);
    expect(resolved[0].key).toBe("notes");
    expect(resolved[1].key).toBe("header");
    expect(resolved.find((s) => s.key === "body")?.visible).toBe(true);
  });

  it("العمود غير المذكور يحتفظ بتسميته الافتراضية", () => {
    const cols = resolveColumns("program_report", [{ key: "name", label: "اسم البرنامج" }]);
    expect(cols.find((c) => c.key === "name")?.label).toBe("اسم البرنامج");
    expect(cols.find((c) => c.key === "domain")?.label).toBe("المجال");
  });
});

describe("المُصيِّر يحترم الأقسام والأعمدة", () => {
  const ctx = { values: sampleValues(), docType: "program_report" as const, table: sampleTable("program_report") };

  it("إخفاء قسم يزيله من الناتج", () => {
    const withIntro = renderTemplate(
      { ...DEFAULT_TEMPLATE_CONFIG, text: { introText: "مقدمة الوثيقة" } },
      ctx,
    );
    expect(withIntro).toContain("مقدمة الوثيقة");

    const hidden = renderTemplate(
      {
        ...DEFAULT_TEMPLATE_CONFIG,
        text: { introText: "مقدمة الوثيقة" },
        sections: [{ key: "intro", visible: false }],
      },
      ctx,
    );
    expect(hidden).not.toContain("مقدمة الوثيقة");
  });

  it("عنوان القسم المُعاد تسميته يظهر في الناتج", () => {
    const html = renderTemplate(
      {
        ...DEFAULT_TEMPLATE_CONFIG,
        text: { introText: "نص" },
        sections: [{ key: "intro", label: "تمهيد اللجنة" }],
      },
      ctx,
    );
    expect(html).toContain("تمهيد اللجنة");
  });

  it("القسم غير القابل للتسمية لا يطبع عنواناً حتى لو حُفظت له تسمية", () => {
    const html = renderTemplate(
      { ...DEFAULT_TEMPLATE_CONFIG, text: { footerText: "تذييل" }, sections: [{ key: "footer", label: "عنوان ممنوع" }] },
      ctx,
    );
    expect(html).not.toContain("عنوان ممنوع");
  });

  it("إعادة ترتيب الأقسام تغيّر ترتيب الظهور فعلياً", () => {
    const config = {
      ...DEFAULT_TEMPLATE_CONFIG,
      text: { introText: "أولاً المقدمة", closingText: "ثانياً الخاتمة" },
    };
    const normal = renderTemplate(config, ctx);
    expect(normal.indexOf("أولاً المقدمة")).toBeLessThan(normal.indexOf("ثانياً الخاتمة"));

    const swapped = renderTemplate(
      { ...config, sections: [{ key: "closing", order: 0 }, { key: "intro", order: 1 }] },
      ctx,
    );
    expect(swapped.indexOf("ثانياً الخاتمة")).toBeLessThan(swapped.indexOf("أولاً المقدمة"));
  });

  it("إخفاء عمود يزيل عنوانه وخلاياه من الجدول", () => {
    const shown = renderTemplate(DEFAULT_TEMPLATE_CONFIG, ctx);
    expect(shown).toContain("المجال");

    const hidden = renderTemplate({ ...DEFAULT_TEMPLATE_CONFIG, columns: [{ key: "domain", visible: false }] }, ctx);
    expect(hidden).not.toContain("<th>المجال</th>");
  });

  it("تسمية العمود وترتيبه وعرضه تظهر في الجدول", () => {
    const html = renderTemplate(
      {
        ...DEFAULT_TEMPLATE_CONFIG,
        columns: [
          { key: "domain", label: "المجال الرسمي", order: 0, width: 30 },
          { key: "name", order: 1 },
        ],
      },
      ctx,
    );
    expect(html).toContain("المجال الرسمي");
    expect(html).toContain('style="width:30%"');
    expect(html.indexOf("المجال الرسمي")).toBeLessThan(html.indexOf("البرنامج"));
  });

  it("العرض خارج المدى يُحصر ولا يخرج نصاً حراً إلى CSS", () => {
    const html = renderTemplate(
      { ...DEFAULT_TEMPLATE_CONFIG, columns: [{ key: "name", width: 100 }] },
      ctx,
    );
    expect(html).toContain('style="width:100%"');
    // لا قيمة CSS إلا نسبة عددية
    expect(html).not.toMatch(/style="width:[^"]*[a-zA-Z(]/);
  });

  it("النوع بلا أعمدة لا يُصيِّر جدولاً", () => {
    const html = renderTemplate(DEFAULT_TEMPLATE_CONFIG, {
      values: sampleValues(),
      docType: "official_letter",
      table: sampleTable("official_letter"),
    });
    expect(html).not.toContain("<table");
  });

  it("الخلية الفارغة تُعرض «—» لا نصاً فارغاً ولا null", () => {
    const html = renderTemplate(DEFAULT_TEMPLATE_CONFIG, {
      values: sampleValues(),
      docType: "program_report",
      table: [{ name: "برنامج", domain: null, owner: undefined, period: "", executionStatus: "جارٍ", progress: "10٪" }],
    });
    expect(html).toContain("—");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
  });

  it("تسمية عمود خبيثة تُهرَّب ولا تُصيَّر وسماً حياً", () => {
    const html = renderTemplate(
      { ...DEFAULT_TEMPLATE_CONFIG, columns: [{ key: "name", label: "<img src=x onerror=alert(1)>" }] },
      ctx,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("قيمة خلية خبيثة تُهرَّب", () => {
    const html = renderTemplate(DEFAULT_TEMPLATE_CONFIG, {
      values: sampleValues(),
      docType: "program_report",
      table: [{ name: "<script>alert(1)</script>" }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("مخطط الإعداد يقبل بنية الأقسام والأعمدة", () => {
  it("يقبل إعداداً كاملاً بالأقسام والأعمدة", () => {
    const res = parseTemplateConfig({
      sections: [{ key: "intro", label: "تمهيد", visible: true, order: 0 }],
      columns: [{ key: "name", label: "البرنامج", visible: true, width: 40, order: 0 }],
    });
    expect(res.ok).toBe(true);
  });

  it("يرفض عرضاً خارج المدى", () => {
    expect(parseTemplateConfig({ columns: [{ key: "name", width: 500 }] }).ok).toBe(false);
    expect(parseTemplateConfig({ columns: [{ key: "name", width: 1 }] }).ok).toBe(false);
  });

  it("يرفض تسمية قسم تحوي وسماً", () => {
    const res = parseTemplateConfig({ sections: [{ key: "intro", label: "<b>عنوان</b>" }] });
    expect(res.ok).toBe(false);
  });
});

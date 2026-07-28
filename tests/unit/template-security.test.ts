import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeCssValue, containsHtmlMarkup } from "@/lib/html-escape";
import {
  parseTemplateConfig,
  mergeWithDefaults,
  DEFAULT_TEMPLATE_CONFIG,
  TEMPLATE_DOC_TYPES,
  DOC_TYPE_LABELS,
} from "@/lib/templates/schema";
import {
  renderPlaceholders,
  validatePlaceholders,
  placeholdersFor,
  extractPlaceholders,
  isTemplateDocType,
} from "@/lib/templates/placeholders";
import { renderTemplate, buildTemplateCss, sampleValues } from "@/lib/templates/render";

/**
 * Scope v2.2 §E3/§E6/§10 — template security.
 *
 * The template editor is the highest-risk surface added in this scope: it lets the
 * principal influence the content of official documents. These tests pin the guarantee
 * that no input path can produce executable markup, unsafe CSS, or a remote resource load.
 */

const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "<svg/onload=alert(1)>",
  "javascript:alert(1)",
  '"><script>alert(1)</script>',
  "<iframe src='data:text/html,<script>alert(1)</script>'></iframe>",
  "<a href=\"javascript:alert(1)\">x</a>",
  "<style>@import url('http://evil/x.css')</style>",
  "<!--<script>alert(1)</script>-->",
  "<body onload=alert(1)>",
];

describe("escapeHtml — التهريب الأساسي", () => {
  it("يهرّب كل المحارف الخطرة بما فيها علامتا الاقتباس", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("يمنع كل حمولات XSS من إنتاج وسم حي", () => {
    for (const payload of XSS_PAYLOADS) {
      const out = escapeHtml(payload);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/<img/i);
      expect(out).not.toMatch(/<iframe/i);
      expect(out).not.toMatch(/<svg/i);
      // لا يبقى أي قوس زاوية غير مهرَّب
      expect(out).not.toContain("<");
      expect(out).not.toContain(">");
    }
  });

  it("يمنع الخروج من سياق الخاصية", () => {
    const out = escapeHtml('" onerror="alert(1)');
    expect(out).not.toContain('"');
  });

  it("القيم الفارغة تصير نصاً فارغاً لا «null» ولا «undefined»", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(0)).toBe("0");
  });
});

describe("sanitizeCssValue — منع حقن CSS", () => {
  it("يزيل المحارف التي تسمح بالخروج أو التنفيذ", () => {
    for (const payload of ["expression(alert(1))", "url(javascript:alert(1))", "red; background:url(http://evil)", "</style><script>"]) {
      const out = sanitizeCssValue(payload);
      expect(out).not.toContain(":");
      expect(out).not.toContain(";");
      expect(out).not.toContain("<");
      expect(out).not.toContain("/");
    }
  });
});

describe("containsHtmlMarkup — حارس حدود الإدخال", () => {
  it("يكشف الوسوم والمخططات التنفيذية", () => {
    for (const payload of XSS_PAYLOADS) expect(containsHtmlMarkup(payload)).toBe(true);
  });
  it("لا يعترض النص العربي العادي", () => {
    expect(containsHtmlMarkup("تقرير برنامج التميز — 1448هـ")).toBe(false);
    expect(containsHtmlMarkup("الإيرادات: 5,000 ريال (المستلزمات)")).toBe(false);
  });
});

describe("§E6 — نموذج الإعداد المقيَّد بقائمة بيضاء", () => {
  it("يقبل الإعداد الافتراضي", () => {
    const res = parseTemplateConfig(DEFAULT_TEMPLATE_CONFIG);
    expect(res.ok).toBe(true);
  });

  it("يرفض أي مفتاح غير معروف بدل تجاهله صامتاً", () => {
    const res = parseTemplateConfig({ style: { primaryColor: "#1f5244" }, evilKey: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("غير معروف");
  });

  it("يرفض مفتاحاً غريباً داخل قسم فرعي", () => {
    const res = parseTemplateConfig({ style: { primaryColor: "#1f5244", customCss: "body{}" } });
    expect(res.ok).toBe(false);
  });

  it("يرفض لوناً خارج اللوحة المسموحة (يمنع حقن CSS)", () => {
    for (const bad of ["red; background:url(x)", "#fff", "expression(1)", "rgb(0,0,0)"]) {
      const res = parseTemplateConfig({ style: { primaryColor: bad } });
      expect(res.ok, `اللون «${bad}» كان يجب أن يُرفض`).toBe(false);
    }
  });

  it("يرفض خطاً خارج القائمة (يمنع خطاً بعيداً)", () => {
    const res = parseTemplateConfig({ style: { fontFamily: "url(http://evil/font.woff2)" } });
    expect(res.ok).toBe(false);
  });

  it("يرفض الأعداد خارج المدى", () => {
    expect(parseTemplateConfig({ style: { baseFontSize: 9999 } }).ok).toBe(false);
    expect(parseTemplateConfig({ style: { marginTop: -5 } }).ok).toBe(false);
    expect(parseTemplateConfig({ style: { lineHeight: 100 } }).ok).toBe(false);
  });

  it("يرفض النصوص التي تحوي وسم HTML أو محتوى تنفيذي", () => {
    for (const payload of XSS_PAYLOADS) {
      const res = parseTemplateConfig({ text: { titleAr: payload } });
      expect(res.ok, `الحمولة «${payload}» كان يجب أن تُرفض`).toBe(false);
      if (!res.ok) expect(res.error).toContain("غير آمن");
    }
  });

  it("يرفض المحتوى التنفيذي في تسميات الأعمدة والأقسام أيضاً", () => {
    expect(parseTemplateConfig({ columns: [{ key: "a", label: "<script>x</script>" }] }).ok).toBe(false);
    expect(parseTemplateConfig({ sections: [{ key: "s", label: "<img src=x onerror=1>" }] }).ok).toBe(false);
  });

  it("يرفض شعاراً بعنوان خارجي — معرّف ملف داخلي فقط", () => {
    expect(parseTemplateConfig({ identity: { logoFileId: "http://evil/logo.png" } }).ok).toBe(false);
    expect(parseTemplateConfig({ identity: { logoFileId: crypto.randomUUID() } }).ok).toBe(true);
  });

  it("يقبل النص العربي العادي وكل الحقول اختيارية (§8)", () => {
    expect(parseTemplateConfig({}).ok).toBe(true);
    const res = parseTemplateConfig({ text: { titleAr: "تقرير البرنامج", introText: "مقدمة عربية عادية 100٪." } });
    expect(res.ok).toBe(true);
  });

  it("الدمج مع الافتراضي لا يفقد قيمة مُدخلة", () => {
    const merged = mergeWithDefaults({ style: { baseFontSize: 14 } });
    expect(merged.style?.baseFontSize).toBe(14);
    expect(merged.style?.fontFamily).toBe("IBM Plex Sans Arabic");
  });
});

describe("§E3 — نظام العناصر النائبة", () => {
  it("يرفض عنصراً نائباً غير معروف", () => {
    const res = validatePlaceholders("مرحباً {{evil_key}}", "program_report");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("evil_key");
  });

  it("يرفض عنصراً نائباً غير متاح لهذا النوع", () => {
    // committee_name غير متاح في تقرير برنامج
    expect(validatePlaceholders("{{committee_name}}", "program_report").ok).toBe(false);
    expect(validatePlaceholders("{{committee_name}}", "committee_minutes").ok).toBe(true);
  });

  it("يقبل العناصر العامة في كل الأنواع", () => {
    for (const t of TEMPLATE_DOC_TYPES) {
      expect(validatePlaceholders("{{school_name}} — {{document_number}}", t).ok).toBe(true);
    }
  });

  it("يهرّب نص القالب وقيمة الاستبدال معاً", () => {
    const out = renderPlaceholders("<b>{{program_name}}</b>", { program_name: "<script>alert(1)</script>" });
    expect(out).not.toContain("<b>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("لا يعيد قراءة القيمة المستبدَلة بحثاً عن عناصر نائبة (لا استبدال متسلسل)", () => {
    // قيمة تحتوي نفسها عنصراً نائباً يجب ألّا تُستبدل مرة ثانية
    const out = renderPlaceholders("{{program_name}}", { program_name: "{{school_name}}", school_name: "سرّي" });
    expect(out).not.toContain("سرّي");
    expect(out).toContain("{{school_name}}");
  });

  it("العنصر النائب بلا قيمة يُصيَّر «—» لا اسمه الخام ولا فراغاً", () => {
    expect(renderPlaceholders("{{program_name}}", {})).toBe("—");
    expect(renderPlaceholders("{{program_name}}", { program_name: "" })).toBe("—");
    expect(renderPlaceholders("{{program_name}}", { program_name: null })).toBe("—");
  });

  it("لا يقيّم أي تعبير — لا دوال ولا وصول لكائنات", () => {
    for (const attempt of ["{{constructor}}", "{{__proto__}}", "{{process.env.SECRET}}", "{{7*7}}", "{{#each}}"]) {
      const out = renderPlaceholders(attempt, {});
      // إمّا يبقى نصاً كما هو أو «—»؛ لا ينتج قيمة محسوبة
      expect(out).not.toBe("49");
      expect(out).not.toContain("[object");
    }
  });

  it("لا يسرّب قيمة غير مذكورة في القائمة المعروفة", () => {
    const out = renderPlaceholders("{{school_name}}", { school_name: "المدرسة", DATABASE_URL: "postgres://secret" });
    expect(out).not.toContain("postgres");
  });

  it("يستخرج العناصر النائبة المذكورة", () => {
    expect(extractPlaceholders("{{a}} و{{b}} و{{a}}").sort()).toEqual(["a", "b"]);
  });

  it("كل نوع وثيقة له عناصر نائبة متاحة", () => {
    for (const t of TEMPLATE_DOC_TYPES) {
      expect(placeholdersFor(t).length, `${t} بلا عناصر نائبة`).toBeGreaterThan(0);
    }
  });

  it("يرفض نوع وثيقة مجهول عند حدود الإدخال", () => {
    expect(isTemplateDocType("program_report")).toBe(true);
    expect(isTemplateDocType("../../etc/passwd")).toBe(false);
    expect(isTemplateDocType("evil_type")).toBe(false);
  });
});

describe("§E2/§E4 — التصيير", () => {
  it("لا ينتج CSS تنفيذياً من إعداد افتراضي", () => {
    const css = buildTemplateCss(DEFAULT_TEMPLATE_CONFIG);
    expect(css).not.toContain("javascript:");
    expect(css).not.toContain("expression(");
    expect(css).not.toContain("@import");
    expect(css).toContain("@page");
  });

  it("قيمة نمط مجهولة تسقط إلى الافتراضي بدل الدخول في CSS", () => {
    // تجاوز المخطط عمداً لمحاكاة إعداد تالف في قاعدة البيانات
    const css = buildTemplateCss({ style: { primaryColor: "red;}body{background:url(http://evil)" } } as never);
    expect(css).not.toContain("evil");
    expect(css).not.toContain("url(");
    expect(css).toContain("#1f5244");
  });

  it("عدد خارج المدى يُحصر بدل أن يُكتب كما هو", () => {
    const css = buildTemplateCss({ style: { baseFontSize: 99999, marginTop: -40 } } as never);
    expect(css).not.toContain("99999");
    expect(css).not.toContain("-40mm");
  });

  it("الوثيقة المصيَّرة لا تحوي وسماً حياً من نص القالب", () => {
    const html = renderTemplate(
      { text: { titleAr: "عنوان {{program_name}}", footerText: "تذييل" } },
      { values: { program_name: "<script>alert(1)</script>", document_number: "D-1", print_date: "1448" } },
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("لا تحمّل الوثيقة أي مورد خارجي", () => {
    const html = renderTemplate(mergeWithDefaults({}), { values: sampleValues() });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("@import");
  });

  it("المعاينة ببيانات نموذجية تعمل لكل نوع وثيقة", () => {
    for (const t of TEMPLATE_DOC_TYPES) {
      const html = renderTemplate(DEFAULT_TEMPLATE_CONFIG, { values: sampleValues() });
      expect(html).toContain("<!doctype html>");
      expect(html).toContain('dir="rtl"');
      expect(DOC_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });

  it("جسم التقرير المولَّد على الخادم يُدرج كما هو (مهرَّب في مصدره)", () => {
    const html = renderTemplate({}, { values: {}, bodyHtml: "<table><tr><td>قيمة</td></tr></table>" });
    expect(html).toContain("<table>");
  });
});

describe("§E7 — نطاق القوالب", () => {
  it("الأنواع الأربعة عشر المطلوبة معرَّفة وبتسميات عربية", () => {
    expect(TEMPLATE_DOC_TYPES).toHaveLength(14);
    for (const t of TEMPLATE_DOC_TYPES) {
      expect(DOC_TYPE_LABELS[t], `${t} بلا تسمية عربية`).toBeTruthy();
    }
  });
});

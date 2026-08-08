import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  LIST_SEPARATOR,
  encodeListParam,
  decodeListParam,
  readListParam,
  writeListParam,
  canonicalListQuery,
  parseReportFilters,
  serializeReportFilters,
  filtersToStored,
  storedToParams,
} from "@/lib/reports/filters";

/**
 * D-066 — قيم المرشّح المتعدّد في معامل واحد، لا في مفاتيح مكرّرة.
 *
 * سبب العطل ليس في منطق الترشيح بل في شكل العنوان: يبني موجّه Next مفتاح جزء الصفحة من
 * `JSON.stringify(Object.fromEntries(new URLSearchParams(search)))`، وهذه العملية تُبقي
 * آخر تكرار لكل مفتاح وتُسقط ما قبله. فـ`?domain=أ&domain=ب` و`?domain=ب` يتقاسمان مفتاح
 * الجزء `__PAGE__?{"domain":"ب"}`، فيرى الموجّه أن الصفحة لم تتغيّر ولا يطلب تصييراً
 * جديداً — ويبقى الجدول والعدد على الاختيار السابق.
 *
 * لذلك يثبّت هذا الملف قاعدةً واحدة قابلة للفحص: **لا يخرج من المنصة عنوانٌ يحمل مفتاحاً
 * مكرَّراً**، ومع ذلك تبقى العناوين القديمة مقروءة.
 */

/* ─────────────────── الترميز نفسه ─────────────────── */

describe("ترميز قائمة القيم في معامل واحد", () => {
  it("الفاصل محرف تحكّم لا يمكن أن يرد في نص مكتوب أو معرّف", () => {
    expect(LIST_SEPARATOR).toBe("\u001f");
    expect(LIST_SEPARATOR).toHaveLength(1);
  });

  it("يعيد القيم كما هي — بالترتيب وبالعربية وبالمسافات", () => {
    const values = ["المجال الأول", "مسؤول الشؤون التعليمية", "3f1b2c8e-0000-4000-8000-000000000001"];
    expect(decodeListParam(encodeListParam(values))).toEqual(values);
  });

  it("قيمة واحدة لا تحمل فاصلاً إطلاقاً", () => {
    expect(encodeListParam(["المجال الأول"])).toBe("المجال الأول");
  });

  it("القيم المطبوعة كلها آمنة — الفاصلة والشرطة والنقطتان لا تكسر القائمة", () => {
    const values = ["التطوير, والتحسين", "أ|ب", "ج~د", "هـ:و", "ز،ح"];
    expect(decodeListParam(encodeListParam(values))).toEqual(values);
  });

  it("القائمة الفارغة تحذف المعامل بدل أن تكتبه فارغاً", () => {
    const sp = new URLSearchParams("domain=x&report=r");
    writeListParam(sp, "domain", []);
    expect(sp.toString()).toBe("report=r");
  });

  it("القراءة تقبل الشكلين: المعامل المفصول والمفاتيح المكرّرة (روابط قديمة)", () => {
    const modern = new URLSearchParams();
    writeListParam(modern, "domain", ["أ", "ب"]);
    expect(readListParam(modern, "domain")).toEqual(["أ", "ب"]);

    const legacy = new URLSearchParams();
    legacy.append("domain", "أ");
    legacy.append("domain", "ب");
    expect(readListParam(legacy, "domain")).toEqual(["أ", "ب"]);
  });
});

/* ─────────────────── التوحيد عند الوصول ─────────────────── */

describe("توحيد العنوان الموروث", () => {
  it("عنوان بلا تكرار لا يُمَس — لا إعادة توجيه بلا سبب", () => {
    expect(canonicalListQuery({ category: "plan", report: "x", domain: "أ" })).toBeNull();
  });

  it("المفاتيح المكرّرة تُجمَع في معامل واحد بالترتيب نفسه", () => {
    const canonical = canonicalListQuery({ category: "plan", domain: ["أ", "ب"], owner: "س" });
    expect(canonical).not.toBeNull();
    const sp = new URLSearchParams(canonical!);
    expect(sp.getAll("domain")).toHaveLength(1);
    expect(readListParam(sp, "domain")).toEqual(["أ", "ب"]);
    expect(sp.get("owner")).toBe("س");
    expect(sp.get("category")).toBe("plan");
  });

  it("العنوان الموحَّد يختلف عن عنوان القيمة الباقية وحدها — وهذا لبّ D-066", () => {
    const collapse = (query: string) => JSON.stringify(Object.fromEntries(new URLSearchParams(query)));

    // قبل التوحيد: العنوانان يتقاسمان مفتاح الجزء نفسه، فلا يرى الموجّه تغييراً
    expect(collapse("domain=أ&domain=ب")).toBe(collapse("domain=ب"));

    // بعده: لكل اختيار مفتاحه
    const twoValues = canonicalListQuery({ domain: ["أ", "ب"] })!;
    const oneValue = new URLSearchParams();
    writeListParam(oneValue, "domain", ["ب"]);
    expect(collapse(twoValues)).not.toBe(collapse(oneValue.toString()));
  });

  it("كل حالة رفع قيمة تُنتج مفتاح جزء مختلفاً — الأول والأوسط والأخير", () => {
    const key = (values: string[]) => {
      const sp = new URLSearchParams("category=plan&report=programs-by-domain");
      writeListParam(sp, "domain", values);
      return JSON.stringify(Object.fromEntries(new URLSearchParams(sp.toString())));
    };
    const all = key(["أ", "ب", "ج"]);
    expect(key(["ب", "ج"])).not.toBe(all); // رفع الأولى
    expect(key(["أ", "ج"])).not.toBe(all); // رفع الوسطى
    expect(key(["أ", "ب"])).not.toBe(all); // رفع الأخيرة
    expect(new Set([key(["ب", "ج"]), key(["أ", "ج"]), key(["أ", "ب"])]).size).toBe(3);
  });
});

/* ─────────────────── الأثر على الإطار كله ─────────────────── */

describe("المرشّحات المتعدّدة عبر الإطار", () => {
  const filters = parseReportFilters(new URLSearchParams("domain=أ&domain=ب&owner=س&col=name&col=domain"), {
    allowedColumns: ["name", "domain", "owner"],
  });

  it("القراءة من عنوان قديم تعطي القيم كاملة", () => {
    expect(filters.domains).toEqual(["أ", "ب"]);
    expect(filters.owners).toEqual(["س"]);
    expect(filters.columns).toEqual(["name", "domain"]);
  });

  it("الكتابة لا تُنتج مفتاحاً مكرَّراً", () => {
    const sp = serializeReportFilters(filters);
    for (const key of new Set(sp.keys())) expect(sp.getAll(key), `المفتاح «${key}» مكرَّر`).toHaveLength(1);
  });

  it("الدورة كاملة: عنوان ← مرشّحات ← عنوان ← مرشّحات — بلا فقد", () => {
    const round = parseReportFilters(serializeReportFilters(filters), {
      allowedColumns: ["name", "domain", "owner"],
    });
    expect(round.domains).toEqual(["أ", "ب"]);
    expect(round.columns).toEqual(["name", "domain"]);
  });

  it("الشكل المخزَّن يبقى مصفوفات كما كان قبل D-066 — لا هجرة لصفوف القوالب", () => {
    const stored = filtersToStored(filters);
    expect(stored.domain).toEqual(["أ", "ب"]);
    expect(stored.col).toEqual(["name", "domain"]);
    expect(JSON.stringify(stored)).not.toContain(LIST_SEPARATOR);
  });

  it("العودة من المخزَّن إلى عنوان لا تُنتج مفتاحاً مكرَّراً", () => {
    const sp = storedToParams(filtersToStored(filters));
    for (const key of new Set(sp.keys())) expect(sp.getAll(key), `المفتاح «${key}» مكرَّر`).toHaveLength(1);
    expect(parseReportFilters(sp).domains).toEqual(["أ", "ب"]);
  });
});

/* ─────────────────── قاعدة المصدر ─────────────────── */

describe("لا مفتاح مكرَّر يُكتب في أي عنوان", () => {
  const roots = ["src/app", "src/components", "src/lib"];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  /*
   * `URLSearchParams.append` هو الاستدعاء الوحيد الذي يُنتج مفتاحاً مكرَّراً. مسموح به على
   * مصدر لا يمكن أن يحمل المفتاح نفسه مرتين (نسخ زوج واحد)، لكن استعماله داخل حلقة على
   * مصفوفة قيم هو بالضبط الشكل الذي أعاد D-066 — فيُمنع بالنص لا بالمراجعة وحدها.
   */
  it("لا حلقة `for (... of values) sp.append(...)` في المصدر", () => {
    const offenders: string[] = [];
    for (const file of roots.flatMap((r) => walk(r))) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (/for\s*\([^)]*\bof\b[^)]*\)\s*\w+\.append\(/.test(line) && !line.includes("formData")) {
          offenders.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(offenders, `استعمل \`writeListParam\` بدلاً منها:\n${offenders.join("\n")}`).toEqual([]);
  });
});

/* ─────────────────── D-068 — تصادم معامل «التصنيف» ─────────────────── */

describe("D-068 — فئة التقرير ليست مرشّح تصنيف", () => {
  /*
   * `?category=building` في مركز التقارير يعني «فئة تقارير المبنى»، لا «صنّف السجلات
   * بـbuilding». وقد كان مرشّح «التصنيف» يستعمل الاسم نفسه، فكل تقرير يُفتح من المركز
   * ويُعلن هذا المرشّح كان يُرشَّح بقيمة لم يخترها أحد — و«بلاغات الصيانة» وحده يعلنه،
   * فكان يعود فارغاً دائماً مهما كانت البلاغات، وتظهر فوقه شريحة «التصنيف: building».
   */
  it("عنوان مركز التقارير لا يُنتج مرشّح تصنيف", () => {
    const filters = parseReportFilters(
      new URLSearchParams("category=building&report=maintenance-register"),
    );
    expect(filters.categories).toBeUndefined();
  });

  it("ومرشّح التصنيف الحقيقي يُقرأ من معامله الخاص", () => {
    const filters = parseReportFilters(
      new URLSearchParams(`category=building&report=maintenance-register&recordCategory=${encodeURIComponent("كهرباء" + LIST_SEPARATOR + "سباكة")}`),
    );
    expect(filters.categories).toEqual(["كهرباء", "سباكة"]);
  });

  it("والكتابة لا تمسّ معامل التنقّل", () => {
    const sp = serializeReportFilters({ categories: ["كهرباء"] }, new URLSearchParams("category=building&report=maintenance-register"));
    expect(sp.get("category")).toBe("building");
    expect(readListParam(sp, "recordCategory")).toEqual(["كهرباء"]);
  });
});

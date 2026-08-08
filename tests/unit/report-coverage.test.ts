import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPORTS, REPORT_CATEGORIES, reportByKey, type CategoryKey } from "@/lib/reports/catalog";
import { loaderKeys } from "@/lib/reports/loaders";

/**
 * مصفوفة القسم ↔ التقرير (v2.2 §D) — تدقيق شامل لا عيّنة.
 *
 * القاعدة المفروضة هنا: **كل قسم في التطبيق إمّا له تقرير عامل، وإمّا مصنَّف «لا ينطبق»
 * بسبب مكتوب.** لا قسم يسقط بين الاثنين، ولا زر تقرير يفتح تقريراً غير موجود.
 *
 * الاختبار يقرأ المسارات من نظام الملفات لا من قائمة مكتوبة يدوياً، فإضافة صفحة جديدة
 * بلا تصنيف تُسقط الاختبار بدل أن تمرّ صامتة.
 */

const APP_DIR = path.join(process.cwd(), "src/app/(app)");

/** كل مسارات التطبيق المشتقة من ملفات `page.tsx` */
function allRoutes(dir = APP_DIR, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...allRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      out.push(prefix === "" ? "/" : prefix);
    }
  }
  return out;
}

/**
 * التصنيف المعتمد لكل مسار: إمّا فئة تقارير، وإمّا «لا ينطبق» بسبب.
 *
 * الأنماط ذات `[` تُطابق المسارات الديناميكية. الترتيب لا يهم — المطابقة بالمسار الكامل.
 */
const MATRIX: Record<string, { category: CategoryKey } | { na: string }> = {
  // ── لوحات وواجهات لا سجلات لها ───────────────────────────────────────────
  "/dashboard": { na: "لوحة تجميع — تعرض ملخّصات التقارير نفسها ولا سجل مستقل لها" },
  "/pilot": { na: "قائمة قبول التشغيل التجريبي — ليست سجل بيانات" },
  "/reports": { na: "مركز التقارير نفسه" },
  "/reports/executive": { na: "تقرير تنفيذي مولَّد — مخرج لا قسم بيانات" },
  "/reports/individual": { na: "سير اختيار للتقرير الفردي — يقود إلى صفحة التقرير لا يعرض بيانات جديدة" },
  "/reports/builder": { na: "واجهة تأليف فوق سجل التقارير نفسه — لا مصدر بيانات جديد" },
  "/reports/templates": { na: "قوالب محفوظة — إعدادات تشغيل لا بيانات أعمال" },
  // v2.6: أرشيف التقارير المحفوظة — لقطات فوق سجل التقارير نفسه، لا مصدر بيانات جديداً
  "/reports/archive": { na: "أرشيف التقارير المحفوظة — لقطات مجمّدة فوق السجل الواحد (D-055)" },
  "/reports/archive/new": { na: "إنشاء تقرير محفوظ — واجهة تأليف فوق السجل الواحد" },
  "/reports/archive/[id]": { na: "تقرير محفوظ واحد — معاينته ومخرجاته من لقطته لا من مصدر جديد" },
  "/notifications": { na: "إشعارات لحظية لكل مستخدم — لا سجل مؤسسي يُصدَّر" },

  // ── إعدادات وإدارة ───────────────────────────────────────────────────────
  "/admin/settings": { na: "إعدادات التطبيق — تهيئة لا بيانات مدرسية" },
  "/admin/users": { na: "حسابات الدخول — بيانات أمنية لا تُصدَّر في تقارير" },
  "/admin/backup": { na: "تشغيل النسخ الاحتياطي — عملية لا سجل" },
  "/admin/cleanup": { na: "أدوات التنظيف — عملية إدارية" },
  "/admin/templates": { na: "قوالب الوثائق — تهيئة عرض لا بيانات مدرسية" },
  "/admin/audit": { category: "usage" },
  "/admin/feedback": { category: "usage" },
  "/admin/feedback/[id]": { category: "usage" },

  // ── الخطة والبرامج ───────────────────────────────────────────────────────
  "/plan": { category: "plan" },
  "/plan/[id]": { category: "plan" },
  "/plan/[id]/report": { na: "تقرير برنامج مولَّد — مخرج للصفحة الأب" },
  "/plan/classifications": { category: "plan" },
  // v2.4.1 §5.2: شاشة تصحيح تشغيلية — مخرجها تصحيح السجلات، والتقارير تقرأ النتيجة
  "/plan/consistency": { na: "شاشة مراجعة وتصحيح حالات — لا تقرير مستقل لها" },
  "/plan/followup": { category: "plan" },
  "/plan/kpis": { category: "plan" },
  "/plan/risks": { category: "risks" },
  "/plan/swot": { category: "risks" },
  "/tasks": { category: "plan" },
  "/calendar": { category: "plan" },

  // ── الشواهد والمالية ─────────────────────────────────────────────────────
  "/evidence": { category: "evidence" },
  "/evidence/[id]": { category: "evidence" },
  "/budget": { category: "finance" },
  "/budget/items/[id]": { na: "صفحة تفصيل بند مالي واحد — تقارير المالية تُفتح من لوحة المالية ومركز التقارير" },
  "/building/maintenance/[id]": { na: "صفحة متابعة بلاغ صيانة واحد — تقارير الصيانة من قائمة البلاغات ومركز التقارير" },
  // v2.4.1 §1.2: تنفيذ الفحص داخل منطقة الصيانة — شاشة إدخال، وتقاريرها في قائمة البلاغات
  "/building/maintenance/inspect": { na: "شاشة تنفيذ فحص وتحويل ملاحظاته إلى بلاغات — تقاريرها في «بلاغات الصيانة» ومركز التقارير" },
  "/performance/analytics": { category: "performance" },
  "/performance/employees/[personId]": { na: "تقرير تفصيلي لمنسوب واحد — تقارير الأداء من لوحة الأداء العام ومركز التقارير" },

  // ── الأداء الوظيفي ───────────────────────────────────────────────────────
  "/performance": { category: "performance" },
  "/performance/cycles/[id]": { category: "performance" },
  "/performance/cycles/[id]/sessions/[sid]": { category: "performance" },
  "/performance/models": { na: "نماذج التقييم الرسمية — تهيئة مرجعية لا سجل تشغيلي" },
  "/performance/models/[id]": { na: "تفاصيل نموذج تقييم — تهيئة مرجعية" },

  // ── اللجان والاجتماعات ───────────────────────────────────────────────────
  "/committees": { category: "committees" },
  "/committees/[id]": { category: "committees" },
  "/committees/[id]/report": { na: "تقرير لجنة مولَّد — مخرج للصفحة الأب" },
  "/committees/[id]/meetings/[mid]": { category: "meetings" },
  "/committees/templates": { na: "قوالب تشكيل اللجان — تهيئة مرجعية" },
  "/committees/meeting-types": { na: "أنواع الاجتماعات — تهيئة مرجعية" },
  "/committees/task-templates": { na: "قوالب مهام اللجان — تهيئة مرجعية" },

  // ── المبنى والمرافق ──────────────────────────────────────────────────────
  "/building": { category: "building" },
  "/building/rooms/[id]": { category: "building" },
  "/building/facilities": { category: "building" },
  "/building/assets": { category: "building" },
  "/building/maintenance": { category: "building" },
  "/building/inspections": { category: "building" },
  "/building/documents": { category: "documents" },
  "/building/report": { na: "تقرير المبنى المولَّد — مخرج للصفحة الأب" },
  "/building/3d": { na: "عرض ثلاثي الأبعاد — واجهة عرض للغرف نفسها" },
  "/building/editor/[floorKey]": { na: "محرّر مخطط الأدوار — تحرير هندسي لا سجل" },
  "/building/scan": { na: "مسح رمز الأصل — أداة إدخال" },
  "/building/offline": { na: "صفحة العمل دون اتصال — واجهة تشغيل" },
  "/building/inspections/templates": { na: "قوالب الفحص — تهيئة مرجعية" },
  "/building/inspections/templates/new": { na: "إنشاء قالب فحص — تهيئة مرجعية" },
  "/building/inspections/templates/[id]": { na: "تفاصيل قالب فحص — تهيئة مرجعية" },
  "/building/inspections/templates/[id]/edit": { na: "تحرير قالب فحص — تهيئة مرجعية" },

  // ── المنسوبون والوثائق والاستيراد ────────────────────────────────────────
  "/people": { category: "employees" },
  "/people/[id]": { category: "employees" },
  "/people/new": { na: "إضافة منسوب — نموذج إدخال" },
  "/documents": { category: "documents" },
  "/imports": { category: "imports" },
  "/imports/[id]": { category: "imports" },
  "/imports/new": { na: "بدء دفعة استيراد — نموذج إدخال" },
};

describe("مصفوفة القسم ↔ التقرير", () => {
  const routes = allRoutes();

  it("كل مسار في التطبيق مصنَّف: تقرير عامل أو «لا ينطبق» بسبب", () => {
    const unclassified = routes.filter((r) => !(r in MATRIX));
    expect(unclassified, `مسارات بلا تصنيف: ${unclassified.join("، ")}`).toEqual([]);
  });

  it("لا تصنيف زائد لمسار غير موجود — المصفوفة لا تتقادم صامتة", () => {
    const stale = Object.keys(MATRIX).filter((r) => !routes.includes(r));
    expect(stale, `تصنيفات لمسارات غير موجودة: ${stale.join("، ")}`).toEqual([]);
  });

  it("كل فئة مذكورة في المصفوفة موجودة فعلاً وتحوي تقريراً واحداً على الأقل", () => {
    for (const [route, entry] of Object.entries(MATRIX)) {
      if (!("category" in entry)) continue;
      const category = REPORT_CATEGORIES.find((c) => c.key === entry.category);
      expect(category, `${route} يشير إلى فئة غير معرّفة`).toBeDefined();
      expect(REPORTS.filter((r) => r.category === entry.category).length, `${route} → فئة بلا تقارير`).toBeGreaterThan(0);
    }
  });

  it("سبب «لا ينطبق» مكتوب بالعربية ومفهوم لا كلمة واحدة", () => {
    for (const [route, entry] of Object.entries(MATRIX)) {
      if (!("na" in entry)) continue;
      expect(entry.na.length, `${route} بسبب قصير جداً`).toBeGreaterThan(15);
      expect(/[a-zA-Z]{4,}/.test(entry.na), `${route} سببه ليس بالعربية`).toBe(false);
    }
  });

  it("كل فئة تقارير مذكورة في المصفوفة مرة واحدة على الأقل — لا فئة يتيمة", () => {
    const used = new Set(Object.values(MATRIX).flatMap((e) => ("category" in e ? [e.category] : [])));
    const orphans = REPORT_CATEGORIES.filter((c) => !used.has(c.key));
    // «التقييم الخارجي» فئة بيانات لا صفحة مستقلة لها — تُقرأ من مركز التقارير
    expect(orphans.map((c) => c.key)).toEqual(["external"]);
  });
});

describe("لا زر تقرير معطّل ولا تقرير بلا محمّل", () => {
  /** كل `SectionReportsLink` في التطبيق مع فئته وتقريره */
  function sectionLinks(): { file: string; category: string; report?: string }[] {
    const out: { file: string; category: string; report?: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".tsx")) {
          const src = readFileSync(full, "utf-8");
          for (const m of src.matchAll(/<SectionReportsLink\s+category="([^"]+)"(?:\s+report="([^"]+)")?/g)) {
            out.push({ file: full, category: m[1], report: m[2] });
          }
        }
      }
    };
    walk(APP_DIR);
    return out;
  }

  it("كل «تقارير القسم» يشير إلى فئة موجودة وتقرير موجود", () => {
    const links = sectionLinks();
    expect(links.length).toBeGreaterThan(10);
    for (const l of links) {
      expect(REPORT_CATEGORIES.some((c) => c.key === l.category), `${l.file}: فئة «${l.category}» غير معرّفة`).toBe(true);
      if (l.report) {
        const def = reportByKey(l.report);
        expect(def, `${l.file}: تقرير «${l.report}» غير معرّف`).toBeDefined();
        expect(def!.category, `${l.file}: تقرير «${l.report}» ليس في فئته المذكورة`).toBe(l.category);
      }
    }
  });

  it("كل تقرير في السجل له محمّل بيانات — لا تقرير معلَن بلا مصدر", () => {
    const keys = new Set(loaderKeys());
    const missing = REPORTS.filter((r) => !keys.has(r.key)).map((r) => r.key);
    expect(missing, `تقارير بلا محمّل: ${missing.join("، ")}`).toEqual([]);
  });

  it("كل محمّل يقابله تقرير معلَن — لا محمّل يتيم", () => {
    const declared = new Set(REPORTS.map((r) => r.key));
    const orphans = loaderKeys().filter((k) => !declared.has(k));
    expect(orphans, `محمّلات بلا تقرير: ${orphans.join("، ")}`).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  INSTANCE_TYPES,
  instanceTypeByKey,
  sectionsOf,
  requiredPermissions,
  isSensitiveType,
} from "@/lib/reports/instances/types";
import { reportByKey } from "@/lib/reports/catalog";
import {
  BASE_TEMPLATES,
  baseTemplateByKey,
  resolveStyleConfig,
  styleConfigSchema,
} from "@/lib/reports/instances/base-templates";
import { parseInstanceOptions, instanceFileBase, readSnapshot } from "@/lib/reports/instances/options";
import { tableLayoutFor, splitColumns, cellText } from "@/lib/reports/instances/render";
import { linkForCell } from "@/lib/reports/instances/links";
import { validateDocument } from "@/lib/reports/instances/validation";
import type { SnapshotDoc } from "@/lib/reports/instances/options";

/**
 * v2.6 — الوحدات الخالصة لسجل أنواع التقارير والقوالب الأساسية والخيارات والتخطيط.
 */

describe("سجل الأنواع (D-056)", () => {
  it("كل قسم في كل نوع مركّب يشير إلى تقرير معلَن فعلاً في السجل", () => {
    for (const type of INSTANCE_TYPES) {
      for (const section of type.sections) {
        expect(reportByKey(section.reportKey), `${type.key}/${section.key} → ${section.reportKey}`).toBeTruthy();
      }
    }
  });

  it("كل نوع يحمل قالباً أساسياً افتراضياً موجوداً", () => {
    for (const type of INSTANCE_TYPES) {
      expect(baseTemplateByKey(type.defaultTemplateKey), type.key).toBeTruthy();
    }
  });

  it("النوع المفرد يبني قسمه من مفتاح التقرير، ويرفض المفتاح المجهول", () => {
    expect(sectionsOf("single", { reportKey: "programs-active" })).toHaveLength(1);
    expect(sectionsOf("single", { reportKey: "لا-وجود-له" })).toHaveLength(0);
    expect(sectionsOf("single", {})).toHaveLength(0);
  });

  it("صلاحيات النوع = اتحاد صلاحيات أقسامه", () => {
    const perms = requiredPermissions("periodic", {});
    expect(perms).toContain("plan.read");
    expect(perms).toContain("maintenance.read");
    expect(perms).toContain("budget.read");
    expect(perms).toContain("committees.read");
  });

  it("الحساسية تُشتق من أقسام التقرير (D-013)", () => {
    expect(isSensitiveType("single", { reportKey: "perf-results" })).toBe(true);
    expect(isSensitiveType("single", { reportKey: "programs-active" })).toBe(false);
    // الأنواع المركّبة الحالية كلها غير حسّاسة — توزيع الأداء إحصائي بلا أسماء
    for (const type of INSTANCE_TYPES.filter((t) => t.key !== "single")) {
      expect(isSensitiveType(type.key, {}), type.key).toBe(false);
    }
  });

  it("مفاتيح الأقسام فريدة داخل النوع الواحد", () => {
    for (const type of INSTANCE_TYPES) {
      const keys = type.sections.map((s) => s.key);
      expect(new Set(keys).size, type.key).toBe(keys.length);
    }
  });
});

describe("القوالب الأساسية الخمسة (D-058)", () => {
  it("خمسة قوالب بالمفاتيح المتفق عليها", () => {
    expect(BASE_TEMPLATES.map((t) => t.key)).toEqual(["official", "internal", "executive", "analytical", "plain"]);
  });

  it("إعداد كل قالب أساسي صالح بمخططه الصارم", () => {
    for (const t of BASE_TEMPLATES) {
      expect(styleConfigSchema.safeParse(t.config).success, t.key).toBe(true);
    }
  });

  it("القالب بلا هوية لا يعرضها", () => {
    expect(baseTemplateByKey("plain")!.config.showIdentity).toBe(false);
  });

  it("الفرق المخصص الملفَّق يسقط كله ويبقى الأساس", () => {
    const evil = resolveStyleConfig("official", { primaryColor: "url(javascript:alert(1))", extra: "x" });
    expect(evil.primaryColor).toBe("#1f5244");
    const good = resolveStyleConfig("official", { primaryColor: "#123456" });
    expect(good.primaryColor).toBe("#123456");
  });

  it("مفتاح أساس مجهول يعود إلى القالب الأول لا إلى فشل", () => {
    expect(resolveStyleConfig("لا-وجود").primaryColor).toBe(BASE_TEMPLATES[0].config.primaryColor);
  });
});

describe("خيارات التقرير", () => {
  it("الخيار الملفَّق يسقط والصالح يبقى — صفّ معطوب لا يعطّل العرض", () => {
    const parsed = parseInstanceOptions({ reportKey: "programs-active", showEmpty: true, evil: "x" });
    expect(parsed.reportKey).toBe("programs-active");
    expect(parsed.showEmpty).toBe(true);
    expect((parsed as Record<string, unknown>).evil).toBeUndefined();
  });

  it("قيم من أنواع خاطئة تُسقط الخيار لا الكل", () => {
    const parsed = parseInstanceOptions({ showEmpty: "نعم", reportKey: "programs-active" });
    expect(parsed.reportKey).toBe("programs-active");
    expect(parsed.showEmpty).toBeUndefined();
  });

  it("اسم الملف: «الاسم الكامل - تاريخ الإنشاء» (§G)", () => {
    expect(instanceFileBase("التقرير الختامي للعام", "2026-08-08T10:00:00.000Z")).toBe("التقرير الختامي للعام - 2026-08-08");
    expect(instanceFileBase("  ", "2026-08-08T10:00:00.000Z")).toBe("تقرير - 2026-08-08");
  });

  it("لقطة من إصدار مجهول تُرفض قراءتها بدل عرض معطوب", () => {
    expect(readSnapshot({ version: 99 })).toBeNull();
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot("نص")).toBeNull();
  });
});

describe("تخطيط الجدول العريض (§F)", () => {
  it("8 أعمدة فأقل رأسي؛ 9-13 أفقي؛ فوق 13 تصغير محكوم؛ فوق 18 تقسيم", () => {
    expect(tableLayoutFor(5)).toEqual({ orientation: "portrait", fontScale: 1, splitAt: null });
    expect(tableLayoutFor(8)).toEqual({ orientation: "portrait", fontScale: 1, splitAt: null });
    expect(tableLayoutFor(9).orientation).toBe("landscape");
    expect(tableLayoutFor(13).fontScale).toBe(1);
    expect(tableLayoutFor(15).fontScale).toBe(0.85);
    expect(tableLayoutFor(20).splitAt).toBe(12);
  });

  it("التقسيم يكرر العمود الأول في كل مجموعة ولا يفقد عموداً", () => {
    const cols = Array.from({ length: 20 }, (_, i) => ({ key: `c${i}`, label: `عمود ${i}` }));
    const groups = splitColumns(cols, 12);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      expect(g[0].key).toBe("c0");
      expect(g.length).toBeLessThanOrEqual(12);
    }
    const seen = new Set(groups.flat().map((c) => c.key));
    expect(seen.size).toBe(20);
  });

  it("الخلية الفارغة شرطة، والتاريخ مزدوج التقويم (D-033)", () => {
    expect(cellText(null)).toBe("—");
    expect(cellText("")).toBe("—");
    expect(cellText(0)).toBe("0");
    expect(cellText("2026-08-08", "date")).toContain("2026");
  });
});

describe("الربط التفاعلي في المعاينة (§A)", () => {
  it("اسم البرنامج في تقارير البرامج يقصد صفحة الخطة", () => {
    expect(linkForCell("programs-active", "name", "برنامج القراءة")).toContain("/plan?search=");
    expect(linkForCell("programs-by-domain", "owner", "أحمد")).toContain("/people?search=");
  });

  it("لا رابط لقيمة فارغة ولا لعمود لا وجهة له", () => {
    expect(linkForCell("programs-active", "name", null)).toBeNull();
    expect(linkForCell("programs-active", "name", "—")).toBeNull();
    expect(linkForCell("programs-active", "progress", 55)).toBeNull();
  });

  it("nameAr يعني لجنة في تقارير اللجان فقط — لا في غيرها", () => {
    expect(linkForCell("committee-register", "nameAr", "لجنة التوجيه")).toContain("/committees?search=");
    expect(linkForCell("rooms-register", "nameAr", "غرفة")).toBeNull();
  });

  it("القيمة الخبيثة تُرمَّز في الرابط لا تُحقن", () => {
    const href = linkForCell("programs-active", "name", `"><script>`);
    expect(href).not.toContain("<script>");
    expect(href).toContain(encodeURIComponent(`"><script>`));
  });
});

describe("فحص ما قبل الاعتماد (§A)", () => {
  const doc = (over: Partial<SnapshotDoc>): SnapshotDoc => ({
    version: 1,
    typeKey: "single",
    typeLabel: "تقرير",
    title: "عنوان",
    periodFrom: "2026-01-01",
    periodTo: "2026-06-01",
    periodText: "الفترة",
    generatedAtIso: "2026-08-08T00:00:00.000Z",
    generatedAtText: "2026-08-08",
    sections: [
      {
        key: "main",
        reportKey: "programs-active",
        label: "البرامج",
        columns: [{ key: "name", label: "البرنامج" }],
        rows: [{ name: "ب" }],
        total: 1,
        truncated: false,
        filterLines: [],
        empty: false,
      },
    ],
    identity: {
      orgLines: [],
      schoolName: "مدرسة",
      principalName: "مدير",
      principalTitle: "المدير",
      academicYear: "",
      headerNote: "",
      footerNote: "",
      ministryLogoFileId: null,
      schoolLogoFileId: null,
    },
    style: { showIdentity: true },
    templateKey: "official",
    showEmpty: false,
    attachments: [],
    stats: { sectionCount: 1, totalRows: 1 },
    ...over,
  });

  it("تقرير سليم بلا موانع", () => {
    const warnings = validateDocument(doc({}));
    expect(warnings.filter((w) => w.blocking)).toHaveLength(0);
  });

  it("لا أقسام = مانع؛ قسم فارغ = تحذير لا مانع (§A)", () => {
    const none = validateDocument(doc({ sections: [], stats: { sectionCount: 0, totalRows: 0 } }));
    expect(none.some((w) => w.blocking)).toBe(true);

    const empty = validateDocument(
      doc({
        sections: [
          {
            key: "main",
            reportKey: "programs-active",
            label: "البرامج",
            columns: [],
            rows: [],
            total: 0,
            truncated: false,
            filterLines: [],
            empty: true,
          },
        ],
      }),
    );
    expect(empty.some((w) => w.key === "all-empty")).toBe(true);
    expect(empty.some((w) => w.blocking)).toBe(false);
  });

  it("الحسّاس والمقتطع والفترة الغائبة تحذيرات مُسمّاة", () => {
    const warnings = validateDocument(doc({ periodFrom: null, periodTo: null }), { sensitive: true });
    expect(warnings.some((w) => w.key === "sensitive")).toBe(true);
    expect(warnings.some((w) => w.key === "no-period")).toBe(true);
  });
});

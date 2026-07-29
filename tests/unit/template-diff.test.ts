import { describe, it, expect } from "vitest";
import { diffTemplateConfigs, groupDiff } from "@/lib/templates/diff";
import { DEFAULT_TEMPLATE_CONFIG, type TemplateConfig } from "@/lib/templates/schema";

/**
 * مقارنة نسختي قالب (v2.2 §E5) — تغطية كل الجوانب المطلوبة، وقراءة فقط.
 */

const base: TemplateConfig = DEFAULT_TEMPLATE_CONFIG;

/** يبحث عن سطر فرق بتسمية تحتوي النص */
const find = (rows: ReturnType<typeof diffTemplateConfigs>, label: string) =>
  rows.find((r) => r.label.includes(label));

describe("مقارنة النسخ — لا فروق", () => {
  it("النسختان المتطابقتان لا تُنتجان أي فرق", () => {
    expect(diffTemplateConfigs("program_report", base, base)).toHaveLength(0);
  });

  it("الحقل غير المذكور يساوي الافتراضي — لا يُعدّ فرقاً", () => {
    const rows = diffTemplateConfigs("program_report", {}, { style: { primaryColor: "#1f5244" } });
    expect(rows).toHaveLength(0);
  });
});

describe("مقارنة النسخ — الجوانب المطلوبة", () => {
  it("النصوص والعناوين", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, text: { titleAr: "عنوان جديد" } });
    const hit = find(rows, "العنوان");
    expect(hit).toBeDefined();
    expect(hit!.after).toBe("عنوان جديد");
    expect(hit!.group).toBe("text");
  });

  it("الألوان", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      style: { ...base.style, primaryColor: "#7a1f1f" },
    });
    expect(find(rows, "اللون الأساسي")?.after).toBe("#7a1f1f");
  });

  it("الخطوط", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, style: { ...base.style, fontFamily: "Amiri" } });
    expect(find(rows, "الخط")?.after).toBe("Amiri");
  });

  it("الترويسة والتذييل", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      text: { headerText: "ترويسة", footerText: "تذييل" },
    });
    expect(find(rows, "نص الترويسة")?.after).toBe("ترويسة");
    expect(find(rows, "نص التذييل")?.after).toBe("تذييل");
  });

  it("إعدادات الصفحة", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      style: { ...base.style, pageOrientation: "landscape", marginTop: 30 },
    });
    expect(find(rows, "اتجاه الصفحة")?.after).toBe("عرضي");
    expect(find(rows, "هامش أعلى")?.after).toBe("30");
  });

  it("تسميات التوقيع والاعتماد", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      signature: { ...base.signature, signatureLabel: "المدير العام", approvalLabel: "معتمد من" },
    });
    expect(find(rows, "تسمية التوقيع")?.after).toBe("المدير العام");
    expect(find(rows, "تسمية الاعتماد")?.after).toBe("معتمد من");
  });

  it("ظهور الأقسام", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, sections: [{ key: "notes", visible: false }] });
    const hit = find(rows, "الملاحظات — الظهور");
    expect(hit?.before).toBe("ظاهر");
    expect(hit?.after).toBe("مخفي");
  });

  it("ترتيب الأقسام", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      sections: [{ key: "notes", order: 0 }, { key: "header", order: 1 }],
    });
    expect(find(rows, "الملاحظات — الترتيب")).toBeDefined();
  });

  it("عنوان القسم", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, sections: [{ key: "intro", label: "تمهيد" }] });
    expect(find(rows, "المقدمة — العنوان")?.after).toBe("تمهيد");
  });

  it("تسمية العمود", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, columns: [{ key: "name", label: "اسم البرنامج" }] });
    const hit = find(rows, "البرنامج — التسمية");
    expect(hit?.before).toBe("البرنامج");
    expect(hit?.after).toBe("اسم البرنامج");
  });

  it("ظهور العمود", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, columns: [{ key: "domain", visible: false }] });
    expect(find(rows, "المجال — الظهور")?.after).toBe("مخفي");
  });

  it("ترتيب العمود", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      columns: [{ key: "domain", order: 0 }, { key: "name", order: 1 }],
    });
    expect(find(rows, "المجال — الترتيب")).toBeDefined();
  });

  it("عرض العمود", () => {
    const rows = diffTemplateConfigs("program_report", base, { ...base, columns: [{ key: "name", width: 40 }] });
    const hit = find(rows, "البرنامج — العرض");
    expect(hit?.before).toBe("تلقائي");
    expect(hit?.after).toBe("40٪");
  });

  it("النوع بلا أعمدة لا يُنتج فروق أعمدة", () => {
    const rows = diffTemplateConfigs("official_letter", base, { ...base, text: { titleAr: "خطاب" } });
    expect(rows.every((r) => r.group !== "columns")).toBe(true);
  });
});

describe("عرض المقارنة", () => {
  it("الفروق تُجمَّع بترتيب ثابت والمجموعات الفارغة تُحذف", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      text: { titleAr: "ع" },
      columns: [{ key: "name", visible: false }],
    });
    const groups = groupDiff(rows);
    expect(groups.map((g) => g.key)).toEqual(["text", "columns"]);
    expect(groups.every((g) => g.rows.length > 0)).toBe(true);
  });

  it("القيم المنطقية والفارغة تُعرض بالعربية لا كـtrue/null", () => {
    const rows = diffTemplateConfigs("program_report", base, {
      ...base,
      style: { ...base.style, showPageNumbers: true },
      text: { titleAr: "" },
    });
    expect(find(rows, "ترقيم الصفحات")?.after).toBe("نعم");
    const all = [...rows.map((r) => r.before), ...rows.map((r) => r.after)];
    expect(all.some((v) => v === "true" || v === "null" || v === "undefined")).toBe(false);
  });

  it("المقارنة دالة خالصة — لا تعدّل أياً من الإعدادين", () => {
    const a: TemplateConfig = { text: { titleAr: "أ" }, sections: [{ key: "intro", visible: false }] };
    const b: TemplateConfig = { text: { titleAr: "ب" } };
    const aBefore = JSON.stringify(a);
    const bBefore = JSON.stringify(b);
    diffTemplateConfigs("program_report", a, b);
    expect(JSON.stringify(a)).toBe(aBefore);
    expect(JSON.stringify(b)).toBe(bBefore);
  });
});

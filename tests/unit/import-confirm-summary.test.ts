import { describe, it, expect } from "vitest";
import { buildConfirmSummary } from "@/lib/imports/confirm-summary";

/** يجمع تسميات الملخص في نص واحد لتسهيل الفحص */
function labels(items: { label: string }[]): string {
  return items.map((i) => i.label).join(" | ");
}

describe("buildConfirmSummary — ملخص تأكيد الاستيراد حسب النوع", () => {
  it("دفعة الأشخاص: تعرض عدد المعلمين والموظفين والمستبعدين", () => {
    const rows = [
      { mapped: { category: "معلم" } },
      { mapped: { category: "معلم" } },
      { mapped: { category: "موظف" } },
    ];
    const s = buildConfirmSummary("people", rows, 1);
    expect(s.title).toContain("بيانات الموظفين");
    const byLabel = new Map(s.items.map((i) => [i.label, i.value]));
    expect(byLabel.get("عدد الصفوف الجاهزة")).toBe(3);
    expect(byLabel.get("عدد المعلمين")).toBe(2);
    expect(byLabel.get("عدد الموظفين")).toBe(1);
    expect(byLabel.get("عدد المستبعدين")).toBe(1);
  });

  it("دفعة الخطة التشغيلية: تعرض عدّادات الخطة العربية ولا تعرض أي تسمية موظفين", () => {
    const rows = [
      { mapped: { rowType: "program" } },
      { mapped: { rowType: "program" } },
      { mapped: { rowType: "program" } },
      { mapped: { rowType: "deliverable" } },
      { mapped: { rowType: "kpi" } },
      { mapped: { rowType: "risk" } },
      { mapped: { rowType: "budget" } },
    ];
    const s = buildConfirmSummary("operational_plan", rows, 0);
    expect(s.title).toContain("الخطة التشغيلية");
    const all = labels(s.items);
    // عدّادات الخطة موجودة
    expect(all).toContain("البرامج والمبادرات");
    expect(all).toContain("المخرجات المطلوبة");
    expect(all).toContain("مؤشرات الأداء");
    expect(all).toContain("سجل المخاطر");
    expect(all).toContain("بنود الميزانية");
    const byLabel = new Map(s.items.map((i) => [i.label, i.value]));
    expect(byLabel.get("البرامج والمبادرات")).toBe(3);
    // لا تسميات موظفين إطلاقاً على دفعة خطة
    expect(all).not.toContain("عدد المعلمين");
    expect(all).not.toContain("عدد الموظفين");
    expect(s.title).not.toContain("الموظفين");
  });

  it("دفعة الخطة: تظهر مجموعة المستبعدة فقط عند وجود مستبعدين", () => {
    const rows = [{ mapped: { rowType: "program" } }];
    expect(labels(buildConfirmSummary("operational_plan", rows, 0).items)).not.toContain("المستبعدة");
    expect(labels(buildConfirmSummary("operational_plan", rows, 2).items)).toContain("الصفوف المستبعدة");
  });
});

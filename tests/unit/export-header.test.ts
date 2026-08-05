import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { filterHeaderLines, describeFilters } from "@/lib/reports/filters";

/**
 * v2.5.0 §3.4 / §21 — التقرير المولَّد يذكر المرشّحات التي أُنتج بها.
 *
 * يُفحص هنا على المصدر لا على ملف PDF: استخراج النص العربي من PDF يعيد ترتيب الحروف
 * (يظهر «الربامج» بدل «البرامج»)، فمطابقة عبارة كاملة فيه تفشل ولو كانت الترويسة سليمة.
 * تدقيق التصدير يفحص وجود **قيمة** المرشّح في الملف؛ وهذه الاختبارات تفحص أن الترويسة
 * تُبنى أصلاً ومن المصدر الموحّد نفسه الذي يغذّي شرائح الشاشة.
 */
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("§3.4 — ترويسة التقرير المولَّد", () => {
  it("مسار التصدير يبني سطر المرشّحات من المصدر الموحّد", () => {
    const route = read("src/app/api/reports/export/route.ts");
    expect(route).toContain("filterHeaderLines(filters, labelMaps)");
    expect(route).toContain("المرشّحات الفعّالة");
    // وتُمرَّر إلى الصيغ الثلاث التي تحمل ترويسة
    expect(route).toContain("...activeFilters");
  });

  it("سطور الترويسة هي نفسها شرائح الشاشة — لا صياغتان", () => {
    const filters = { domains: ["المجال الأول"], statuses: ["معتمد"], flags: ["delayed" as const] };
    const chips = describeFilters(filters);
    const lines = filterHeaderLines(filters);
    expect(lines).toEqual(chips.map((c) => [c.label, c.value]));
  });

  it("المرشّح المتعدّد يُذكر بكل قيمه في الترويسة", () => {
    const lines = filterHeaderLines({ domains: ["المجال الأول", "المجال الثاني"] });
    expect(lines).toEqual([["المجال", "المجال الأول، المجال الثاني"]]);
  });

  it("بلا مرشّحات لا يُطبع سطر مرشّحات فارغ", () => {
    expect(filterHeaderLines({})).toEqual([]);
  });
});

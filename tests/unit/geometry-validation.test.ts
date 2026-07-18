import { describe, it, expect } from "vitest";
import { validateGeometry } from "@/lib/building/geometry";

const base = (rooms: { key: string; name: string; type: string; x: number; y: number; w: number; h: number }[]) => ({ unit: "m" as const, rooms });

describe("validateGeometry — أخطاء صلبة + تنبيهات (تداخل/حدود)", () => {
  it("يرفض الأبعاد غير الموجبة (خطأ صلب يمنع الحفظ)", () => {
    const r = validateGeometry(base([{ key: "a", name: "غرفة", type: "فصل", x: 0, y: 0, w: -3, h: 4 }]));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("غير موجبة");
  });

  it("ينبّه على تداخل الغرف دون منع الحفظ", () => {
    const r = validateGeometry(
      base([
        { key: "a", name: "غرفة أ", type: "فصل", x: 0, y: 0, w: 5, h: 5 },
        { key: "b", name: "غرفة ب", type: "فصل", x: 3, y: 3, w: 5, h: 5 },
      ]),
    );
    expect(r.ok).toBe(true); // لا يمنع
    expect(r.warnings.some((w) => w.includes("تداخل"))).toBe(true);
  });

  it("ينبّه على خروج الغرفة عن حدود المخطط (إحداثيات سالبة)", () => {
    const r = validateGeometry(base([{ key: "a", name: "غرفة", type: "فصل", x: -2, y: 1, w: 5, h: 5 }]));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("خارج حدود المخطط"))).toBe(true);
  });

  it("لا تنبيهات لغرف منفصلة داخل الحدود", () => {
    const r = validateGeometry(
      base([
        { key: "a", name: "غرفة أ", type: "فصل", x: 0, y: 0, w: 5, h: 5 },
        { key: "b", name: "غرفة ب", type: "فصل", x: 6, y: 0, w: 5, h: 5 },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  isoWeekKey,
  isValidWeekKey,
  isoWeekMonday,
  previousWeekKey,
  recentWeekKeys,
  weeklyGroup,
  NO_WEEKLY_UPDATE_LABEL,
} from "@/lib/plan/followup";

describe("v2.4 §7: أدوات الأسبوع للمتابعة الأسبوعية", () => {
  it("يتحقق من صحة مفتاح الأسبوع", () => {
    expect(isValidWeekKey("2026-W31")).toBe(true);
    expect(isValidWeekKey("2026-W01")).toBe(true);
    expect(isValidWeekKey("2026-W54")).toBe(false);
    expect(isValidWeekKey("2026-W00")).toBe(false);
    expect(isValidWeekKey("2026-31")).toBe(false);
    expect(isValidWeekKey("")).toBe(false);
  });

  it("اثنين الأسبوع: 2026-W01 يبدأ 2025-12-29 بحسب ISO", () => {
    const monday = isoWeekMonday("2026-W01");
    expect(monday?.toISOString().slice(0, 10)).toBe("2025-12-29");
  });

  it("الأسبوع السابق يتعامل مع حدود السنة", () => {
    expect(previousWeekKey("2026-W02")).toBe("2026-W01");
    expect(previousWeekKey("2026-W01")).toBe("2025-W52");
    expect(previousWeekKey("غير صالح")).toBeNull();
  });

  it("المفتاح الحالي متسق مع الأسبوع السابق (تقريب ذهاباً وإياباً)", () => {
    const now = new Date();
    const current = isoWeekKey(now);
    const prev = previousWeekKey(current);
    expect(prev).not.toBeNull();
    expect(prev! < current || prev!.slice(0, 4) < current.slice(0, 4)).toBe(true);
  });

  it("آخر n أسابيع: القائمة تنازلية وبلا تكرار", () => {
    const keys = recentWeekKeys(5, new Date(2026, 0, 15));
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(5);
    expect(keys[0]).toBe(isoWeekKey(new Date(2026, 0, 15)));
    for (let i = 1; i < keys.length; i++) expect(keys[i] < keys[i - 1] || keys[i].slice(0, 4) < keys[i - 1].slice(0, 4)).toBe(true);
  });
});

describe("v2.4 §7: التجميع الصادق للحالة الأسبوعية — لا مساواة بين المحاور", () => {
  const base = { closedAt: null, completedAt: null, weekStatus: null, currentStatus: "في المسار" };

  it("الإقفال يتقدم على كل شيء", () => {
    expect(weeklyGroup({ ...base, closedAt: new Date(), completedAt: new Date() })).toBe("مغلق");
  });

  it("الاكتمال الموثق دون إقفال = بانتظار الإقفال (لا يُعرض مغلقاً)", () => {
    expect(weeklyGroup({ ...base, completedAt: new Date() })).toBe("مكتمل — بانتظار الإقفال");
  });

  it("«مكتمل» في متابعة الأسبوع دون توثيق يُجمع مع المكتمل لا مع الجاري", () => {
    expect(weeklyGroup({ ...base, weekStatus: "مكتمل" })).toBe("مكتمل — بانتظار الإقفال");
  });

  it("حالات الأسبوع المسجلة تُحترم كما سُجلت", () => {
    expect(weeklyGroup({ ...base, weekStatus: "متأخر" })).toBe("متأخر");
    expect(weeklyGroup({ ...base, weekStatus: "متوقف مؤقتاً" })).toBe("متوقف مؤقتاً");
    expect(weeklyGroup({ ...base, weekStatus: "في المسار" })).toBe("في المسار");
  });

  it("غياب التحديث لا يعني الاكتمال أبداً", () => {
    expect(weeklyGroup({ ...base, weekStatus: null })).toBe("بلا تحديث هذا الأسبوع");
    expect(weeklyGroup({ ...base, weekStatus: null, currentStatus: "مكتمل" })).toBe("بلا تحديث هذا الأسبوع");
    expect(weeklyGroup({ ...base, weekStatus: null, currentStatus: "لم يبدأ" })).toBe("لم يبدأ");
  });

  it("وسم غياب التحديث ثابت النص كما في الموجز", () => {
    expect(NO_WEEKLY_UPDATE_LABEL).toBe("لم يتم التحديث هذا الأسبوع");
  });
});

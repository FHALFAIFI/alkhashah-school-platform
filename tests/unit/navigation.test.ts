import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { parentRouteFor, normalizePath, APP_ROOT } from "@/lib/navigation";

/**
 * Scope v2.2 §C — the global navigation standard.
 *
 * These tests pin the rules the principal asked for: a back action on every meaningful
 * subpage, returning to the *logical parent* rather than always to the dashboard, with a
 * safe fallback that works on direct URL entry, and no navigation loops.
 */

describe("parentRouteFor — logical parent, not the dashboard", () => {
  it("يعيد الصفحة الأب المنطقية لا الرئيسية", () => {
    expect(parentRouteFor("/plan/followup")).toBe("/plan");
    expect(parentRouteFor("/committees/templates")).toBe("/committees");
    expect(parentRouteFor("/building/maintenance")).toBe("/building");
    expect(parentRouteFor("/reports/executive")).toBe("/reports");
    expect(parentRouteFor("/admin/settings/ai")).toBe("/admin/settings");
  });

  it("يحافظ على المعرّفات الديناميكية في مسار الأب", () => {
    expect(parentRouteFor("/plan/abc-123/report")).toBe("/plan/abc-123");
    expect(parentRouteFor("/performance/cycles/c-9/sessions/s-4")).toBe("/performance/cycles/c-9");
    expect(parentRouteFor("/committees/k-1/meetings/m-2")).toBe("/committees/k-1");
    expect(parentRouteFor("/committees/k-1/report")).toBe("/committees/k-1");
    expect(parentRouteFor("/building/inspections/templates/t-7/edit")).toBe("/building/inspections/templates/t-7");
  });

  it("لا يعيد مقاطع ليست صفحات (meetings / sessions / cycles)", () => {
    // حذف آخر مقطع وحده كان سيعطي «/committees/k-1/meetings» وهي ليست صفحة
    expect(parentRouteFor("/committees/k-1/meetings/m-2")).not.toContain("/meetings");
    expect(parentRouteFor("/performance/cycles/c-9/sessions/s-4")).not.toContain("/sessions");
  });

  it("يخفي زر العودة في جذر التطبيق وصفحة الدخول فقط", () => {
    expect(parentRouteFor("/dashboard")).toBeNull();
    expect(parentRouteFor("/login")).toBeNull();
    expect(parentRouteFor("/")).toBeNull();
  });

  it("يعيد جذر التطبيق للأقسام الرئيسة", () => {
    for (const root of ["/plan", "/budget", "/committees", "/evidence", "/people", "/reports", "/documents", "/building"]) {
      expect(parentRouteFor(root)).toBe(APP_ROOT);
    }
  });

  it("يسقط بأمان إلى حذف آخر مقطع للمسارات غير المعروفة", () => {
    expect(parentRouteFor("/plan/unknown-subpage")).toBe("/plan");
    expect(parentRouteFor("/totally/new/route")).toBe("/totally/new");
  });

  it("لا ينتج حلقة تنقّل: الأب لا يساوي الصفحة نفسها أبداً", () => {
    const paths = [
      "/plan", "/plan/followup", "/plan/x/report", "/budget", "/committees/x/meetings/y",
      "/building/inspections/templates/z/edit", "/admin/settings/ai", "/reports/executive",
      "/performance/cycles/a/sessions/b", "/evidence/e1", "/people/new", "/imports/i1",
    ];
    for (const p of paths) {
      const parent = parentRouteFor(p);
      expect(parent).not.toBe(normalizePath(p));
    }
  });

  it("يتجاهل الشرطة المائلة الزائدة", () => {
    expect(parentRouteFor("/plan/followup/")).toBe("/plan");
    expect(parentRouteFor("//plan//followup//")).toBe("/plan");
  });

  it("كل وجهة احتياطية مسار مطلق يبدأ بشرطة", () => {
    const paths = ["/plan/followup", "/committees/x/report", "/building/rooms/r1", "/assistant/drafts"];
    for (const p of paths) {
      expect(parentRouteFor(p)).toMatch(/^\//);
    }
  });
});

describe("تغطية المسارات — كل صفحة فرعية لها زر عودة", () => {
  /** كل صفحات التطبيق الفعلية مشتقّة من نظام الملفات — لا قائمة مكتوبة يدوياً تتقادم */
  function appRoutes(): string[] {
    const out = execSync("find src/app -name 'page.tsx'", { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    return out.map((f) =>
      f
        .replace(/^src\/app/, "")
        .replace(/\/\((?:app|auth)\)/g, "")
        .replace(/\/page\.tsx$/, "")
        .replace(/^$/, "/"),
    );
  }

  it("يغطي كل صفحة في التطبيق: إمّا جذر بلا عودة أو أب صالح", () => {
    const routes = appRoutes();
    // حارس: لو تغيّرت بنية المسارات جذرياً يسقط الاختبار بدل أن يمر فارغاً
    expect(routes.length).toBeGreaterThan(50);

    const rootsWithoutBack = ["/", "/dashboard", "/login"];
    for (const route of routes) {
      // المسارات الديناميكية تُختبر بقيمة فعلية مكان [id]
      const concrete = route.replace(/\[[^\]]+\]/g, "sample-id");
      const parent = parentRouteFor(concrete);
      if (rootsWithoutBack.includes(route)) {
        expect(parent, `${route} يجب ألّا يعرض زر عودة`).toBeNull();
      } else {
        expect(parent, `${route} يجب أن يكون له أب صالح`).toBeTruthy();
        expect(parent).not.toBe(normalizePath(concrete));
      }
    }
  });

  it("كل أب مذكور في الخريطة هو صفحة موجودة فعلاً في التطبيق", () => {
    const routes = new Set(appRoutes().map((r) => r.replace(/\[[^\]]+\]/g, "[x]")));
    for (const route of appRoutes()) {
      if (["/", "/dashboard", "/login"].includes(route)) continue;
      const concrete = route.replace(/\[[^\]]+\]/g, "sample-id");
      const parent = parentRouteFor(concrete);
      if (!parent) continue;
      // نعيد المعرّفات إلى شكلها النمطي لمقارنتها بقائمة الصفحات الفعلية
      const parentPattern = parent.replace(/sample-id/g, "[x]");
      expect(routes.has(parentPattern), `أب ${route} (${parentPattern}) ليس صفحة موجودة`).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPORTS, REPORT_CATEGORIES } from "@/lib/reports/catalog";
import { MAX_MONEY_AMOUNT, toMinor, moneySubtract } from "@/lib/finance/calc";
import {
  ALLOCATION_NONE_VALUE,
  ALLOCATION_NONE_HINT,
  REMAINING_UNAVAILABLE,
  SET_ALLOCATION_CTA,
} from "@/lib/finance/allocation";
import { NEEDS_REVIEW_LABEL } from "@/lib/plan/consistency";
import { TASK_STATUS_UNSET_LABEL, COMMITTEE_NO_TASKS_LABEL } from "@/lib/committees/task-status";
import { NO_WEEKLY_UPDATE_LABEL } from "@/lib/plan/followup";
import { releaseLabel } from "@/lib/release";
import { OVERALL_REPORT_LABEL, individualReportLabel } from "@/lib/performance/report-labels";

/**
 * v2.4.1 §1 — the discoverability contract.
 *
 * The v2.4.0 post-deployment complaint was not "the feature is broken" but "I cannot find
 * it". These assertions pin the exact Arabic wording the principal asked for, at the exact
 * place they asked for it, so a later refactor cannot quietly rename an entry point back
 * into obscurity. Source-scanning (rather than rendering) keeps them cheap and stable —
 * the browser-level proof that the text is actually *visible* lives in `zz-v241.spec.ts`.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("§1 — مداخل ظاهرة بأسمائها المطلوبة", () => {
  it("القائمة الجانبية تحمل «مراجعة حالات برامج الخطة» مع وصفها", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain('href: "/plan/consistency"');
    expect(shell).toContain('label: "مراجعة حالات برامج الخطة"');
    expect(shell).toContain('desc: "مراجعة البرامج ذات الحالات أو نسب الإنجاز غير المتوافقة"');
    // الوصف يُصيَّر فعلياً لا يُعرَّف فقط
    expect(shell).toContain("{item.desc}");
  });

  it("«طباعة بطاقة البرنامج» ظاهر من صفحة البرنامج ومن قائمة البرامج معاً", () => {
    expect(read("src/app/(app)/plan/[id]/page.tsx")).toContain(">طباعة بطاقة البرنامج<");
    expect(read("src/app/(app)/plan/page.tsx")).toContain(">طباعة بطاقة البرنامج<");
  });

  it("الصفحة الرئيسة تعرض حالة فارغة صريحة لطابور الاعتماد بدل إخفاء القسم", () => {
    const dashboard = read("src/app/(app)/dashboard/page.tsx");
    expect(dashboard).toContain("بانتظار اعتماد المدير");
    expect(dashboard).toContain("لا توجد برامج بانتظار الاعتماد حاليا");
  });

  it("تقريرا الأداء التفصيليان يحملان التسميتين المطلوبتين حرفياً", () => {
    // v2.4.1 §1.4: صياغة المدير — «تقرير تفصيلي للمعلم» و«تقرير تفصيلي وإحصائي للجميع».
    // التسمية الفردية تتبع نوع المنسوب فلا يُسمّى موظف إداري «معلماً» (D-019).
    expect(individualReportLabel("معلم")).toBe("تقرير تفصيلي للمعلم");
    expect(individualReportLabel("موظف إداري")).toBe("تقرير تفصيلي للموظف");
    expect(OVERALL_REPORT_LABEL).toBe("تقرير تفصيلي وإحصائي للجميع");

    expect(read("src/app/(app)/performance/employees/[personId]/page.tsx")).toContain("individualReportLabel(employeeTypeOf(person))");
    expect(read("src/app/(app)/performance/analytics/page.tsx")).toContain("{OVERALL_REPORT_LABEL}");
    // ومعلنان من جذر قسم الأداء لا داخل صفحة فرعية فقط
    const index = read("src/app/(app)/performance/page.tsx");
    expect(index).toContain("تقارير الأداء التفصيلية");
    expect(index).toContain("{OVERALL_REPORT_LABEL}");
    expect(index).toContain('individualReportLabel("معلم")');
  });

  it("قائمة نماذج الأداء تعلن مكان «حذف النموذج» و«أرشفة النموذج»", () => {
    const models = read("src/app/(app)/performance/models/page.tsx");
    expect(models).toContain("«حذف النموذج»");
    expect(models).toContain("«أرشفة النموذج»");
  });

  it("جدول بنود الصرف لا يعرض «—» مجرّداً لبند بلا مخصص", () => {
    const budget = read("src/app/(app)/budget/page.tsx");
    expect(budget).toContain("ALLOCATION_NONE_VALUE");
    expect(budget).toContain("REMAINING_UNAVAILABLE");
    expect(budget).toContain("SET_ALLOCATION_CTA");
    // الصف نفسه يحمل الإجراء المصحّح لا البطاقة وحدها
    expect(budget).toMatch(/liveLines\.map[\s\S]*SetAllocationForm/);
  });
});

describe("§1 — تمييز تقريري اللجان", () => {
  it("«سجل اللجان العام» و«سجل المجالس واللجان التفصيلي» اسمان متمايزان في نفس الفئة", () => {
    const committees = REPORTS.filter((r) => r.category === "committees").map((r) => r.label);
    expect(committees).toContain("سجل اللجان العام");
    expect(committees).toContain("سجل المجالس واللجان التفصيلي");
    expect(new Set(committees).size).toBe(committees.length);
  });

  it("وصف التقرير التفصيلي يوصي به لمن يحتاج الأعضاء والأدوار والمهام وحالاتها", () => {
    const detailed = REPORTS.find((r) => r.key === "committee-members")!;
    expect(detailed.description).toContain("الموصى به");
    const general = REPORTS.find((r) => r.key === "committee-register")!;
    expect(general.description).toContain("سجل المجالس واللجان التفصيلي");
  });

  it("تقريرا البرامج بالاسم موجودان ويعرضان عمود اسم البرنامج", () => {
    for (const key of ["programs-by-owner", "programs-by-domain"]) {
      const report = REPORTS.find((r) => r.key === key)!;
      expect(report.columns.some((c) => c.label === "البرنامج")).toBe(true);
    }
  });

  it("كل فئة تقارير لها تسمية فريدة", () => {
    const labels = REPORT_CATEGORIES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("§1 — النصوص الموحّدة التي يقرأها المدير", () => {
  it("نصوص حالة المخصص ثابتة", () => {
    expect(ALLOCATION_NONE_VALUE).toBe("غير محدد");
    expect(ALLOCATION_NONE_HINT).toBe("لم يتم تحديد مخصص لهذا البند");
    expect(REMAINING_UNAVAILABLE).toBe("لا يمكن احتساب المتبقي قبل تحديد المخصص");
    expect(SET_ALLOCATION_CTA).toBe("تحديد المخصص");
  });

  it("نصوص المراجعة والمهام والمتابعة ثابتة", () => {
    expect(NEEDS_REVIEW_LABEL).toBe("حالة البرنامج تحتاج مراجعة");
    expect(TASK_STATUS_UNSET_LABEL).toBe("لم يتم تحديد الحالة");
    expect(COMMITTEE_NO_TASKS_LABEL).toBe("لم تتم إضافة مهام لهذه اللجنة");
    expect(NO_WEEKLY_UPDATE_LABEL).toBe("لم يتم التحديث هذا الأسبوع");
  });

  it("علامة الإصدار تقول «الإصدار 2.5.0»", () => {
    expect(releaseLabel()).toBe("الإصدار 2.5.0");
  });
});

describe("§5 (D-048) — تفاصيل الأداء الفردي لا تُتاح من مركز التقارير بصلاحية عامة", () => {
  /**
   * D-013 يمنع «مسؤول النظام» من تفاصيل الأداء الفردي، وD-044 أغلق وثائق الأداء المُصدَرة.
   * أي تقرير يعرض **نتيجة** موظف مسمّى يجب أن يُعلن الصلاحية نفسها، وإلا فُتح من مركز
   * التقارير ما أُغلق في الصفحات — وهو باب جانبي لا يظهر في مراجعة الصفحات وحدها.
   */
  const INDIVIDUAL_RESULT_COLUMNS = ["sessionResult", "resultPercent", "score", "finalScore", "rating"];

  it("كل تقرير يعرض نتيجة أداء فردية يتطلب performance.individual.read", () => {
    const leaking = REPORTS.filter(
      (r) =>
        r.columns.some((c) => INDIVIDUAL_RESULT_COLUMNS.includes(c.key)) &&
        r.columns.some((c) => c.key === "personName") &&
        r.permission !== "performance.individual.read",
    );
    expect(leaking.map((r) => r.key)).toEqual([]);
  });

  it("تقرير «التقييمات» تحديداً مقيَّد بالصلاحية الفردية", () => {
    const evaluations = REPORTS.find((r) => r.key === "perf-evaluations")!;
    expect(evaluations.permission).toBe("performance.individual.read");
  });

  it("«مسؤول النظام» لا يملك الصلاحية الفردية أصلاً — الحرمان فعلي لا نظري", () => {
    const seed = read("src/db/seed-data/permissions.ts");
    expect(seed).toContain('k !== "performance.individual.read"');
  });
});

describe("§5 — سقف المبالغ يحافظ على دقة الهللة", () => {
  it("ضرب السقف في 100 يبقى عدداً صحيحاً دقيقاً في Number", () => {
    expect(Number.isSafeInteger(toMinor(MAX_MONEY_AMOUNT))).toBe(true);
    expect(toMinor(MAX_MONEY_AMOUNT)).toBe(MAX_MONEY_AMOUNT * 100);
  });

  it("الطرح عند الحدود وفي الحالة الكلاسيكية دقيق", () => {
    expect(moneySubtract(0.3, 0.1)).toBe(0.2);
    expect(moneySubtract(100.1, 0.2)).toBe(99.9);
    expect(moneySubtract(MAX_MONEY_AMOUNT, 0.01)).toBe(MAX_MONEY_AMOUNT - 0.01);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * v2.4.1 (النطاق الموحّد النهائي) §Phase B — المداخل الجديدة ظاهرة بأسمائها.
 *
 * كل مسمّى طلبه المدير حرفياً يجب أن يوجد في **صفحة يصل إليها بالتنقّل العادي** — لا في
 * ثابت غير مستعمل ولا في مسار مباشر بالرابط. الفحص على المصدر رخيص وثابت؛ إثبات الظهور
 * الفعلي في المتصفح في مواصفة Playwright.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("§Phase B — مداخل النطاق الموحّد النهائي", () => {
  it("«إجراء فحص» داخل منطقة الصيانة لا في الفحص والجاهزية وحدها", () => {
    const maintenance = read("src/app/(app)/building/maintenance/page.tsx");
    expect(maintenance).toContain("RUN_INSPECTION_CTA");
    expect(maintenance).toContain('href="/building/maintenance/inspect"');
    // والصفحة نفسها موجودة تحت الصيانة
    expect(() => read("src/app/(app)/building/maintenance/inspect/page.tsx")).not.toThrow();
    // وأبوها في معيار التنقّل هو صفحة الصيانة
    expect(read("src/lib/navigation.ts")).toContain('"/building/maintenance/inspect": "/building/maintenance"');
  });

  it("خيارات ما بعد الفحص الأربعة معروضة في شاشة الفحص", () => {
    const ui = read("src/app/(app)/building/maintenance/inspect/inspect-ui.tsx");
    for (const cta of ["CREATE_SELECTED_CTA", "CREATE_ALL_SEPARATE_CTA", "REVIEW_BEFORE_CREATE_CTA", "SKIP_FOR_NOW_CTA"]) {
      expect(ui).toContain(cta);
    }
  });

  it("«عرض بلاغ الصيانة» و«طباعة تقرير الصيانة» و«تنزيل PDF» في مسار الصيانة", () => {
    expect(read("src/app/(app)/building/maintenance/page.tsx")).toContain("VIEW_ISSUE_CTA");
    const detail = read("src/app/(app)/building/maintenance/[id]/page.tsx");
    expect(detail).toContain("طباعة تقرير الصيانة");
    expect(detail).toContain("تنزيل PDF");
    expect(detail).toContain("اعتماد البلاغ وإصدار التقرير");
  });

  it("«حذف الموظف نهائياً» في صفحة المنسوب و«حذف دورة الأداء» في صفحة الدورة", () => {
    const person = read("src/app/(app)/people/[id]/page.tsx");
    expect(person).toContain("حذف الموظف نهائياً");
    expect(person).toContain("PermanentDeletePanel");
    const cycle = read("src/app/(app)/performance/cycles/[id]/page.tsx");
    expect(cycle).toContain("حذف دورة الأداء");
    expect(cycle).toContain("PermanentDeletePanel");
  });

  it("«تعديل البرنامج» و«سجل التغييرات» في صفحة البرنامج", () => {
    const program = read("src/app/(app)/plan/[id]/page.tsx");
    expect(program).toContain("EditProgramForm");
    expect(program).toContain("EDIT_HISTORY_LABEL");
    expect(program).toContain("EDITED_AFTER_APPROVAL_MARKER");
    expect(read("src/app/(app)/plan/[id]/program-ui.tsx")).toContain("تعديل البرنامج");
  });

  it("«سجل المجالس واللجان التفصيلي» و«بطاقة مجلس أو لجنة» بمسمّييهما", () => {
    expect(read("src/app/(app)/committees/page.tsx")).toContain("COMMITTEE_REGISTRY_LABEL");
    expect(read("src/app/(app)/committees/[id]/page.tsx")).toContain("COMMITTEE_CARD_LABEL");
    expect(read("src/app/(app)/committees/[id]/report/page.tsx")).toContain("COMMITTEE_CARD_LABEL");
  });

  it("الملخّص المالي الأعلى يعرض المخصص والمتبقي ونسبة الإنفاق", () => {
    const budget = read("src/app/(app)/budget/page.tsx");
    expect(budget).toContain("إجمالي المخصصات");
    expect(budget).toContain("إجمالي المتبقي");
    expect(budget).toContain("نسبة الإنفاق من المخصص");
    // وبلا مخصص لا يُعرض صفر بل تفسير
    expect(budget).toContain("TOTAL_REMAINING_UNAVAILABLE");
  });

  it("شاشة إدخال المصروف تشرح تعذّر الاحتساب وتوجّه إلى الإجراء المصحّح", () => {
    const ui = read("src/app/(app)/budget/budget-ui.tsx");
    expect(ui).toContain("ALLOCATION_NONE_HINT");
    expect(ui).toContain("REMAINING_UNAVAILABLE");
    expect(ui).toContain("SET_ALLOCATION_CTA");
    expect(ui).toContain("الرصيد قبل العملية");
    expect(ui).toContain("الرصيد بعد العملية");
  });
});

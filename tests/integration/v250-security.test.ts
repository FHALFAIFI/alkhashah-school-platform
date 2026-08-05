import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseReportFilters, serializeReportFilters, filtersToStored, storedToParams } from "@/lib/reports/filters";
import { REPORTS, isSortableColumn, isGroupableColumn, reportByKey } from "@/lib/reports/catalog";
import { sanitizeCell, toCsv } from "@/lib/reports/export-safety";

/**
 * v2.5.0 §22 — المراجعة الأمنية للسطح الجديد، مكتوبةً كاختبارات لا كنصّ.
 *
 * السبب: مراجعة أمنية في وثيقة تتقادم بصمت مع أول إضافة عمود؛ والاختبار يفشل. كل بند من
 * بنود §22 التي تنطبق على ما بُني في هذا الإصدار يُترجَم هنا إلى تأكيد يمكن كسره.
 *
 * السطح الجديد: إطار المرشّحات، منشئ التقارير، القوالب المحفوظة، مسار التصدير.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

describe("§22 — الترتيب والأعمدة والتجميع بقائمة بيضاء", () => {
  it("عمود ترتيب غير معلَن يُسقَط ولا يصل إلى استعلام", () => {
    const f = parseReportFilters(new URLSearchParams("sort=password_hash&dir=desc"), {
      allowedSort: (k) => isSortableColumn("programs-by-domain", k),
    });
    expect(f.sort).toBeUndefined();
  });

  it("محاولة حقن SQL في مفتاح الترتيب تُسقَط", () => {
    for (const attack of ["name; drop table users", "name'--", "(select 1)", "name) union select"]) {
      const f = parseReportFilters(new URLSearchParams(`sort=${encodeURIComponent(attack)}`), {
        allowedSort: (k) => isSortableColumn("programs-by-domain", k),
      });
      expect(f.sort).toBeUndefined();
    }
  });

  it("اسم عمود غير معلَن لا يمر إلى الأعمدة المختارة", () => {
    const def = reportByKey("programs-by-domain")!;
    const f = parseReportFilters(new URLSearchParams("col=domain&col=users.password_hash&col=name"), {
      allowedColumns: def.columns.map((c) => c.key),
    });
    expect(f.columns).toEqual(["domain", "name"]);
  });

  it("مفتاح التجميع مقيَّد بما أعلنه التقرير", () => {
    expect(isGroupableColumn("programs-by-domain", "domain")).toBe(true);
    expect(isGroupableColumn("programs-by-domain", "password_hash")).toBe(false);
    // تقرير بلا تجميع معلَن لا يقبل أي مفتاح
    expect(isGroupableColumn("employee-register", "fullName")).toBe(false);
  });

  it("مفاتيح مرشّحات غير معروفة تُتجاهل بصمت", () => {
    const f = parseReportFilters(new URLSearchParams("__proto__=x&constructor=y&evil=1&flag=notAFlag"));
    expect(f.flags).toBeUndefined();
    expect(Object.keys(f)).not.toContain("evil");
  });
});

describe("§22 — حدود المدخلات", () => {
  it("نص البحث محدود الطول فلا يُبنى نمط ILIKE عملاق", () => {
    const f = parseReportFilters(new URLSearchParams(`search=${"ا".repeat(5000)}`));
    expect(f.search!.length).toBeLessThanOrEqual(120);
  });

  it("المرشّح المتعدّد محدود العدد فلا يُلفَّق عنوان بآلاف المعرّفات", () => {
    const sp = new URLSearchParams();
    for (let i = 0; i < 1000; i++) sp.append("personId", `p${i}`);
    const f = parseReportFilters(sp);
    expect(f.personIds!.length).toBeLessThanOrEqual(200);
  });

  it("المدى العددي محصور ولا يقبل قيمة غير رقمية", () => {
    const f = parseReportFilters(new URLSearchParams("minScore=-50&maxScore=999&lowThreshold=abc&page=99999999"));
    expect(f.minScore).toBe(0);
    expect(f.maxScore).toBe(100);
    expect(f.lowThreshold).toBeUndefined();
    expect(f.page).toBeLessThanOrEqual(10_000);
  });

  it("التاريخ يقبل ISO فقط", () => {
    expect(parseReportFilters(new URLSearchParams("dateFrom=2026-08-05")).dateFrom).toBe("2026-08-05");
    for (const bad of ["05/08/2026", "2026-13-45", "now()", "'; drop"]) {
      expect(parseReportFilters(new URLSearchParams(`dateFrom=${encodeURIComponent(bad)}`)).dateFrom).toBeUndefined();
    }
  });
});

describe("§22 — الذهاب والعودة لا يفقد قيمة ولا يهرّب واحدة", () => {
  it("التخزين والاسترجاع يحفظان المرشّحات المتعدّدة كاملة", () => {
    const filters = { statuses: ["معتمد", "مسودة"], domains: ["أ", "ب", "ج"], search: "بحث" };
    const back = parseReportFilters(storedToParams(filtersToStored(filters)));
    expect(back.statuses).toEqual(filters.statuses);
    expect(back.domains).toEqual(filters.domains);
    expect(back.search).toBe("بحث");
  });

  it("قيمة ملفَّقة داخل صف قالب مخزَّن تُطهَّر عند القراءة", () => {
    const tampered = { sort: ["password_hash"], col: ["users.password_hash"], flag: ["notAFlag"] };
    const def = reportByKey("programs-by-domain")!;
    const back = parseReportFilters(storedToParams(tampered), {
      allowedSort: (k) => isSortableColumn("programs-by-domain", k),
      allowedColumns: def.columns.map((c) => c.key),
    });
    expect(back.sort).toBeUndefined();
    expect(back.columns).toBeUndefined();
    expect(back.flags).toBeUndefined();
  });

  it("التسلسل إلى العنوان لا يفقد قيمة", () => {
    const sp = serializeReportFilters({ committeeIds: ["a", "b"], flags: ["hasTasks"] });
    expect(sp.getAll("committeeId")).toEqual(["a", "b"]);
    expect(sp.getAll("flag")).toEqual(["hasTasks"]);
  });
});

describe("§22 — حقن صيغ CSV", () => {
  it("الخلية التي تبدأ بمحرف صيغة تُعطَّل", () => {
    for (const evil of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=cmd", "\r=cmd"]) {
      expect(sanitizeCell(evil).startsWith("'")).toBe(true);
    }
  });

  it("اسم قالب خبيث يُعطَّل عند التصدير", () => {
    const csv = toCsv(["القالب"], [["=HYPERLINK(\"http://evil\",\"click\")"]]);
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe("§22 — التفويض على حدود الخادم", () => {
  it("كل تقرير يعلن صلاحية", () => {
    expect(REPORTS.filter((r) => !r.permission)).toEqual([]);
  });

  it("كل تقرير يعرض اسم موظف مع نتيجته يعلن الصلاحية الفردية (D-013/D-048)", () => {
    const RESULT_COLUMNS = ["resultPercent", "score", "finalScore", "sessionResult", "rating"];
    const leaking = REPORTS.filter(
      (r) =>
        r.columns.some((c) => RESULT_COLUMNS.includes(c.key)) &&
        r.columns.some((c) => c.key === "personName") &&
        r.permission !== "performance.individual.read",
    );
    expect(leaking.map((r) => r.key)).toEqual([]);
  });

  it("كل تقرير حسّاس معلَّم كذلك فتظهر تحذيراته قبل التصدير (§15)", () => {
    const unmarked = REPORTS.filter(
      (r) => r.permission === "performance.individual.read" && r.sensitive !== true,
    );
    expect(unmarked.map((r) => r.key)).toEqual([]);
  });

  it("صفحات المنشئ والقوالب والتقرير الفردي تفرض صلاحياتها على الخادم", () => {
    expect(read("src/app/(app)/reports/builder/page.tsx")).toContain('requirePermission("reports.read", "reports.builder")');
    expect(read("src/app/(app)/reports/templates/page.tsx")).toContain('requirePermission("reports.read", "reports.builder")');
    expect(read("src/app/(app)/reports/individual/page.tsx")).toContain(
      'requirePermission("performance.read", "performance.individual.read")',
    );
  });

  it("كل إجراء قالب يفحص الصلاحية قبل أي عمل", () => {
    const actions = read("src/app/(app)/reports/builder/actions.ts");
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const firstStatement = body.slice(0, body.indexOf("\n}"));
      expect(firstStatement, `${name} لا يفحص الصلاحية أولاً`).toContain("requirePermission");
    }
  });

  it("خدمة القوالب تفحص صلاحية التقرير المصدر في كل مسار قراءة", () => {
    const src = read("src/lib/reports/templates.ts");
    // القراءة المفردة والقائمة كلتاهما تسقطان ما لا يملك المستخدم صلاحية تقريره
    expect(src).toContain("viewer.permissions.has(def.permission)");
    expect(src.match(/viewer\.permissions\.has\(def\.permission\)/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("§22 — لا HTML خام من مدخلات المستخدم في التصدير", () => {
  it("مسار التصدير يهرّب كل قيمة تدخل قالب PDF", () => {
    const route = read("src/app/api/reports/export/route.ts");
    // كل استيفاء داخل نص HTML يمر بـescapeHtml
    const interpolations = [...route.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
    const htmlish = interpolations.filter((v) => /c\.label|String\(c|def\.description|k\)|v\)/.test(v));
    for (const v of htmlish) {
      expect(v, `استيفاء غير مهرَّب: ${v}`).toContain("escapeHtml");
    }
  });

  it("لا استعمال لـdangerouslySetInnerHTML في السطح الجديد", () => {
    const files = [...walk("src/app/(app)/reports"), "src/components/report-filters.tsx", "src/components/completeness-meter.tsx"];
    const offenders = files.filter((f) => read(f).includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });
});

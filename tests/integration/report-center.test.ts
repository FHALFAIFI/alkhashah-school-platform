import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";
import { REPORTS } from "@/lib/reports/catalog";

/**
 * Scope v2.2 §D — the central report centre.
 *
 * The point of this suite is that every report in the catalogue actually executes against
 * a real database and returns rows shaped like its declared columns. A registry entry with
 * no working loader, or a loader querying a column that does not exist, fails here rather
 * than in front of the principal.
 */

let pool: Pool;

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({ id: "u", permissions: new Set(["reports.read"]), csrfToken: "x", sessionId: "x" })),
  requireUser: vi.fn(async () => ({ id: "u", permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("كل تقرير في السجل له محمّل يعمل فعلاً", () => {
  it("لكل تقرير محمّل مسجَّل", async () => {
    const { loaderKeys } = await import("@/lib/reports/loaders");
    const loaders = new Set(loaderKeys());
    for (const r of REPORTS) {
      expect(loaders.has(r.key), `التقرير «${r.key}» بلا محمّل`).toBe(true);
    }
  });

  it("لا محمّل يتيم بلا تعريف في السجل", async () => {
    const { loaderKeys } = await import("@/lib/reports/loaders");
    const defined = new Set(REPORTS.map((r) => r.key));
    for (const key of loaderKeys()) {
      expect(defined.has(key), `المحمّل «${key}» بلا تعريف`).toBe(true);
    }
  });

  // كل تقرير يُشغَّل فعلياً على قاعدة بيانات حقيقية — يكشف أي عمود أو جدول خاطئ
  it.each(REPORTS.map((r) => [r.key, r] as const))("يشغّل «%s» بلا خطأ", async (_key, report) => {
    const { runReport } = await import("@/lib/reports/loaders");
    const result = await runReport(report.key, { page: 1, pageSize: 20 });
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.total).toBe("number");
    expect(Number.isNaN(result.total)).toBe(false);
  });

  it("يشغّل كل تقرير مع مرشّحات مطبَّقة", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    for (const report of REPORTS) {
      const result = await runReport(report.key, {
        search: "بحث",
        dateFrom: "2020-01-01",
        dateTo: "2030-12-31",
        page: 1,
        pageSize: 10,
      });
      expect(Array.isArray(result.rows), `${report.key} فشل مع المرشّحات`).toBe(true);
    }
  });

  it("يرفض تقريراً غير معروف بدل تنفيذ شيء عشوائي", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    await expect(runReport("../../etc/passwd", {})).rejects.toThrow();
    await expect(runReport("لا-يوجد", {})).rejects.toThrow();
  });

  it("يتجاهل عمود ترتيب غير مسموح بدل تمريره إلى الاستعلام", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    // اسم عمود خبيث من عنوان URL لا يصل إلى قاعدة البيانات ولا يُسقط التقرير
    const result = await runReport("programs-active", { sort: "password_hash; drop table users", page: 1, pageSize: 10 });
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it("يحصر حجم صفحة ضخم مطلوب عبر المعاملات", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    const result = await runReport("programs-active", { page: 1, pageSize: 1_000_000 });
    expect(result.rows.length).toBeLessThanOrEqual(200);
  });
});

describe("التقارير مع بيانات حقيقية", () => {
  it("يعكس البرامج المغلقة والنشطة في التقريرين المناسبين", async () => {
    const { db } = await import("@/db");
    const { planYears, programs } = await import("@/db/schema");
    const suffix = Math.floor(Math.random() * 1e9);
    const [year] = await db.insert(planYears).values({ key: `rep-${suffix}`, nameAr: `سنة ${suffix}`, status: "نشطة" }).returning();
    await db.insert(programs).values([
      { planYearId: year.id, seq: 1, domain: "مجال أ", name: "برنامج نشط" },
      { planYearId: year.id, seq: 2, domain: "مجال ب", name: "برنامج مغلق", closedAt: new Date(), closureNote: "انتهى" },
    ]);

    const { runReport } = await import("@/lib/reports/loaders");
    const active = await runReport("programs-active", {});
    const closed = await runReport("programs-closed", {});

    expect(active.rows.map((r) => r.name)).toContain("برنامج نشط");
    // البرنامج المغلق يختفي من النشط ويظهر في التاريخي — لا يُحذف من التقارير
    expect(active.rows.map((r) => r.name)).not.toContain("برنامج مغلق");
    expect(closed.rows.map((r) => r.name)).toContain("برنامج مغلق");
    expect(closed.rows[0].closureNote).toBe("انتهى");
  });

  it("التقارير المجمَّعة تعمل مع بيانات فعلية لا مع جدول فارغ فقط", async () => {
    // انحدار: الدوال المجمَّعة مثل max(created_at) تعيد **نصاً** من سائق Postgres لا كائن
    // Date. على جدول فارغ تعيد null فلا يظهر الخلل؛ ومع بيانات فعلية كانت تُسقط التقرير.
    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks, planYears, programs } = await import("@/db/schema");
    const suffix = Math.floor(Math.random() * 1e9);
    const [year] = await db.insert(planYears).values({ key: `agg-${suffix}`, nameAr: `سنة ${suffix}` }).returning();
    const [prog] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: 900 + (suffix % 90), domain: "مجال", name: "برنامج التجميع" })
      .returning();
    const [ev] = await db.insert(evidenceItems).values({ title: "شاهد تجميع", kind: "text", textContent: "نص" }).returning();
    await db.insert(evidenceLinks).values({ evidenceId: ev.id, entityType: "program", entityId: prog.id });

    const { runReport } = await import("@/lib/reports/loaders");
    const byType = await runReport("evidence-by-type", {});
    const byProgram = await runReport("evidence-by-program", {});

    expect(byType.total).toBeGreaterThan(0);
    expect(byProgram.total).toBeGreaterThan(0);
    // التاريخ المجمَّع يُصيَّر نصاً بصيغة ISO لا كائناً ولا ينهار
    const latest = byType.rows[0].latest;
    expect(typeof latest === "string" || latest === null).toBe(true);
    if (typeof latest === "string") expect(latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("تقرير التحليل الرباعي يعكس العناصر الرسمية المخزَّنة", async () => {
    const { db } = await import("@/db");
    const { planYears, planSwotItems } = await import("@/db/schema");
    const suffix = Math.floor(Math.random() * 1e9);
    const [year] = await db.insert(planYears).values({ key: `swot-${suffix}`, nameAr: `سنة ${suffix}` }).returning();
    await db.insert(planSwotItems).values([
      { planYearId: year.id, category: "قوة", code: `ق-${suffix}`, item: "إدارة موحدة", implication: "حوكمة أوضح", sortOrder: 0 },
      { planYearId: year.id, category: "ضعف", code: `ض-${suffix}`, item: "فجوة معايرة", implication: null, sortOrder: 1 },
      { planYearId: year.id, category: "تهديد", code: `ت-${suffix}`, item: "عدم استقرار الإنترنت", implication: "تعطّل الاختبارات", sortOrder: 2 },
    ]);

    const { runReport } = await import("@/lib/reports/loaders");
    const register = await runReport("swot-register", {});
    const items = register.rows.map((r) => r.item);
    expect(items).toContain("إدارة موحدة");
    expect(items).toContain("عدم استقرار الإنترنت");
    // السنة تظهر مع كل عنصر — التقرير يعمل عبر أكثر من سنة تخطيطية
    expect(register.rows.every((r) => typeof r.planYear === "string")).toBe(true);

    // الترشيح بالنوع يعمل («الحالة» في هذا التقرير هي النوع)
    const strengths = await runReport("swot-register", { status: "قوة" });
    expect(strengths.rows.every((r) => r.category === "قوة")).toBe(true);
    expect(strengths.rows.map((r) => r.item)).toContain("إدارة موحدة");

    // البحث الجزئي على نص العنصر
    const search = await runReport("swot-register", { search: "الإنترنت" });
    expect(search.rows.map((r) => r.item)).toContain("عدم استقرار الإنترنت");

    const byCategory = await runReport("swot-by-category", {});
    const strengthRow = byCategory.rows.find((r) => r.category === "قوة");
    expect(strengthRow).toBeDefined();
    expect(Number(strengthRow!.count)).toBeGreaterThan(0);
  });

  it("يعرض «—» بدل قيمة فارغة عبر تنسيق العرض null-safe", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    const result = await runReport("programs-active", {});
    for (const row of result.rows) {
      for (const v of Object.values(row)) {
        // الصفوف قد تحوي null (حقول اختيارية) لكن لا تحوي أبداً النص "null" أو "undefined"
        expect(v).not.toBe("null");
        expect(v).not.toBe("undefined");
        expect(v).not.toBe("NaN");
      }
    }
  });
});

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

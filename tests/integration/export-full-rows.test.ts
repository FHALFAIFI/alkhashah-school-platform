import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * عيب v2.5.0 المكتشف في قياس إجهاد v2.6: كل تصدير فوق 200 صف كان يفقد بقيته بصمت.
 *
 * السبب: `runReportForExport` مرّت عبر `paginate` بحجم صفحة 5000، و`clampPageSize`
 * قصّه إلى حجم صفحة الشاشة (200) — وعلامة الاقتطاع لا تُرفع إلا فوق 5000، فالملف
 * الناقص بدا كاملاً. عروض v2.5.0 لم تُظهره لأن حجم الإنتاج كله دون 200 صف.
 *
 * العقد المثبَّت: التصدير يحمل **كل** الصفوف حتى سقفه المعلَن، والاقتطاع فوق السقف
 * يُصرَّح به، وحجم صفحة الشاشة لا يمسّ التصدير.
 */

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { planYears, programs } = await import("@/db/schema");
  const [y] = await db.insert(planYears).values({ key: "full-yr", nameAr: "سنة الاكتمال", status: "نشطة" }).returning();
  // 350 برنامجاً: فوق حجم صفحة الشاشة (200) ودون سقف التصدير (5000)
  const bulk = Array.from({ length: 350 }, (_, i) => ({
    planYearId: y.id,
    seq: i + 1,
    domain: "مجال الاكتمال",
    name: `برنامج اكتمال ${i + 1}`,
    status: "معتمد" as const,
  }));
  for (let i = 0; i < bulk.length; i += 100) await db.insert(programs).values(bulk.slice(i, i + 100));
});

afterAll(async () => {
  await pool.end();
});

describe("التصدير يحمل كل الصفوف", () => {
  it("350 صفاً تخرج 350 لا 200 — وبلا علامة اقتطاع كاذبة", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const result = await runReportForExport("programs-by-domain", {});
    expect(result.rows.length).toBe(350);
    expect(result.truncated).toBe(false);
  });

  it("الشاشة تبقى مقسّمة صفحات كما كانت — الإصلاح لا يمسّها", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    const screen = await runReport("programs-by-domain", { pageSize: 50, page: 1 });
    expect(screen.rows.length).toBe(50);
    expect(screen.total).toBe(350);
  });

  it("لقطة التقرير المحفوظ تحمل الصفوف كاملة أيضاً (v2.6)", async () => {
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    const [u] = await db.insert(users).values({ username: "t-full", displayName: "اكتمال", passwordHash: "x" }).returning();
    const { buildSnapshot } = await import("@/lib/reports/instances/snapshot");
    const doc = await buildSnapshot({
      typeKey: "single",
      title: "لقطة كاملة",
      storedFilters: {},
      storedOptions: { reportKey: "programs-by-domain" },
      periodFrom: null,
      periodTo: null,
      viewer: { id: u.id, permissions: new Set(["plan.read"]) },
    });
    expect(doc.sections[0].rows.length).toBe(350);
    expect(doc.sections[0].truncated).toBe(false);
  });
});

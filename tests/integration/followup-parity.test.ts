import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.5.0 §6.1 — التطابق بين الشاشة التشغيلية وتقرير المتابعة الأسبوعية.
 *
 * التكليف صريح: «أي اختلاف بينهما عيب». لذلك لا يكفي أن يستدعي الاثنان الوحدة نفسها في
 * الشيفرة — هذه الاختبارات تقارن **الناتج** صفاً بصف: العدد نفسه، الأسماء نفسها، حالة
 * الأسبوع نفسها، والتقدم نفسه، للأسبوع نفسه وبالمرشّحات نفسها.
 */

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["plan.read", "plan.write"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let yearId = "";
let seq = 1;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-parity", displayName: "تطابق", passwordHash: "x" }).returning();
  testUserId = u.id;
  const [y] = await db.insert(planYears).values({ key: "parity-yr", nameAr: "سنة التطابق", status: "نشطة" }).returning();
  yearId = y.id;
});

afterAll(async () => {
  await pool.end();
});

async function seedProgram(opts: { domain: string; owner: string; progress: number; name: string }) {
  const { db } = await import("@/db");
  const { programs } = await import("@/db/schema");
  const [p] = await db
    .insert(programs)
    .values({
      planYearId: yearId,
      seq: seq++,
      domain: opts.domain,
      name: opts.name,
      ownerPosition: opts.owner,
      status: "معتمد",
      progress: opts.progress,
      executionStatus: "في المسار",
    })
    .returning();
  return p;
}

describe("§6.1 — الشاشة والتقرير يقرآن مصدراً واحداً", () => {
  it("العدد والأسماء وحالة الأسبوع والتقدم متطابقة بلا مرشّحات", async () => {
    const { loadWeeklyFollowup } = await import("@/lib/plan/followup-service");
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { submitFollowupAction } = await import("@/app/(app)/plan/actions");

    const a = await seedProgram({ domain: "المجال الأول", owner: "وكيل الشؤون التعليمية", progress: 30, name: "برنامج أ" });
    const b = await seedProgram({ domain: "المجال الثاني", owner: "المرشد الطلابي", progress: 80, name: "برنامج ب" });
    await seedProgram({ domain: "المجال الأول", owner: "المرشد الطلابي", progress: 0, name: "برنامج ج" });

    const fd = new FormData();
    fd.set("note", "متابعة أ");
    fd.set("weekStatus", "متأخر");
    await submitFollowupAction(a.id, null, fd);

    const screen = await loadWeeklyFollowup({});
    const report = await runReportForExport("plan-followups", {});

    expect(report.rows).toHaveLength(screen.rows.length);
    const screenByName = new Map(screen.rows.map((r) => [r.name, r]));
    for (const row of report.rows) {
      const s = screenByName.get(String(row.programName));
      expect(s, `صف التقرير «${row.programName}» غير موجود على الشاشة`).toBeTruthy();
      expect(row.weekStatus).toBe(s!.weekStatus);
      expect(row.currentProgress).toBe(s!.progress);
      expect(row.domain).toBe(s!.domain);
      expect(row.owner).toBe(s!.owner);
      expect(row.group).toBe(s!.group);
    }
    // ما سُجّل فعلاً يظهر في الاثنين بالحالة نفسها
    expect(screenByName.get(b.name)!.weekStatus).toBe("لم يتم التحديث هذا الأسبوع");
    expect(screenByName.get("برنامج أ")!.weekStatus).toBe("متأخر");
  });

  it("المرشّحات تُطبَّق بالمعنى نفسه: مجال واحد، ثم مجالان، ثم الكل", async () => {
    const { loadWeeklyFollowup } = await import("@/lib/plan/followup-service");
    const { runReportForExport } = await import("@/lib/reports/loaders");

    const one = { domains: ["المجال الأول"] };
    const two = { domains: ["المجال الأول", "المجال الثاني"] };

    const screenOne = await loadWeeklyFollowup({ filters: one });
    const reportOne = await runReportForExport("plan-followups", one);
    expect(reportOne.rows).toHaveLength(screenOne.rows.length);
    expect(screenOne.rows.every((r) => r.domain === "المجال الأول")).toBe(true);

    const screenTwo = await loadWeeklyFollowup({ filters: two });
    expect(screenTwo.rows.length).toBeGreaterThan(screenOne.rows.length);

    const all = await loadWeeklyFollowup({ filters: {} });
    expect(all.rows.length).toBeGreaterThanOrEqual(screenTwo.rows.length);
    // المصفوفة الفارغة = الكل، تماماً كغيابها (§3.3)
    const emptyArray = await loadWeeklyFollowup({ filters: { domains: [] } });
    expect(emptyArray.rows).toHaveLength(all.rows.length);
  });

  it("مرشّح «بلا تحديث هذا الأسبوع» يعطي المجموعة نفسها في الاثنين", async () => {
    const { loadWeeklyFollowup } = await import("@/lib/plan/followup-service");
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const filters = { flags: ["notUpdated" as const] };

    const screen = await loadWeeklyFollowup({ filters });
    const report = await runReportForExport("plan-followups", filters);
    expect(report.rows).toHaveLength(screen.rows.length);
    expect(screen.rows.every((r) => !r.updatedThisWeek)).toBe(true);
  });

  it("الأسبوع المختار يُحترم في الاثنين — لا يقرأ التقرير أسبوع اليوم دائماً", async () => {
    const { loadWeeklyFollowup } = await import("@/lib/plan/followup-service");
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { previousWeekKey, isoWeekKey } = await import("@/lib/plan/followup");
    const prev = previousWeekKey(isoWeekKey())!;

    const screen = await loadWeeklyFollowup({ week: prev });
    const report = await runReportForExport("plan-followups", { week: prev });
    expect(screen.week).toBe(prev);
    expect(report.rows[0]?.weekKey).toBe(prev);
    // لا سجلات للأسبوع السابق — الاثنان يقولان «لم يتم التحديث» لا «مكتمل»
    expect(screen.rows.every((r) => !r.updatedThisWeek)).toBe(true);
    expect(report.rows.every((r) => r.weekStatus === "لم يتم التحديث هذا الأسبوع")).toBe(true);
  });

  it("نموذج المتابعة لا يحمل حقل نسبة إنجاز، ولا الإجراء يقبله", async () => {
    const { readFileSync } = await import("node:fs");
    const ui = readFileSync("src/app/(app)/plan/followup/followup-ui.tsx", "utf8");
    expect(ui).not.toContain('name="progress"');
    expect(ui).not.toContain("نسبة الإنجاز");

    const actions = readFileSync("src/app/(app)/plan/actions.ts", "utf8");
    const schema = actions.slice(actions.indexOf("const followupSchema"), actions.indexOf("export async function submitFollowupAction"));
    expect(schema).not.toContain("progress");

    // ولا يظهر العمود المهجور في أي تعريف تقرير
    const { REPORTS } = await import("@/lib/reports/catalog");
    const columns = REPORTS.flatMap((r) => r.columns.map((c) => c.key));
    expect(columns).not.toContain("progressSnapshot");
    expect(columns).not.toContain("weekProgress");
  });

  it("الوثيقة تسجّل الهجر: العمود باقٍ في المخطط بقيمه التاريخية", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("src/db/schema/plan.ts", "utf8");
    expect(schema).toContain("progressSnapshot");
    expect(schema).toContain("D-054");
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Corrective fix (post-v2.5.0 deployment), issue 1 — the low-performance threshold.
 *
 * The defect was not that the threshold misbehaved. Default 70 worked and `?lowThreshold=`
 * worked; what was missing was any way for the principal to *reach* it. The control existed
 * as a prop (`showLowThreshold`) that no page ever passed, so the feature was real in the
 * engine and invisible in the product.
 *
 * The fix makes the threshold a first-class filter key, which is what makes the panel render
 * it. So the first assertion here is the structural one: every performance report whose rows
 * depend on the threshold must DECLARE it — because declaring it is exactly what puts the
 * control on screen. A future report that forgets the declaration fails here rather than
 * shipping another invisible threshold.
 */

let pool: Pool;
const NAMES = { p50: "منسوب خمسين", p60: "منسوب ستين", p70: "منسوب سبعين", p90: "منسوب تسعين" };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

/** Seeds one completed cycle whose two equally weighted indicators carry the given ratings. */
async function seedPerson(fullName: string, r1: number, r2: number, userId: string) {
  const { db } = await import("@/db");
  const { people, perfModels, perfIndicators, perfCycles, perfSessions, perfRatings } = await import("@/db/schema");

  const [person] = await db.insert(people).values({ fullName, category: "معلم", employeeType: "معلم", active: true }).returning();
  const key = `thr-${fullName}-${Math.floor(Math.random() * 1e9)}`;
  const [model] = await db.insert(perfModels).values({ key, nameAr: `نموذج ${fullName}`, audience: "معلم", status: "معتمد" }).returning();
  const [i1] = await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "المعيار الأول", weight: "50" }).returning();
  const [i2] = await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "المعيار الثاني", weight: "50" }).returning();
  const [cycle] = await db
    .insert(perfCycles)
    .values({
      personId: person.id,
      cycleType: "معلم",
      yearKey: "1448",
      modelId: model.id,
      modelSnapshot: {
        model: { id: model.id, key: model.key, nameAr: model.nameAr },
        indicators: [
          { id: i1.id, nameAr: i1.nameAr, weight: "50" },
          { id: i2.id, nameAr: i2.nameAr, weight: "50" },
        ],
      },
      status: "مكتملة",
    })
    .returning();
  const [session] = await db
    .insert(perfSessions)
    .values({
      cycleId: cycle.id,
      sessionType: "نهائي",
      sessionDate: "2026-05-01",
      status: "مكتملة",
      lockedAt: new Date(),
      lockedBy: userId,
    })
    .returning();
  await db.insert(perfRatings).values({ sessionId: session.id, indicatorId: i1.id, rating: r1 });
  await db.insert(perfRatings).values({ sessionId: session.id, indicatorId: i2.id, rating: r2 });
  return person.id;
}

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-threshold", displayName: "اختبار العتبة", passwordHash: "x" }).returning();

  // ratings on a 1..5 scale over two 50-weight indicators → 10 × (r1 + r2) percent
  await seedPerson(NAMES.p50, 2, 3, u.id); // 50٪
  await seedPerson(NAMES.p60, 3, 3, u.id); // 60٪
  await seedPerson(NAMES.p70, 3, 4, u.id); // 70٪
  await seedPerson(NAMES.p90, 4, 5, u.id); // 90٪
});

afterAll(async () => {
  await pool.end();
});

async function lowPerformerNames(lowThreshold?: number): Promise<string[]> {
  const { runReport } = await import("@/lib/reports/loaders");
  const res = await runReport("perf-low-performers", lowThreshold === undefined ? {} : { lowThreshold });
  return res.rows.map((r) => String(r.personName)).sort();
}

describe("the threshold is declared — which is what renders the control", () => {
  it("every threshold-dependent performance report declares the lowThreshold filter", async () => {
    const { REPORTS } = await import("@/lib/reports/catalog");
    for (const key of ["perf-results", "perf-low-performers", "perf-strengths-weaknesses", "perf-distribution"]) {
      const def = REPORTS.find((r) => r.key === key);
      expect(def, `report ${key} must exist`).toBeTruthy();
      expect(def!.filters, `report ${key} must declare lowThreshold or its control never renders`).toContain("lowThreshold");
    }
  });

  it("the filter definition carries the Arabic label and helper text the principal reads", async () => {
    const { FILTER_DEFS } = await import("@/lib/reports/filters");
    expect(FILTER_DEFS.lowThreshold.labelAr).toBe("حد الأداء المنخفض");
    expect(FILTER_DEFS.lowThreshold.hintAr).toBe("يعرض الموظفين الذين تقل نتائجهم عن النسبة المحددة");
    expect(FILTER_DEFS.lowThreshold.params).toEqual(["lowThreshold"]);
  });
});

describe("default is 70", () => {
  it("effectiveLowThreshold falls back to exactly 70", async () => {
    const { effectiveLowThreshold, DEFAULT_LOW_THRESHOLD } = await import("@/lib/reports/filters");
    expect(DEFAULT_LOW_THRESHOLD).toBe(70);
    expect(effectiveLowThreshold({})).toBe(70);
    expect(effectiveLowThreshold({ lowThreshold: 85 })).toBe(85);
  });

  it("the default run matches exactly the employees below 70", async () => {
    expect(await lowPerformerNames()).toEqual([NAMES.p50, NAMES.p60].sort());
    // and is identical to asking for 70 explicitly
    expect(await lowPerformerNames(70)).toEqual(await lowPerformerNames());
  });

  it("the seeded percentages are the ones the scale implies — pins the fixture", async () => {
    const { loadEmployeeResults } = await import("@/lib/performance/results-service");
    const rows = await loadEmployeeResults({});
    const byName = new Map(rows.map((r) => [r.personName, r.resultPercent]));
    expect(byName.get(NAMES.p50)).toBe(50);
    expect(byName.get(NAMES.p60)).toBe(60);
    expect(byName.get(NAMES.p70)).toBe(70);
    expect(byName.get(NAMES.p90)).toBe(90);
  });
});

describe("changing the threshold changes the matching NAMES", () => {
  it("60 narrows the set relative to the default", async () => {
    const at60 = await lowPerformerNames(60);
    const atDefault = await lowPerformerNames();
    expect(at60).toEqual([NAMES.p50]);
    expect(at60).not.toEqual(atDefault);
    expect(atDefault).toEqual(expect.arrayContaining(at60));
  });

  it("80 widens the set relative to the default", async () => {
    const at80 = await lowPerformerNames(80);
    const atDefault = await lowPerformerNames();
    expect(at80).toEqual([NAMES.p50, NAMES.p60, NAMES.p70].sort());
    expect(at80).not.toEqual(atDefault);
    expect(at80).toEqual(expect.arrayContaining(atDefault));
  });

  it("the count moves with the names — the result count is not computed separately", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    expect((await runReport("perf-low-performers", { lowThreshold: 60 })).total).toBe(1);
    expect((await runReport("perf-low-performers", {})).total).toBe(2);
    expect((await runReport("perf-low-performers", { lowThreshold: 80 })).total).toBe(3);
  });

  it("the statistical report answers the threshold question too", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    const below = async (lowThreshold?: number) => {
      const res = await runReport("perf-distribution", lowThreshold === undefined ? {} : { lowThreshold });
      return res.rows.reduce((s, r) => s + Number(r.belowThreshold ?? 0), 0);
    };
    expect(await below(60)).toBe(1);
    expect(await below()).toBe(2);
    expect(await below(80)).toBe(3);
  });
});

describe("invalid values are rejected or normalized safely", () => {
  it("non-numeric and empty input fall back to the default rather than to zero", async () => {
    const { parseReportFilters, effectiveLowThreshold } = await import("@/lib/reports/filters");
    for (const raw of ["", "abc", "NaN", "--5"]) {
      const f = parseReportFilters(new URLSearchParams({ lowThreshold: raw }));
      expect(f.lowThreshold).toBeUndefined();
      expect(effectiveLowThreshold(f)).toBe(70);
    }
  });

  it("out-of-range values are clamped into 0..100, never applied raw", async () => {
    const { parseReportFilters } = await import("@/lib/reports/filters");
    expect(parseReportFilters(new URLSearchParams({ lowThreshold: "-40" })).lowThreshold).toBe(0);
    expect(parseReportFilters(new URLSearchParams({ lowThreshold: "9999" })).lowThreshold).toBe(100);
  });

  it("a clamped extreme still produces a coherent result set", async () => {
    // 0 matches nobody (no result is below 0), 100 matches everyone evaluated
    expect(await lowPerformerNames(0)).toEqual([]);
    expect(await lowPerformerNames(100)).toEqual([NAMES.p50, NAMES.p60, NAMES.p70, NAMES.p90].sort());
  });
});

describe("exports use the exact active threshold", () => {
  it("the export loader returns the same names as the screen for the same threshold", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    for (const lowThreshold of [60, 70, 80]) {
      const exported = (await runReportForExport("perf-low-performers", { lowThreshold })).rows
        .map((r) => String(r.personName))
        .sort();
      expect(exported, `threshold ${lowThreshold}`).toEqual(await lowPerformerNames(lowThreshold));
    }
  });

  it("the generated report header states the threshold — including at the default", async () => {
    const { lowThresholdHeaderLine } = await import("@/lib/reports/filters");
    expect(lowThresholdHeaderLine({})).toEqual(["حد الأداء المنخفض", "أقل من 70٪"]);
    expect(lowThresholdHeaderLine({ lowThreshold: 85 })).toEqual(["حد الأداء المنخفض", "أقل من 85٪"]);
  });

  it("a non-default threshold also shows as an active filter chip", async () => {
    const { describeFilters } = await import("@/lib/reports/filters");
    expect(describeFilters({ lowThreshold: 85 }).some((c) => c.key === "lowThreshold")).toBe(true);
    // at the default it is not an "active filter" — the header still states it
    expect(describeFilters({ lowThreshold: 70 }).some((c) => c.key === "lowThreshold")).toBe(false);
  });
});

describe("saved templates retain the threshold", () => {
  it("survives a serialize → parse round trip", async () => {
    const { serializeReportFilters, parseReportFilters } = await import("@/lib/reports/filters");
    const sp = serializeReportFilters({ lowThreshold: 85, employeeTypes: ["معلم"] });
    expect(sp.get("lowThreshold")).toBe("85");
    expect(parseReportFilters(sp).lowThreshold).toBe(85);
  });

  it("a template stored with a threshold reruns against that threshold, not the default", async () => {
    const { serializeReportFilters, parseReportFilters } = await import("@/lib/reports/filters");
    const stored = serializeReportFilters({ lowThreshold: 80 });
    const reloaded = parseReportFilters(stored);
    expect(await lowPerformerNames(reloaded.lowThreshold)).toEqual([NAMES.p50, NAMES.p60, NAMES.p70].sort());
  });
});

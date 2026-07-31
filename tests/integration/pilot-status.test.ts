import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await truncateAll(pool);
});

/** يبذر البنية المشتركة: سنة نشطة + برامج رسمية «مسودة» + طوابق (أرضي منشور، أول مسودة) */
async function seedCommon() {
  const { db } = await import("@/db");
  const { planYears, programs, floors, floorGeometryVersions } = await import("@/db/schema");
  const [year] = await db.insert(planYears).values({ key: "1448-1449", nameAr: "السنة النشطة", status: "نشطة" }).returning();
  for (let i = 1; i <= 26; i++) {
    await db.insert(programs).values({ planYearId: year.id, seq: i, domain: "مجال", name: `برنامج ${i}`, status: "مسودة" });
  }
  const [ground] = await db.insert(floors).values({ key: "ground", nameAr: "الدور الأرضي", level: 0, sortOrder: 1 }).returning();
  await db.insert(floorGeometryVersions).values({ floorId: ground.id, version: 1, geometry: { unit: "m", rooms: [] }, status: "منشورة" });
  const [first] = await db.insert(floors).values({ key: "first", nameAr: "الدور الأول", level: 1, sortOrder: 2 }).returning();
  await db.insert(floorGeometryVersions).values({ floorId: first.id, version: 1, geometry: { unit: "m", rooms: [] }, status: "مسودة" });
  return { year };
}

describe("مركز التشغيل التجريبي — الحالة المحسوبة", () => {
  it("حالة المعاينة: بانتظار تفعيل فارس، اللجان والأداء موقوفان", async () => {
    const { db } = await import("@/db");
    const { importBatches } = await import("@/db/schema");
    await seedCommon();
    const [fares] = await db
      .insert(importBatches)
      .values({ importType: "people", sourceFileName: "بيانات الموظفين في فارس.xlsx", status: "معاينة" })
      .returning();

    const { getPilotStatus } = await import("@/lib/pilot-status");
    const s = await getPilotStatus();

    expect(s.fares.committed).toBe(false);
    expect(s.fares.batchId).toBe(fares.id);
    expect(s.fares.peopleFromBatch).toBe(0);
    expect(s.fares.totalEmployees).toBe(0);
    expect(s.committeesReady).toBe(false);
    expect(s.performanceReady).toBe(false);
    expect(s.plan.officialDraftPrograms).toBe(26);
    expect(s.plan.total).toBe(26);
    expect(s.groundPublished).toBe(true);
    expect(s.upperFloorsPending).toContain("الدور الأول");
  });

  it("حالة التنفيذ: 52 منسوباً (42 معلماً/10 موظفين)، بلا حسابات، اللجان والأداء متاحان", async () => {
    const { db } = await import("@/db");
    const { importBatches, people } = await import("@/db/schema");
    await seedCommon();
    const [fares] = await db
      .insert(importBatches)
      .values({ importType: "people", sourceFileName: "بيانات الموظفين في فارس.xlsx", status: "منفذة", committedAt: new Date() })
      .returning();
    for (let i = 0; i < 42; i++) {
      await db.insert(people).values({ fullName: `معلم ${i}`, category: "معلم", active: true, importBatchId: fares.id });
    }
    for (let i = 0; i < 10; i++) {
      await db.insert(people).values({ fullName: `موظف ${i}`, category: "موظف", active: true, importBatchId: fares.id });
    }

    const { getPilotStatus } = await import("@/lib/pilot-status");
    const s = await getPilotStatus();

    expect(s.fares.committed).toBe(true);
    expect(s.fares.peopleFromBatch).toBe(52);
    expect(s.fares.teachers).toBe(42);
    expect(s.fares.staff).toBe(10);
    expect(s.fares.totalEmployees).toBe(52);
    expect(s.fares.employeeAccounts).toBe(0); // لا حسابات دخول للمنسوبين
    expect(s.fares.rollbackAvailable).toBe(true); // بلا ارتباطات = التبعيات السبع صفر
    expect(s.fares.rollbackDeps.length).toBe(0);
    expect(s.committeesReady).toBe(true);
    expect(s.performanceReady).toBe(true);
  });
});

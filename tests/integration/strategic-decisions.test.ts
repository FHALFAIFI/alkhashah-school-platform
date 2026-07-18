import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("القرارات الاستراتيجية المعلّقة أمام المدير", () => {
  it("تُشتق من الحالة الفعلية وتربط كل عنصر بالسجل/الإجراء", async () => {
    const { db } = await import("@/db");
    const { planYears, programs, perfModels, perfIndicators, importBatches, floors, floorGeometryVersions } = await import("@/db/schema");
    const { strategicPendingDecisions } = await import("@/lib/strategic-decisions");

    // سنة نشطة + برنامج رسمي «مسودة» (بانتظار الاعتماد)
    const [year] = await db.insert(planYears).values({ key: "y-active", nameAr: "السنة النشطة", status: "نشطة" }).returning();
    await db.insert(programs).values({ planYearId: year.id, seq: 1, domain: "مجال", name: "برنامج رسمي", status: "مسودة" });
    // برنامج اصطناعي (من دفعة «تجريبي») → الأرشفة مؤجلة
    const [synthBatch] = await db.insert(importBatches).values({ importType: "operational_plan", sourceFileName: "خطة تجريبي.xlsx", status: "منفذة" }).returning();
    await db.insert(programs).values({ planYearId: year.id, seq: 2, domain: "مجال", name: "برنامج اصطناعي", status: "مسودة", importBatchId: synthBatch.id });
    // دفعة فارس في المعاينة
    const [fares] = await db.insert(importBatches).values({ importType: "people", sourceFileName: "بيانات الموظفين في فارس.xlsx", status: "معاينة" }).returning();
    // نموذج D-014 رسمي أصلي
    const [model] = await db.insert(perfModels).values({ key: "school-vice", nameAr: "وكيل المدرسة", audience: "معلم", official: true, status: "معتمد", version: 1 }).returning();
    await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "ينفذ إجراءات علمية لتحسين نتائج التعلم", weight: "5", sortOrder: 0 });
    // طابق علوي مسودة (بلا منشورة)
    const [first] = await db.insert(floors).values({ key: "first", nameAr: "الدور الأول", level: 1, sortOrder: 2 }).returning();
    await db.insert(floorGeometryVersions).values({ floorId: first.id, version: 1, geometry: { unit: "m", rooms: [] }, status: "مسودة" });

    const items = await strategicPendingDecisions();
    const keys = new Set(items.map((i) => i.key));
    // العناصر الثمانية (مع منسوبين معتمدين = 0 → اللجان والأداء موقوفان)
    for (const k of ["fares", "plan-approval", "d014", "committees-blocked", "performance-blocked", "upper-floors", "archive-deferred", "c5-deferred"]) {
      expect(keys.has(k), `عنصر مفقود: ${k}`).toBe(true);
    }
    // كل عنصر يربط بسجل/إجراء
    for (const i of items) {
      expect(i.href.startsWith("/"), `رابط غير صالح لـ ${i.key}`).toBe(true);
      expect(i.action.length).toBeGreaterThan(2);
    }
    // فارس واللجان والأداء تربط بمعاينة فارس
    expect(items.find((i) => i.key === "fares")?.href).toBe(`/imports/${fares.id}`);
    expect(items.find((i) => i.key === "committees-blocked")?.href).toBe(`/imports/${fares.id}`);
    expect(items.find((i) => i.key === "d014")?.href).toBe(`/performance/models/${model.id}`);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * D-067 — ترشيح تقرير بمعرّف كان يُسقط الصفحة.
 *
 * `loadFilterLabelMaps` تحوّل معرّفات المرشّحات إلى أسماء تُعرض في الشرائح وفي ترويسة
 * التقرير المُصدَّر. كانت شروطها مكتوبة ``sql`${col} = any(${ids})` `` فتُربَط المصفوفة
 * معاملاً واحداً، فيقرأ Postgres المعرّف الواحد على أنه حرفيّة مصفوفة ويرفض بـ 22P02.
 * فكان اختيار «لجنة واحدة» أو «شخص واحد» أو «بند» أو «برنامج» من لوحة المرشّحات يقود
 * إلى شاشة «تعذّر إتمام العملية» بدل التقرير المُرشَّح.
 *
 * لم يكشفه أي اختبار سابق لأن اختبار الواجهة كان يستعمل `check()` على مربّع متحكَّم به،
 * فيفشل **قبل** أن يقع الانتقال — فبقي العطل مختبئاً خلف عطل الاختبار.
 *
 * تُغطّى المفاتيح الأربعة كلها هنا: مفتاح واحد ثم عدة، لأن الخطأ يقع في الحالتين.
 */

let pool: Pool;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);

  const { db } = await import("@/db");
  const { people, planYears, programs, committees, financialItems } = await import("@/db/schema");

  const [p1] = await db.insert(people).values({ fullName: "سالم المعلم", category: "معلم" }).returning();
  const [p2] = await db.insert(people).values({ fullName: "فهد الإداري", category: "موظف" }).returning();
  ids.person1 = p1.id;
  ids.person2 = p2.id;

  const [year] = await db.insert(planYears).values({ key: "lbl-yr", nameAr: "سنة التسميات", status: "نشطة" }).returning();
  const [prog1] = await db
    .insert(programs)
    .values({ planYearId: year.id, seq: 1, domain: "مجال", name: "برنامج التسميات الأول" })
    .returning();
  const [prog2] = await db
    .insert(programs)
    .values({ planYearId: year.id, seq: 2, domain: "مجال", name: "برنامج التسميات الثاني" })
    .returning();
  ids.program1 = prog1.id;
  ids.program2 = prog2.id;

  const [c1] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "لجنة التوجيه والإرشاد", kind: "لجنة", status: "معتمدة" })
    .returning();
  const [c2] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "لجنة النشاط", kind: "لجنة", status: "معتمدة" })
    .returning();
  ids.committee1 = c1.id;
  ids.committee2 = c2.id;

  const [item] = await db
    .insert(financialItems)
    .values({ nameAr: "بند المستلزمات" })
    .returning();
  ids.item1 = item.id;
});

afterAll(async () => {
  await pool.end();
});

describe("D-067 — تحويل معرّفات المرشّحات إلى أسماء لا يرفع خطأ", () => {
  it("لجنة واحدة ثم لجنتان — يُعاد الاسم لا المعرّف", async () => {
    const { loadFilterLabelMaps } = await import("@/lib/reports/filter-options");

    const one = await loadFilterLabelMaps({ committeeIds: [ids.committee1] });
    expect(one.committees?.get(ids.committee1)).toBe("لجنة التوجيه والإرشاد");

    const two = await loadFilterLabelMaps({ committeeIds: [ids.committee1, ids.committee2] });
    expect(two.committees?.size).toBe(2);
    expect(two.committees?.get(ids.committee2)).toBe("لجنة النشاط");
  });

  it("شخص وبرنامج وبند — كلها تُحلّ في نداء واحد", async () => {
    const { loadFilterLabelMaps } = await import("@/lib/reports/filter-options");

    const maps = await loadFilterLabelMaps({
      personIds: [ids.person1, ids.person2],
      programIds: [ids.program1],
      itemIds: [ids.item1],
      committeeIds: [ids.committee1],
    });

    expect(maps.people?.get(ids.person1)).toBe("سالم المعلم");
    expect(maps.people?.get(ids.person2)).toBe("فهد الإداري");
    // اسم البرنامج يُعرض مسبوقاً بترتيبه في الخطة كما في كل قوائم البرامج
    expect(maps.programs?.get(ids.program1)).toBe("1. برنامج التسميات الأول");
    expect(maps.items?.get(ids.item1)).toBe("بند المستلزمات");
    expect(maps.committees?.get(ids.committee1)).toBe("لجنة التوجيه والإرشاد");
  });

  it("مفاتيح غائبة لا تُستعلَم أصلاً فلا تُعاد خرائط فارغة مضلّلة", async () => {
    const { loadFilterLabelMaps } = await import("@/lib/reports/filter-options");
    const maps = await loadFilterLabelMaps({});
    expect(maps.people).toBeUndefined();
    expect(maps.committees).toBeUndefined();
    expect(maps.programs).toBeUndefined();
    expect(maps.items).toBeUndefined();
  });

  it("التقرير نفسه يُرشَّح بلجنة واحدة ويعيد صفوفها وحدها", async () => {
    const { db } = await import("@/db");
    const { committeeMembers, people } = await import("@/db/schema");
    const { runReport } = await import("@/lib/reports/loaders");

    const [member] = await db.select().from(people).limit(1);
    await db.insert(committeeMembers).values({
      committeeId: ids.committee1,
      personId: member.id,
      role: "رئيس",
      sortOrder: 1,
    });

    const all = await runReport("committee-registry-detailed", {});
    const one = await runReport("committee-registry-detailed", { committeeIds: [ids.committee1] });
    expect(one.total).toBeGreaterThan(0);
    expect(one.total).toBeLessThan(all.total);
    expect(one.rows.every((r) => r.committeeName === "لجنة التوجيه والإرشاد")).toBe(true);
  });
});

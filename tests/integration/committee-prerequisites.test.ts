import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["committees.write", "committees.approve", "reports.generate"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-prereq", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

describe("committee prerequisites — dependency on committed employee data", () => {
  it("formation is blocked with no committed employees, allowed once one exists", async () => {
    const { db } = await import("@/db");
    const { planYears, committeeTemplates, committees, people } = await import("@/db/schema");
    const { createCommitteeFromTemplateAction } = await import("@/app/(app)/committees/actions");
    const { committedEmployeeCount } = await import("@/lib/committees/prerequisites");

    await db.insert(planYears).values({ key: "cm-active", nameAr: "سنة نشطة", status: "نشطة" });
    const [tpl] = await db
      .insert(committeeTemplates)
      .values({ key: "tpl-admin", nameAr: "اللجنة الإدارية", kind: "لجنة", recurrence: "monthly" })
      .returning();

    // لا منسوبين معتمدين → التشكيل مرفوض برسالة عربية
    expect(await committedEmployeeCount()).toBe(0);
    const fd = new FormData();
    fd.set("templateId", tpl.id);
    const blocked = await createCommitteeFromTemplateAction(null, fd);
    expect(blocked?.error).toContain("بيانات منسوبي المدرسة");
    expect((await db.select().from(committees)).length).toBe(0);

    // بعد اعتماد منسوب واحد نشط → التشكيل مسموح
    await db.insert(people).values({ fullName: "منسوب معتمد", category: "معلم", active: true });
    expect(await committedEmployeeCount()).toBe(1);
    const fd2 = new FormData();
    fd2.set("templateId", tpl.id);
    await createCommitteeFromTemplateAction(null, fd2);
    const formed = await db.select().from(committees);
    expect(formed.length).toBe(1);
    // بلا نسخ عضويات: اللجنة الجديدة تبدأ بلا أعضاء
    const { committeeMembers } = await import("@/db/schema");
    expect((await db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, formed[0].id))).length).toBe(0);
  });

  it("official template can be disabled and re-enabled — never deleted", async () => {
    const { db } = await import("@/db");
    const { committeeTemplates } = await import("@/db/schema");
    const { toggleTemplateActiveAction } = await import("@/app/(app)/committees/actions");
    const [tpl] = await db
      .insert(committeeTemplates)
      .values({ key: "tpl-quality", nameAr: "لجنة التميز والجودة", kind: "لجنة", recurrence: "term" })
      .returning();

    await toggleTemplateActiveAction(tpl.id, false);
    let [row] = await db.select().from(committeeTemplates).where(eq(committeeTemplates.id, tpl.id));
    expect(row.active).toBe(false); // معطَّل لكنه ما زال موجوداً (لم يُحذف)

    await toggleTemplateActiveAction(tpl.id, true);
    [row] = await db.select().from(committeeTemplates).where(eq(committeeTemplates.id, tpl.id));
    expect(row.active).toBe(true);
  });

  // v2.1 correction (H): the meeting type is now OPTIONAL — a meeting saves with no type,
  // and when a type is supplied it is still stored.
  it("new meeting saves without a type (type now optional), and stores a type when given", async () => {
    const { db } = await import("@/db");
    const { planYears, committees, meetingTypes, meetings } = await import("@/db/schema");
    const { createMeetingAction } = await import("@/app/(app)/committees/actions");
    const [year] = await db.select().from(planYears);
    const [c] = await db.insert(committees).values({ planYearId: year.id, nameAr: "لجنة اجتماعات", kind: "لجنة", status: "معتمدة", recurrence: "monthly" }).returning();
    const [mt] = await db.insert(meetingTypes).values({ key: "t-periodic", nameAr: "دوري", sortOrder: 1 }).returning();

    // no type → not blocked; a meeting row is created with a null typeId
    await createMeetingAction(c.id, null, new FormData()); // redirect مُموَّه
    const afterNoType = await db.select().from(meetings).where(eq(meetings.committeeId, c.id));
    expect(afterNoType.length).toBe(1);
    expect(afterNoType[0].typeId).toBeNull();

    // with a valid type → the type is stored
    const fd = new FormData();
    fd.set("typeId", mt.id);
    fd.set("title", "اجتماع");
    await createMeetingAction(c.id, null, fd); // redirect مُموَّه
    const typed = (await db.select().from(meetings).where(eq(meetings.committeeId, c.id))).find((m) => m.typeId === mt.id);
    expect(typed?.typeId).toBe(mt.id);
  });

  // v2.1 correction (G3): النتائج/الأثر (committee_impacts) were removed from the workflow — annual
  // closure NO LONGER requires documented results/impact. A committee with no blocking meetings closes directly.
  it("annual closure no longer requires results/impact (removed in v2.1)", async () => {
    const { db } = await import("@/db");
    const { planYears, committees } = await import("@/db/schema");
    const { closeCommitteeAction } = await import("@/app/(app)/committees/actions");
    const [year] = await db.select().from(planYears);
    // لجنة معتمدة بلا اجتماعات — عزل عن بوابة الاجتماعات المسودة/بانتظار التوقيع
    const [c] = await db.insert(committees).values({ planYearId: year.id, nameAr: "لجنة إقفال", kind: "لجنة", status: "معتمدة", recurrence: "term" }).returning();

    const ok = await closeCommitteeAction(c.id);
    expect(ok?.error).toBeFalsy();
    const [row] = await db.select().from(committees).where(eq(committees.id, c.id));
    expect(row.status).toBe("مقفلة");
  });
});

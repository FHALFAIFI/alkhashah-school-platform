import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.5.0 §9 — التقارير الثلاثة المتمايزة للمجالس واللجان.
 *
 * ما تثبّته هذه الاختبارات هو بالضبط ما اشتكى منه المدير على v2.4.1:
 *  • الملخص الإحصائي والسجل التفصيلي وسجل الاجتماعات **تقارير ثلاثة** لا تقرير واحد مختلط.
 *  • السجل التفصيلي **صف لكل عضو ولكل مهمة** — لا خلية تجمع الأعضاء ولا خلية تجمع المهام.
 *  • صفوف كل لجنة متجاورة وتحمل اسمها، فلا تختلط لجنتان في قائمة واحدة بلا عنوان.
 *  • «واحدة أو عدة أو الكل» يعمل على اللجان كما على غيرها.
 */

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["committees.read", "committees.write"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ids: Record<string, string> = {};

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, people, planYears, committees, committeeMembers, committeeTaskAssignments, meetings, meetingOutcomes } =
    await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: "t-cm", displayName: "لجان", passwordHash: "x" }).returning();
  testUserId = u.id;

  const [p1] = await db.insert(people).values({ fullName: "أحمد المرشد", category: "معلم" }).returning();
  const [p2] = await db.insert(people).values({ fullName: "سعد الإداري", category: "موظف" }).returning();
  const [year] = await db.insert(planYears).values({ key: "cm-yr", nameAr: "سنة اللجان", status: "نشطة" }).returning();

  const [c1] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "لجنة التوجيه والإرشاد", kind: "لجنة", status: "معتمدة" })
    .returning();
  const [c2] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "اللجنة الإدارية للمدرسة", kind: "لجنة", status: "معتمدة" })
    .returning();
  ids.c1 = c1.id;
  ids.c2 = c2.id;

  const [m1] = await db
    .insert(committeeMembers)
    .values({ committeeId: c1.id, personId: p1.id, role: "رئيس اللجنة" })
    .returning();
  const [m2] = await db
    .insert(committeeMembers)
    .values({ committeeId: c1.id, personId: p2.id, role: "عضو" })
    .returning();
  await db.insert(committeeMembers).values({ committeeId: c2.id, personId: p2.id, role: "مقرر" });

  // عضو برئاسة ومهمتين — الحالة الحرجة التي كانت تُدمج في خلية واحدة
  await db.insert(committeeTaskAssignments).values([
    { committeeId: c1.id, assignedMemberId: m1.id, title: "إعداد خطة الإرشاد", status: "منجزة" },
    { committeeId: c1.id, assignedMemberId: m1.id, title: "متابعة الحالات الفردية", status: "قيد التنفيذ" },
    { committeeId: c1.id, assignedMemberId: m2.id, title: "توثيق اللقاءات" },
  ]);

  const [mt] = await db
    .insert(meetings)
    .values({
      committeeId: c1.id,
      seq: 1,
      title: "الاجتماع الأول",
      status: "مكتمل",
      meetingDate: new Date("2026-03-10T08:00:00.000Z"),
      location: "قاعة الاجتماعات",
      agenda: ["مراجعة الخطة", "الحالات الطارئة"],
      discussion: "نوقشت الخطة",
    })
    .returning();
  await db.insert(meetingOutcomes).values([
    { meetingId: mt.id, outcomeType: "قرار", text: "اعتماد خطة الإرشاد" },
    { meetingId: mt.id, outcomeType: "توصية", text: "زيادة اللقاءات الفردية" },
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("§9.1 — ثلاثة تقارير متمايزة", () => {
  it("الملخص الإحصائي أعداد بلا أسماء", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { rows } = await runReportForExport("committee-summary", {});
    const guidance = rows.find((r) => r.nameAr === "لجنة التوجيه والإرشاد")!;
    expect(guidance.memberCount).toBe(2);
    expect(guidance.meetingCount).toBe(1);
    expect(guidance.taskCount).toBe(3);
    expect(guidance.completedTasks).toBe(1);
    expect(guidance.unsetTasks).toBe(1);
    // لا اسم عضو في الملخص — الأسماء مكانها السجل التفصيلي
    const keys = Object.keys(guidance);
    expect(keys).not.toContain("personName");
  });

  it("السجل التفصيلي: صف لكل (عضو × مهمة) ولا خلية مدموجة", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { rows } = await runReportForExport("committee-registry-detailed", {});

    const chairRows = rows.filter((r) => r.personName === "أحمد المرشد");
    expect(chairRows).toHaveLength(2); // مهمتان ← صفّان
    expect(chairRows.map((r) => r.taskText).sort()).toEqual(["إعداد خطة الإرشاد", "متابعة الحالات الفردية"].sort());
    expect(chairRows.every((r) => r.role === "رئيس اللجنة")).toBe(true);
    // لا فاصلة تجمع مهمتين في خلية واحدة
    expect(chairRows.every((r) => !String(r.taskText).includes("؛"))).toBe(true);

    // المهمة بلا حالة تُقال صراحةً ولا تُقدَّم منجزة
    const undocumented = rows.find((r) => r.taskText === "توثيق اللقاءات")!;
    expect(undocumented.taskStatus).toBe("لم يتم تحديد الحالة");
  });

  it("صفوف كل لجنة متجاورة وتحمل اسمها", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { rows } = await runReportForExport("committee-registry-detailed", {});
    const names = rows.map((r) => String(r.committeeName));
    // كل اسم يظهر في نطاق متصل واحد — لا تداخل بين اللجان
    const firstIndex = new Map<string, number>();
    const lastIndex = new Map<string, number>();
    names.forEach((n, i) => {
      if (!firstIndex.has(n)) firstIndex.set(n, i);
      lastIndex.set(n, i);
    });
    for (const [name, first] of firstIndex) {
      const last = lastIndex.get(name)!;
      expect(names.slice(first, last + 1).every((n) => n === name)).toBe(true);
    }
    expect(rows.every((r) => r.committeeName)).toBe(true);
  });

  it("«واحدة أو عدة أو الكل» على اللجان", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const all = await runReportForExport("committee-registry-detailed", {});
    const one = await runReportForExport("committee-registry-detailed", { committeeIds: [ids.c1] });
    const two = await runReportForExport("committee-registry-detailed", { committeeIds: [ids.c1, ids.c2] });

    expect(one.rows.every((r) => r.committeeName === "لجنة التوجيه والإرشاد")).toBe(true);
    expect(two.rows.length).toBeGreaterThan(one.rows.length);
    expect(all.rows.length).toBe(two.rows.length);
    // المصفوفة الفارغة = الكل
    const empty = await runReportForExport("committee-registry-detailed", { committeeIds: [] });
    expect(empty.rows.length).toBe(all.rows.length);
  });

  it("اللجنة بلا مهام تبقى في السجل، ومرشّح «بلا مهام» يعزلها", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const noTasks = await runReportForExport("committee-registry-detailed", { flags: ["noTasks"] });
    expect(noTasks.rows.some((r) => r.committeeName === "اللجنة الإدارية للمدرسة")).toBe(true);
    expect(noTasks.rows.every((r) => r.taskText === null)).toBe(true);
  });

  it("سجل الاجتماعات التفصيلي يحمل التفاصيل على مستوى الاجتماع", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { rows } = await runReportForExport("meetings-registry-detailed", {});
    expect(rows).toHaveLength(1);
    const m = rows[0];
    expect(m.committeeName).toBe("لجنة التوجيه والإرشاد");
    expect(m.meetingNumber).toBe(1);
    expect(m.agenda).toBe("مراجعة الخطة · الحالات الطارئة");
    expect(m.decisions).toBe("اعتماد خطة الإرشاد");
    expect(m.recommendations).toBe("زيادة اللقاءات الفردية");
    expect(m.minutesSigned).toBe("لم يُستلم المحضر الموقّع");
    expect(m.meetingDate).toBe("2026-03-10");
  });

  it("مرشّحات سجل الاجتماعات: لجنة ومدة", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const other = await runReportForExport("meetings-registry-detailed", { committeeIds: [ids.c2] });
    expect(other.rows).toHaveLength(0);
    const outside = await runReportForExport("meetings-registry-detailed", { dateFrom: "2026-05-01" });
    expect(outside.rows).toHaveLength(0);
    const inside = await runReportForExport("meetings-registry-detailed", { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    expect(inside.rows).toHaveLength(1);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

// محاكاة سياق الطلب: صلاحيات كاملة، وبلا كوكيز حقيقية
vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["committees.write", "committees.approve", "tasks.write", "reports.generate"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions: new Set() })),
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
  const [u] = await db.insert(users).values({ username: "t-actions", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

async function seedCommitteeFixture() {
  const { db } = await import("@/db");
  const { people, planYears, committees, committeeMembers, meetings } = await import("@/db/schema");
  const suffix = Math.floor(Math.random() * 1e9);
  const [year] = await db.insert(planYears).values({ key: `cm-yr-${suffix}`, nameAr: "سنة لجان" }).returning();
  const [chairPerson] = await db.insert(people).values({ fullName: `رئيس تجريبي ${suffix}`, category: "معلم" }).returning();
  const [secPerson] = await db.insert(people).values({ fullName: `مقرر تجريبي ${suffix}`, category: "معلم" }).returning();
  const [c] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "لجنة تجريبية", kind: "لجنة", status: "معتمدة", recurrence: "monthly" })
    .returning();
  await db.insert(committeeMembers).values({ committeeId: c.id, personId: chairPerson.id, role: "رئيس" });
  await db.insert(committeeMembers).values({ committeeId: c.id, personId: secPerson.id, role: "مقرر" });
  const [meeting] = await db
    .insert(meetings)
    .values({ committeeId: c.id, seq: 1, title: "اجتماع تجريبي", agenda: ["بند أول"] })
    .returning();
  return { year, c, meeting, chairPerson, secPerson };
}

describe("قواعد الاجتماعات عبر الإجراءات الفعلية (A5, A6)", () => {
  it("A5: اعتماد الاكتمال يرفض دون محضر موقع ثم ينجح بعد رفعه", async () => {
    const { db } = await import("@/db");
    const { meetings, storedFiles } = await import("@/db/schema");
    const { completeMeetingAction } = await import("@/app/(app)/committees/actions");
    const { meeting } = await seedCommitteeFixture();

    const rejected = await completeMeetingAction(meeting.id);
    expect(rejected?.error).toContain("المحضر الموقع");

    const [f] = await db
      .insert(storedFiles)
      .values({ originalName: "محضر-موقع.pdf", mime: "application/pdf", size: 100, sha256: "x", storagePath: `attachments/t-${Math.random()}.pdf` })
      .returning();
    await db.update(meetings).set({ signedMinutesFileId: f.id }).where(eq(meetings.id, meeting.id));

    const accepted = await completeMeetingAction(meeting.id);
    expect(accepted?.error).toBeUndefined();
    const [done] = await db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(done.status).toBe("مكتمل");

    // بعد الاكتمال: لا تعديل ولا نتائج جديدة
    const { addOutcomeAction } = await import("@/app/(app)/committees/actions");
    const fd = new FormData();
    fd.set("outcomeType", "ملاحظة");
    fd.set("text", "نص متأخر");
    const blocked = await addOutcomeAction(meeting.id, null, fd);
    expect(blocked?.error).toContain("مكتمل");
  });

  it("A6: القرار ينشئ إجراءً إلزامياً تلقائياً ولا يمكن إلغاؤه", async () => {
    const { db } = await import("@/db");
    const { meetingOutcomes, actionTasks } = await import("@/db/schema");
    const { addOutcomeAction } = await import("@/app/(app)/committees/actions");
    const { updateTaskStatusAction } = await import("@/app/(app)/tasks/actions");
    const { meeting, chairPerson } = await seedCommitteeFixture();

    const fd = new FormData();
    fd.set("outcomeType", "قرار");
    fd.set("text", "قرار تجريبي ملزم");
    fd.set("ownerPersonId", chairPerson.id);
    const res = await addOutcomeAction(meeting.id, null, fd);
    expect(res?.error).toBeUndefined();

    const outcomes = await db.select().from(meetingOutcomes).where(eq(meetingOutcomes.meetingId, meeting.id));
    expect(outcomes.length).toBe(1);
    expect(outcomes[0].taskId).not.toBeNull();

    const [task] = await db.select().from(actionTasks).where(eq(actionTasks.id, outcomes[0].taskId!));
    expect(task.mandatory).toBe(true);
    expect(task.sourceType).toBe("meeting_outcome");

    // محاولة إلغاء المهمة الإلزامية ترفض بصمت (تبقى كما هي)
    const cancelFd = new FormData();
    cancelFd.set("status", "ملغاة");
    cancelFd.set("progress", "0");
    await updateTaskStatusAction(task.id, cancelFd);
    const [after] = await db.select().from(actionTasks).where(eq(actionTasks.id, task.id));
    expect(after.status).not.toBe("ملغاة");
  });

  it("التوصية تنشئ إجراءً اختيارياً فقط عند الطلب", async () => {
    const { db } = await import("@/db");
    const { meetingOutcomes, actionTasks } = await import("@/db/schema");
    const { addOutcomeAction } = await import("@/app/(app)/committees/actions");
    const { meeting } = await seedCommitteeFixture();

    // توصية بلا إجراء
    const fd1 = new FormData();
    fd1.set("outcomeType", "توصية");
    fd1.set("text", "توصية بلا إجراء");
    await addOutcomeAction(meeting.id, null, fd1);

    // توصية بإجراء اختياري
    const fd2 = new FormData();
    fd2.set("outcomeType", "توصية");
    fd2.set("text", "توصية بإجراء");
    fd2.set("createTask", "on");
    await addOutcomeAction(meeting.id, null, fd2);

    const outcomes = await db.select().from(meetingOutcomes).where(eq(meetingOutcomes.meetingId, meeting.id));
    const withoutTask = outcomes.find((o) => o.text === "توصية بلا إجراء")!;
    const withTask = outcomes.find((o) => o.text === "توصية بإجراء")!;
    expect(withoutTask.taskId).toBeNull();
    expect(withTask.taskId).not.toBeNull();
    const [task] = await db.select().from(actionTasks).where(eq(actionTasks.id, withTask.taskId!));
    expect(task.mandatory).toBe(false);
  });

  it("لا أعمدة حضور أو غياب أو نصاب في قاعدة البيانات إطلاقاً", async () => {
    const res = await pool.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name ILIKE '%attend%' OR column_name ILIKE '%absen%' OR column_name ILIKE '%quorum%')
    `);
    expect(res.rows).toEqual([]);
  });

  it("الأعضاء من سجل المدرسة فقط ولا يضاف عضو للجنة مقفلة", async () => {
    const { db } = await import("@/db");
    const { committees } = await import("@/db/schema");
    const { addMemberAction } = await import("@/app/(app)/committees/actions");
    const { c, chairPerson } = await seedCommitteeFixture();

    // عضو خارجي (معرف غير موجود في سجل الأشخاص)
    const fd = new FormData();
    fd.set("personId", "123e4567-e89b-42d3-a456-426614174000");
    fd.set("role", "عضو");
    const rejected = await addMemberAction(c.id, null, fd);
    expect(rejected?.error).toContain("سجل منسوبي المدرسة");

    // لجنة مقفلة
    await db.update(committees).set({ status: "مقفلة" }).where(eq(committees.id, c.id));
    const fd2 = new FormData();
    fd2.set("personId", chairPerson.id);
    fd2.set("role", "عضو");
    const closed = await addMemberAction(c.id, null, fd2);
    expect(closed?.error).toContain("مقفلة");
  });
});

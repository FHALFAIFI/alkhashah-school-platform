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
    permissions: new Set(["committees.read", "committees.write", "committees.approve"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-ctask", displayName: "اختبار المهام", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

async function seedCommittee() {
  const { db } = await import("@/db");
  const { planYears, committeeTemplates, committees, committeeMembers, people } = await import("@/db/schema");
  const s = Math.floor(Math.random() * 1e9);
  const [year] = await db.insert(planYears).values({ key: `ct-yr-${s}`, nameAr: `سنة ${s}` }).returning();
  const [tmpl] = await db
    .insert(committeeTemplates)
    .values({ key: `ct-tmpl-${s}`, nameAr: "لجنة اختبار", kind: "لجنة", duties: ["مهمة أولى", "مهمة ثانية", "مهمة ثالثة"] })
    .returning();
  const [c] = await db
    .insert(committees)
    .values({ templateId: tmpl.id, planYearId: year.id, nameAr: "لجنة اختبار سنوية", kind: "لجنة", status: "معتمدة" })
    .returning();
  const [person] = await db.insert(people).values({ fullName: `عضو ${s}`, category: "معلم" }).returning();
  const [member] = await db
    .insert(committeeMembers)
    .values({ committeeId: c.id, personId: person.id, role: "رئيس", sortOrder: 0 })
    .returning();
  return { year, tmpl, committee: c, member };
}

describe("مهام اللجان: القوالب المعرّفة مسبقاً + توقيع حسب النوع (D-027)", () => {
  it("البذر من مهام القالب ثم التحميل والإسناد وإعادة الترتيب والاستبعاد", async () => {
    const { db } = await import("@/db");
    const { committeeTaskAssignments } = await import("@/db/schema");
    const { seedCommitteeTaskTemplates } = await import("@/lib/committees/task-templates");
    const { loadCommitteeTasksAction, assignCommitteeTaskAction, toggleCommitteeTaskExcludedAction } = await import("@/app/(app)/committees/task-actions");
    const { committee, member } = await seedCommittee();

    const { seeded } = await seedCommitteeTaskTemplates();
    expect(seeded).toBeGreaterThanOrEqual(3);

    const loaded = await loadCommitteeTasksAction(committee.id);
    expect(loaded?.error).toBeUndefined();
    let tasks = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.committeeId, committee.id));
    expect(tasks.length).toBe(3);

    // التحميل ثانيةً لا يكرّر (fromTemplateId)
    await loadCommitteeTasksAction(committee.id);
    tasks = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.committeeId, committee.id));
    expect(tasks.length).toBe(3);

    // الإسناد لعضو
    await assignCommitteeTaskAction(tasks[0].id, member.id);
    const [assigned] = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, tasks[0].id));
    expect(assigned.assignedMemberId).toBe(member.id);

    // الاستبعاد
    await toggleCommitteeTaskExcludedAction(tasks[1].id, true);
    const [excluded] = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, tasks[1].id));
    expect(excluded.excluded).toBe(true);
  });

  it("توليد جدول التوزيع يُصدر الوثيقة حتى بلا مهام موزّعة — قائمة الأعضاء مستقلة (v2.1)", async () => {
    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");
    const { generateAssignmentForm } = await import("@/lib/reports/assignment-form");
    const { committee } = await seedCommittee(); // بلا تحميل مهام
    // لم يعد يُرمى خطأ عند غياب المهام — تظهر قائمة الأعضاء وقسم مهام فارغ، وتصدر الوثيقة
    const result = await generateAssignmentForm({ committeeId: committee.id, issuedBy: testUserId });
    const [doc] = await db.select().from(documents).where(eq(documents.id, result.docId));
    expect(doc.docType).toBe("committee_assignment");
    expect(doc.htmlSnapshot).toContain("أعضاء اللجنة");
    expect(doc.htmlSnapshot).toContain("مهام اللجنة");
    // العضو يظهر رغم غياب أي مهمة مسندة (دور «رئيس» في عمود العمل في اللجنة)
    expect(doc.htmlSnapshot).toContain("رئيس");
  });

  it("التوقيع حسب نوع الاجتماع: نوع بلا اشتراط يكتمل دون محضر موقّع، ونوع باشتراط يُحجب", async () => {
    const { db } = await import("@/db");
    const { meetingTypes, meetings } = await import("@/db/schema");
    const { completeMeetingAction } = await import("@/app/(app)/committees/actions");
    const { setMeetingTypeSignatureAction } = await import("@/app/(app)/committees/task-actions");
    const { committee } = await seedCommittee();
    const s = Math.floor(Math.random() * 1e9);

    // نوع بلا اشتراط توقيع (الافتراضي false)
    const [freeType] = await db.insert(meetingTypes).values({ key: `mt-free-${s}`, nameAr: "دوري" }).returning();
    const [m1] = await db.insert(meetings).values({ committeeId: committee.id, seq: 1, typeId: freeType.id, status: "مسودة" }).returning();
    const r1 = await completeMeetingAction(m1.id);
    expect(r1?.error).toBeUndefined();
    const [done] = await db.select().from(meetings).where(eq(meetings.id, m1.id));
    expect(done.status).toBe("مكتمل");

    // نوع يشترط التوقيع
    const [signType] = await db.insert(meetingTypes).values({ key: `mt-sign-${s}`, nameAr: "ختامي" }).returning();
    await setMeetingTypeSignatureAction(signType.id, true);
    const [m2] = await db.insert(meetings).values({ committeeId: committee.id, seq: 2, typeId: signType.id, status: "مسودة" }).returning();
    const r2 = await completeMeetingAction(m2.id);
    expect(r2?.error).toContain("موقعاً");
    const [blocked] = await db.select().from(meetings).where(eq(meetings.id, m2.id));
    expect(blocked.status).toBe("مسودة");
  });
});

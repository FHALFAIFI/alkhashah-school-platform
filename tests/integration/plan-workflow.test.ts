import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

// محاكاة سياق الطلب: صلاحيات الخطة كاملة، وبلا كوكيز حقيقية
vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["plan.read", "plan.write", "plan.approve", "plan.close_year"]),
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
  const [u] = await db.insert(users).values({ username: "t-plan", displayName: "اختبار الخطة", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

/** برنامج تجريبي بمعالم اختيارية — بيانات صناعية تنشأ وتنظف داخل الاختبار */
async function seedProgram(opts?: { status?: string; weights?: number[] }) {
  const { db } = await import("@/db");
  const { planYears, programs, programMilestones } = await import("@/db/schema");
  const suffix = Math.floor(Math.random() * 1e9);
  const [year] = await db.insert(planYears).values({ key: `pl-yr-${suffix}`, nameAr: `سنة خطة ${suffix}` }).returning();
  const [program] = await db
    .insert(programs)
    .values({
      planYearId: year.id,
      seq: 1,
      domain: "مجال تجريبي",
      name: `برنامج تجريبي ${suffix}`,
      specificGoal: "هدف خاص أصلي",
      status: opts?.status ?? "مسودة",
    })
    .returning();
  const milestones = [];
  for (const [i, weight] of (opts?.weights ?? []).entries()) {
    const [m] = await db
      .insert(programMilestones)
      .values({ programId: program.id, title: `معلم ${i + 1}`, weight, sortOrder: i })
      .returning();
    milestones.push(m);
  }
  return { year, program, milestones };
}

describe("سير عمل الخطة التشغيلية: اعتماد، إعادة فتح، طلبات تغيير، متابعة أسبوعية، إقفال السنة", () => {
  it("(أ) الاعتماد يرفض عندما لا يساوي مجموع الأوزان 100 وينجح عنده مع رفع النسخة", async () => {
    const { db } = await import("@/db");
    const { programs, programMilestones } = await import("@/db/schema");
    const { approveProgramAction } = await import("@/app/(app)/plan/actions");
    const { program, milestones } = await seedProgram({ weights: [60, 30] }); // المجموع 90

    const rejected = await approveProgramAction(program.id);
    expect(rejected?.error).toContain("100");
    const [still] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(still.status).toBe("مسودة");
    expect(still.version).toBe(1);

    await db.update(programMilestones).set({ weight: 40 }).where(eq(programMilestones.id, milestones[1].id));
    const accepted = await approveProgramAction(program.id);
    expect(accepted?.error).toBeUndefined();
    const [approved] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(approved.status).toBe("معتمد");
    expect(approved.version).toBe(2);
    expect(approved.approvedAt).not.toBeNull();

    // إعادة الاعتماد ترفض
    const twice = await approveProgramAction(program.id);
    expect(twice?.error).toContain("مسبقاً");
  });

  it("(ب) إعادة الفتح تتطلب سبباً وتعيد البرنامج إلى مسودة مع رفع النسخة", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { reopenProgramAction } = await import("@/app/(app)/plan/actions");
    const { program } = await seedProgram({ status: "معتمد" });

    const noReason = new FormData();
    noReason.set("reason", "قص"); // أقل من 5 أحرف
    const rejected = await reopenProgramAction(program.id, noReason);
    expect(rejected?.error).toContain("إلزامي");
    const [still] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(still.status).toBe("معتمد");

    const fd = new FormData();
    fd.set("reason", "تعديل المعالم بعد ملاحظات المدير");
    const accepted = await reopenProgramAction(program.id, fd);
    expect(accepted?.error).toBeUndefined();
    const [reopened] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(reopened.status).toBe("مسودة");
    expect(reopened.version).toBe(2);
  });

  it("(ج) طلب التغيير: إنشاء ثم منع التكرار ثم الاعتماد يطبق الحقل ويرفع النسخة", async () => {
    const { db } = await import("@/db");
    const { programs, programChangeRequests } = await import("@/db/schema");
    const { createChangeRequestAction, decideChangeRequestAction } = await import("@/app/(app)/plan/actions");
    const { program } = await seedProgram({ status: "معتمد" });

    const fd = new FormData();
    fd.set("field", "specificGoal");
    fd.set("fieldLabel", "الهدف الخاص");
    fd.set("newValue", "هدف خاص محدث");
    fd.set("reason", "تحديث الهدف بعد المراجعة");
    const created = await createChangeRequestAction(program.id, null, fd);
    expect(created?.error).toBeUndefined();

    // طلب ثانٍ لنفس الحقل وهو قيد الاعتماد — يرفض
    const dup = await createChangeRequestAction(program.id, null, fd);
    expect(dup?.error).toBe("يوجد طلب تعديل قائم لهذا الحقل");

    const [req] = await db
      .select()
      .from(programChangeRequests)
      .where(and(eq(programChangeRequests.programId, program.id), eq(programChangeRequests.field, "specificGoal")));
    expect(req.status).toBe("قيد الاعتماد");
    expect(req.oldValue).toBe("هدف خاص أصلي");

    const decided = await decideChangeRequestAction(req.id, "معتمد");
    expect(decided?.error).toBeUndefined();
    const [after] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(after.specificGoal).toBe("هدف خاص محدث");
    expect(after.version).toBe(2);
    const [decidedReq] = await db.select().from(programChangeRequests).where(eq(programChangeRequests.id, req.id));
    expect(decidedReq.status).toBe("معتمد");

    // بعد الحسم يقبل طلب جديد لنفس الحقل
    const again = await createChangeRequestAction(program.id, null, fd);
    expect(again?.error).toBeUndefined();
  });

  it("(د) المتابعة الأسبوعية تسجل lastReviewAt وحالة التنفيذ وتحدث سجل الأسبوع نفسه بلا تكرار", async () => {
    const { db } = await import("@/db");
    const { programs, programFollowups } = await import("@/db/schema");
    const { submitFollowupAction } = await import("@/app/(app)/plan/actions");
    const { isoWeekKey } = await import("@/lib/plan/followup");
    const { program } = await seedProgram({ status: "معتمد" });

    const fd1 = new FormData();
    fd1.set("note", "بدأ التنفيذ حسب الجدول");
    fd1.set("executionStatus", "في المسار");
    const first = await submitFollowupAction(program.id, null, fd1);
    expect(first?.error).toBeUndefined();

    const [afterFirst] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(afterFirst.lastReviewAt).not.toBeNull();
    expect(afterFirst.executionStatus).toBe("في المسار");

    // إعادة الإرسال في نفس الأسبوع تحدث السجل ولا تنشئ سجلاً ثانياً
    const fd2 = new FormData();
    fd2.set("note", "ظهر تعثر في التوريد");
    fd2.set("executionStatus", "متأخر");
    const second = await submitFollowupAction(program.id, null, fd2);
    expect(second?.error).toBeUndefined();

    const rows = await db.select().from(programFollowups).where(eq(programFollowups.programId, program.id));
    expect(rows.length).toBe(1);
    expect(rows[0].weekKey).toBe(isoWeekKey());
    expect(rows[0].note).toBe("ظهر تعثر في التوريد");
    expect(rows[0].executionStatus).toBe("متأخر");
    const [afterSecond] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(afterSecond.executionStatus).toBe("متأخر");

    // المتابعة للبرامج المعتمدة فقط
    const { program: draft } = await seedProgram();
    const blocked = await submitFollowupAction(draft.id, null, fd1);
    expect(blocked?.error).toContain("المعتمدة فقط");
  });

  it("(هـ) إقفال السنة يقفل البرامج المعتمدة ويترك المسودات", async () => {
    const { db } = await import("@/db");
    const { planYears, programs } = await import("@/db/schema");
    const { closePlanYearAction } = await import("@/app/(app)/plan/actions");
    const { year, program: approvedProgram } = await seedProgram({ status: "معتمد" });
    const [draftProgram] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: 2, domain: "مجال تجريبي", name: "برنامج مسودة", status: "مسودة" })
      .returning();

    const res = await closePlanYearAction(year.id);
    expect(res?.error).toBeUndefined();

    const [closedYear] = await db.select().from(planYears).where(eq(planYears.id, year.id));
    expect(closedYear.status).toBe("مقفلة");
    expect(closedYear.closedAt).not.toBeNull();
    const [locked] = await db.select().from(programs).where(eq(programs.id, approvedProgram.id));
    expect(locked.status).toBe("مقفل");
    const [stillDraft] = await db.select().from(programs).where(eq(programs.id, draftProgram.id));
    expect(stillDraft.status).toBe("مسودة");

    // الإقفال مرة ثانية يرفض
    const twice = await closePlanYearAction(year.id);
    expect(twice?.error).toContain("مقفلة");
  });
});

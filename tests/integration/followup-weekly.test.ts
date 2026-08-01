import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["plan.read", "plan.write", "plan.approve"]),
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
  const [u] = await db
    .insert(users)
    .values({ username: "t-followup", displayName: "اختبار المتابعة", passwordHash: "x" })
    .returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

// سنة نشطة واحدة مشتركة — محمل تقرير الأسبوع يقرأ السنة النشطة الأولى فقط
let sharedYearId = "";
let seqCounter = 1;
async function seedApprovedProgram(progress = 40) {
  const { db } = await import("@/db");
  const { planYears, programs } = await import("@/db/schema");
  const suffix = Math.floor(Math.random() * 1e9);
  if (!sharedYearId) {
    const [year] = await db
      .insert(planYears)
      .values({ key: `fu-yr-shared`, nameAr: `سنة المتابعة`, status: "نشطة" })
      .returning();
    sharedYearId = year.id;
  }
  const [program] = await db
    .insert(programs)
    .values({
      planYearId: sharedYearId,
      seq: seqCounter++,
      domain: "مجال",
      name: `برنامج متابعة ${suffix}`,
      status: "معتمد",
      progress,
      executionStatus: "في المسار",
    })
    .returning();
  return program;
}

describe("v2.4 §7: تصحيحات إجراء المتابعة الأسبوعية", () => {
  it("(أ) الحقل الفارغ للتقدم يبقي تقدم البرنامج كما هو — لا يصفره", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { submitFollowupAction } = await import("@/app/(app)/plan/actions");
    const program = await seedApprovedProgram(55);

    const fd = new FormData();
    fd.set("note", "متابعة بلا تعديل تقدم");
    fd.set("executionStatus", "في المسار");
    fd.set("progress", ""); // الحقل أُرسل فارغاً — النموذج يرسله دائماً
    const res = await submitFollowupAction(program.id, null, fd);
    expect(res?.success).toBeTruthy();

    const [after] = await db.select().from(programs).where(eq(programs.id, program.id));
    expect(after.progress).toBe(55);
  });

  it("(ب) تعديل سجل الأسبوع نفسه لا يعيد ضبط createdAt ويحدث اللقطة", async () => {
    const { db } = await import("@/db");
    const { programFollowups } = await import("@/db/schema");
    const { submitFollowupAction } = await import("@/app/(app)/plan/actions");
    const { isoWeekKey } = await import("@/lib/plan/followup");
    const program = await seedApprovedProgram(10);

    const fd1 = new FormData();
    fd1.set("note", "أولى");
    fd1.set("executionStatus", "في المسار");
    fd1.set("progress", "20");
    await submitFollowupAction(program.id, null, fd1);

    const [first] = await db
      .select()
      .from(programFollowups)
      .where(and(eq(programFollowups.programId, program.id), eq(programFollowups.weekKey, isoWeekKey())));
    expect(first.progressSnapshot).toBe(20);

    await new Promise((r) => setTimeout(r, 30));
    const fd2 = new FormData();
    fd2.set("note", "معدلة");
    fd2.set("executionStatus", "متأخر");
    fd2.set("progress", "35");
    await submitFollowupAction(program.id, null, fd2);

    const rows = await db
      .select()
      .from(programFollowups)
      .where(and(eq(programFollowups.programId, program.id), eq(programFollowups.weekKey, isoWeekKey())));
    expect(rows).toHaveLength(1); // سجل واحد للأسبوع — تحديث لا تكرار
    expect(rows[0].progressSnapshot).toBe(35);
    expect(rows[0].executionStatus).toBe("متأخر");
    expect(rows[0].note).toBe("معدلة");
    expect(rows[0].createdAt.getTime()).toBe(first.createdAt.getTime()); // لم يُعد ضبطه
  });

  it("(ج) تقرير حالة الأسبوع يُظهر البرنامج غير المحدث بوسم «لم يتم التحديث هذا الأسبوع» لا «مكتمل»", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { NO_WEEKLY_UPDATE_LABEL } = await import("@/lib/plan/followup");
    const program = await seedApprovedProgram(70);
    // حتى لو علقت حالة التنفيذ على «مكتمل» من دورة حياة سابقة دون توثيق الاكتمال
    await db.update(programs).set({ executionStatus: "مكتمل" }).where(eq(programs.id, program.id));

    const { rows } = await runReportForExport("plan-followups", {});
    const row = rows.find((r) => r.programName === program.name);
    expect(row).toBeTruthy();
    expect(row!.weekStatus).toBe(NO_WEEKLY_UPDATE_LABEL);
    expect(row!.lifecycle).toBe("قيد التنفيذ"); // لا اكتمال موثق — لا يُعرض مكتملاً
  });

  it("(د) البرنامج الموثق الاكتمال يظهر في التقرير بدورة حياة «مكتمل» مفصولة عن حالة الأسبوع", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const program = await seedApprovedProgram(100);
    await db.update(programs).set({ completedAt: new Date(), completedBy: testUserId }).where(eq(programs.id, program.id));

    const { rows } = await runReportForExport("plan-followups", {});
    const row = rows.find((r) => r.programName === program.name);
    expect(row).toBeTruthy();
    expect(row!.lifecycle).toBe("مكتمل");
  });
});

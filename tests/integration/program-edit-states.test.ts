import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4.1 §5.7 — تعديل البرنامج في كل حالات دورة الحياة.
 *
 * ست حالات: مسودة، بانتظار الاعتماد (= مسودة قبل الاعتماد)، معتمد، قيد التنفيذ، مكتمل،
 * مغلق. لكل حالة: التعديل يُقبل، والسبب إلزامي بعد الاعتماد، والقيم القديمة والجديدة
 * تُحفظ، و**الحالة والاعتماد لا يتغيّران**، والتعديل المتزامن القديم يُرفض.
 */

let pool: Pool;
let userId = "";
let yearId = "";
let seq = 0;

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: userId,
    username: "t",
    displayName: "المدير",
    personId: null,
    permissions: new Set(["plan.read", "plan.write", "plan.approve"]),
    roleKeys: new Set<string>(),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: userId, permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAll(pool);
  seq = 0;
  const { db } = await import("@/db");
  const { users, planYears } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-edit", displayName: "المدير", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "1448-1449", nameAr: "1448-1449" }).returning();
  yearId = y.id;
});

type State = "مسودة" | "بانتظار الاعتماد" | "معتمد" | "قيد التنفيذ" | "مكتمل" | "مغلق";

/** ينشئ برنامجاً في الحالة المطلوبة مباشرةً عبر القاعدة — لا يمر بإجراءات الحالة */
async function makeProgram(state: State) {
  const { db } = await import("@/db");
  const { programs } = await import("@/db/schema");
  seq += 1;
  const base = {
    planYearId: yearId,
    seq,
    domain: "التعليم",
    name: `برنامج ${state}`,
    generalGoal: "هدف أصلي",
    budget: "1000",
  };
  const patch: Record<string, unknown> =
    state === "مسودة" || state === "بانتظار الاعتماد"
      ? { status: "مسودة" }
      : state === "معتمد" || state === "قيد التنفيذ"
        ? { status: "معتمد", approvedBy: userId, approvedAt: new Date() }
        : state === "مكتمل"
          ? { status: "معتمد", approvedBy: userId, approvedAt: new Date(), completedAt: new Date(), completedBy: userId }
          : { status: "معتمد", approvedBy: userId, approvedAt: new Date(), completedAt: new Date(), closedAt: new Date(), closedBy: userId };
  const [p] = await db.insert(programs).values({ ...base, ...patch }).returning();
  return p;
}

function editForm(program: { updatedAt: Date }, fields: Record<string, string>, reason?: string) {
  const fd = new FormData();
  fd.set("updatedToken", program.updatedAt.toISOString());
  for (const [k, v] of Object.entries(fields)) fd.set(`field_${k}`, v);
  if (reason !== undefined) fd.set("reason", reason);
  return fd;
}

const ALL_STATES: State[] = ["مسودة", "بانتظار الاعتماد", "معتمد", "قيد التنفيذ", "مكتمل", "مغلق"];
const NEEDS_REASON: State[] = ["معتمد", "قيد التنفيذ", "مكتمل", "مغلق"];

describe("§5.7 — التعديل مسموح في كل حالة", () => {
  for (const state of ALL_STATES) {
    it(`الحالة «${state}»: التعديل يُقبل ولا يغيّر الحالة ولا الاعتماد`, async () => {
      const p = await makeProgram(state);
      const { updateProgramAction } = await import("@/app/(app)/plan/actions");
      const res = await updateProgramAction(
        p.id,
        null,
        editForm(p, { name: `${p.name} — معدّل` }, NEEDS_REASON.includes(state) ? "تصحيح اسم البرنامج" : ""),
      );
      expect(res?.error).toBeUndefined();
      expect(res?.success).toContain("حُفظ التعديل");

      const { db } = await import("@/db");
      const { programs } = await import("@/db/schema");
      const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
      expect(after.name).toBe(`${p.name} — معدّل`);
      // محاور الحالة والاعتماد ودورة الحياة لم تُمسّ
      expect(after.status).toBe(p.status);
      expect(after.approvedAt?.getTime() ?? null).toBe(p.approvedAt?.getTime() ?? null);
      expect(after.approvedBy).toBe(p.approvedBy);
      expect(after.completedAt?.getTime() ?? null).toBe(p.completedAt?.getTime() ?? null);
      expect(after.closedAt?.getTime() ?? null).toBe(p.closedAt?.getTime() ?? null);
      expect(after.archivedAt).toBeNull();
    });
  }
});

describe("§5.7 — السبب الإلزامي بعد الاعتماد", () => {
  for (const state of NEEDS_REASON) {
    it(`الحالة «${state}»: التعديل بلا سبب يُرفض`, async () => {
      const p = await makeProgram(state);
      const { updateProgramAction } = await import("@/app/(app)/plan/actions");
      const res = await updateProgramAction(p.id, null, editForm(p, { name: "محاولة بلا سبب" }, ""));
      expect(res?.error).toContain("سبب التعديل");

      const { db } = await import("@/db");
      const { programs } = await import("@/db/schema");
      const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
      expect(after.name).toBe(p.name);
    });
  }

  for (const state of ["مسودة", "بانتظار الاعتماد"] as State[]) {
    it(`الحالة «${state}»: التعديل بلا سبب مقبول — السلوك الطبيعي محفوظ`, async () => {
      const p = await makeProgram(state);
      const { updateProgramAction } = await import("@/app/(app)/plan/actions");
      const res = await updateProgramAction(p.id, null, editForm(p, { name: "مسودة معدّلة" }));
      expect(res?.error).toBeUndefined();
    });
  }
});

describe("§5.7 — سجل التغييرات يحفظ القيم القديمة والجديدة", () => {
  it("يسجّل الفاعل والحالة والقيمتين والسبب لكل حقل", async () => {
    const p = await makeProgram("مكتمل");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    await updateProgramAction(
      p.id,
      null,
      editForm(p, { name: "الاسم الجديد", generalGoal: "هدف جديد" }, "تصحيح بعد مراجعة الوثيقة الرسمية"),
    );

    const { db } = await import("@/db");
    const { programEditHistory } = await import("@/db/schema");
    const rows = await db.select().from(programEditHistory).where(eq(programEditHistory.programId, p.id));
    expect(rows).toHaveLength(2);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(byField.name.oldValue).toBe(p.name);
    expect(byField.name.newValue).toBe("الاسم الجديد");
    expect(byField.name.fieldLabel).toBe("اسم البرنامج");
    expect(byField.name.approvalStatusAtEdit).toBe("معتمد");
    expect(byField.name.lifecycleAtEdit).toBe("مكتمل");
    expect(byField.name.reason).toBe("تصحيح بعد مراجعة الوثيقة الرسمية");
    expect(byField.name.actorId).toBe(userId);
    expect(byField.generalGoal.oldValue).toBe("هدف أصلي");
  });

  it("علامة «تم تعديل البرنامج بعد الاعتماد» مشتقة من السجل لا من عمود حالة", async () => {
    const draft = await makeProgram("مسودة");
    const approved = await makeProgram("معتمد");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    await updateProgramAction(draft.id, null, editForm(draft, { name: "مسودة معدّلة" }));
    await updateProgramAction(approved.id, null, editForm(approved, { name: "معتمد معدّل" }, "سبب التعديل"));

    const { db } = await import("@/db");
    const { programEditHistory } = await import("@/db/schema");
    const { PROGRAM_LIFECYCLE } = await import("@/lib/plan/lifecycle");
    const marks = async (id: string) => {
      const rows = await db.select().from(programEditHistory).where(eq(programEditHistory.programId, id));
      return rows.some((h) => h.approvalStatusAtEdit !== "مسودة" || h.lifecycleAtEdit !== PROGRAM_LIFECYCLE.active);
    };
    expect(await marks(draft.id)).toBe(false);
    expect(await marks(approved.id)).toBe(true);
  });

  it("لا يُسجَّل شيء حين لا تغيير فعلي", async () => {
    const p = await makeProgram("معتمد");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    const res = await updateProgramAction(p.id, null, editForm(p, { name: p.name }, "سبب"));
    expect(res?.success).toBe("لا تغييرات لحفظها");

    const { db } = await import("@/db");
    const { programEditHistory } = await import("@/db/schema");
    expect(await db.select().from(programEditHistory).where(eq(programEditHistory.programId, p.id))).toHaveLength(0);
  });
});

describe("§5.7 — حماية التعديل المتزامن والمدخلات", () => {
  it("رمز حداثة قديم يُرفض بعد تعديل ناجح — لا كتابة فوق تعديل الآخر", async () => {
    const p = await makeProgram("معتمد");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    const stale = editForm(p, { name: "تعديل ثانٍ من نموذج قديم" }, "سبب");

    const first = await updateProgramAction(p.id, null, editForm(p, { name: "تعديل أول" }, "سبب"));
    expect(first?.error).toBeUndefined();

    const second = await updateProgramAction(p.id, null, stale);
    expect(second?.error).toContain("عُدّل البرنامج من مكان آخر");

    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.name).toBe("تعديل أول");
  });

  it("رمز الحداثة الغائب يُرفض", async () => {
    const p = await makeProgram("مسودة");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    const fd = new FormData();
    fd.set("field_name", "بلا رمز");
    expect((await updateProgramAction(p.id, null, fd))?.error).toContain("أعد تحميل الصفحة");
  });

  it("الميزانية غير الرقمية والسالبة تُرفضان", async () => {
    const p = await makeProgram("مسودة");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    expect((await updateProgramAction(p.id, null, editForm(p, { budget: "غير رقم" })))?.error).toContain("رقماً");
    expect((await updateProgramAction(p.id, null, editForm(p, { budget: "-5" })))?.error).toContain("رقماً");
  });

  it("حقول الحالة والاعتماد لا تُقبل ولو أُرسلت صراحةً — حارس الإسناد الجماعي", async () => {
    const p = await makeProgram("مسودة");
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    const fd = editForm(p, { name: "اسم" });
    fd.set("field_status", "معتمد");
    fd.set("field_approvedAt", new Date().toISOString());
    fd.set("field_closedAt", new Date().toISOString());
    fd.set("status", "معتمد");
    await updateProgramAction(p.id, null, fd);

    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.status).toBe("مسودة");
    expect(after.approvedAt).toBeNull();
    expect(after.closedAt).toBeNull();
  });

  it("معرّف غير صالح أو غير موجود يعيد رسالة عربية لا استثناءً", async () => {
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    const fd = new FormData();
    fd.set("updatedToken", new Date().toISOString());
    fd.set("field_name", "x");
    expect((await updateProgramAction("not-a-uuid", null, fd))?.error).toBe("البرنامج غير موجود");
    expect((await updateProgramAction("00000000-0000-4000-8000-000000000000", null, fd))?.error).toBe("البرنامج غير موجود");
  });
});

describe("§5.7 — تحديث التنفيذ في الحالات المستقرة", () => {
  it("البرنامج المغلق يقبل تحديث التنفيذ بسبب مكتوب ويُسجَّل في سجل التغييرات", async () => {
    const p = await makeProgram("مغلق");
    const { updateProgramExecutionAction } = await import("@/app/(app)/plan/actions");
    const fd = new FormData();
    fd.set("progress", "80");
    fd.set("executionStatus", "في المسار");
    fd.set("reason", "تصحيح نسبة بعد مراجعة الشواهد");
    const res = await updateProgramExecutionAction(p.id, null, fd);
    expect(res?.error).toBeUndefined();

    const { db } = await import("@/db");
    const { programs, programEditHistory } = await import("@/db/schema");
    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.progress).toBe(80);
    // الإقفال لم يُرفع ضمنياً
    expect(after.closedAt).not.toBeNull();
    const rows = await db.select().from(programEditHistory).where(eq(programEditHistory.programId, p.id));
    expect(rows.map((r) => r.field).sort()).toEqual(["executionStatus", "progress"]);
    expect(rows[0].lifecycleAtEdit).toBe("مغلق");
  });

  it("البرنامج المغلق يرفض تحديث التنفيذ بلا سبب", async () => {
    const p = await makeProgram("مغلق");
    const { updateProgramExecutionAction } = await import("@/app/(app)/plan/actions");
    const fd = new FormData();
    fd.set("progress", "80");
    fd.set("executionStatus", "في المسار");
    expect((await updateProgramExecutionAction(p.id, null, fd))?.error).toContain("سبب");
  });

  it("البرنامج المعتمد قيد التنفيذ يحدّث تقدمه بلا سبب — السلوك الأسبوعي محفوظ", async () => {
    const p = await makeProgram("قيد التنفيذ");
    const { updateProgramExecutionAction } = await import("@/app/(app)/plan/actions");
    const fd = new FormData();
    fd.set("progress", "40");
    fd.set("executionStatus", "في المسار");
    expect((await updateProgramExecutionAction(p.id, null, fd))?.error).toBeUndefined();
  });
});

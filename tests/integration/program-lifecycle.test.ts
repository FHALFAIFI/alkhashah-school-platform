import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Scope v2.2 §A — program creation (A1) and final closure / reopen (A2).
 *
 * Closure is a business state entirely separate from archiving (soft delete) and from
 * approval; these tests pin that separation, the "everything optional" rule, idempotency,
 * and the append-only closure history.
 */

let pool: Pool;
let testUserId = "";

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
  const [u] = await db.insert(users).values({ username: "t-lifecycle", displayName: "اختبار دورة البرنامج", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

/** سنة تخطيطية نشطة نظيفة لكل حالة اختبار */
async function seedActiveYear() {
  const { db } = await import("@/db");
  const { planYears, programs, programClosureHistory, evidenceItems, evidenceLinks } = await import("@/db/schema");
  // تنظيف بترتيب التبعية (المفاتيح الأجنبية) — سنة واحدة نشطة فقط في كل حالة اختبار،
  // فالإجراء يختار «نشطة» أو أول سنة بلا التباس بين الحالات.
  await db.delete(programClosureHistory);
  await db.delete(evidenceLinks);
  await db.delete(evidenceItems);
  await db.delete(programs);
  await db.delete(planYears);
  const suffix = Math.floor(Math.random() * 1e9);
  const [year] = await db
    .insert(planYears)
    .values({ key: `v22-${suffix}`, nameAr: `سنة ${suffix}`, status: "نشطة" })
    .returning();
  return year;
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

describe("A1 — إضافة برنامج", () => {
  it("يحفظ برنامجاً فارغاً تماماً (كل الحقول اختيارية) ويعرضه باسم «بدون عنوان»", async () => {
    await seedActiveYear();
    const { createProgramAction } = await import("@/app/(app)/plan/actions");
    const { orFallback } = await import("@/lib/format");
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");

    const res = await createProgramAction(null, fd({}));
    expect(res?.error).toBeUndefined();
    expect(res?.success).toBeTruthy();

    const rows = await db.select().from(programs);
    expect(rows).toHaveLength(1);
    // لا قيمة مُختلقة: الاسم مخزَّن فارغاً والعرض يتكفّل بالبديل العربي
    expect(rows[0].name).toBe("");
    expect(orFallback(rows[0].name)).toBe("بدون عنوان");
    expect(rows[0].status).toBe("مسودة");
    expect(rows[0].seq).toBe(1);
    expect(rows[0].createdBy).toBe(testUserId);
  });

  it("لا يُنشئ أنشطة ولا معالم تلقائياً (D-024)", async () => {
    await seedActiveYear();
    const { createProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programActivities, programMilestones } = await import("@/db/schema");

    await createProgramAction(null, fd({ name: "برنامج بلا أنشطة" }));
    expect(await db.select().from(programActivities)).toHaveLength(0);
    expect(await db.select().from(programMilestones)).toHaveLength(0);
  });

  it("يمنع الإنشاء المكرر من نقر متتابع بالقيم نفسها", async () => {
    await seedActiveYear();
    const { createProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");

    await createProgramAction(null, fd({ name: "برنامج مكرر" }));
    const second = await createProgramAction(null, fd({ name: "برنامج مكرر" }));
    expect(second?.success).toBeTruthy();

    const rows = await db.select().from(programs);
    expect(rows).toHaveLength(1);
  });

  it("يمنح رقماً تسلسلياً متتالياً ولا يصطدم بقيد الفريد", async () => {
    await seedActiveYear();
    const { createProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");

    await createProgramAction(null, fd({ name: "الأول" }));
    await createProgramAction(null, fd({ name: "الثاني" }));
    await createProgramAction(null, fd({ name: "الثالث" }));

    const rows = await db.select().from(programs).orderBy(programs.seq);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("يرفض القيم المخالفة للصيغة (طول الاسم) مع بقاء الحقل اختيارياً", async () => {
    await seedActiveYear();
    const { createProgramAction } = await import("@/app/(app)/plan/actions");
    const res = await createProgramAction(null, fd({ name: "ن".repeat(301) }));
    expect(res?.error).toBeTruthy();
  });
});

describe("A2 — إقفال البرنامج وإعادة فتحه", () => {
  async function seedProgram() {
    const year = await seedActiveYear();
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [p] = await db
      .insert(programs)
      .values({ planYearId: year.id, seq: 1, domain: "مجال", name: "برنامج للإقفال", status: "معتمد" })
      .returning();
    return p;
  }

  it("يُقفل برنامجاً بلا شواهد ولا أنشطة ولا ملاحظة — لا شرط على الإطلاق", async () => {
    const p = await seedProgram();
    const { closeProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programs, programClosureHistory } = await import("@/db/schema");

    const res = await closeProgramAction(p.id, null, fd({}));
    expect(res?.error).toBeUndefined();

    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.closedAt).toBeTruthy();
    expect(after.closedBy).toBe(testUserId);
    expect(after.closureNote).toBeNull();

    const history = await db.select().from(programClosureHistory).where(eq(programClosureHistory.programId, p.id));
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("إقفال");
  });

  it("الإقفال لا يمس الأرشفة ولا حالة الاعتماد — حالات عمل منفصلة", async () => {
    const p = await seedProgram();
    const { closeProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");

    await closeProgramAction(p.id, null, fd({}));
    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.archivedAt).toBeNull();
    expect(after.status).toBe("معتمد");
  });

  it("الإقفال المتكرر لا يضيف تاريخاً ولا يكتب فوق تاريخ الإقفال الأصلي (idempotent)", async () => {
    const p = await seedProgram();
    const { closeProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programs, programClosureHistory } = await import("@/db/schema");

    await closeProgramAction(p.id, null, fd({ note: "الأولى" }));
    const [firstState] = await db.select().from(programs).where(eq(programs.id, p.id));

    await closeProgramAction(p.id, null, fd({ note: "الثانية" }));
    await closeProgramAction(p.id, null, fd({ note: "الثالثة" }));

    const [finalState] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(finalState.closedAt?.getTime()).toBe(firstState.closedAt?.getTime());
    expect(finalState.closureNote).toBe("الأولى");

    const history = await db.select().from(programClosureHistory).where(eq(programClosureHistory.programId, p.id));
    expect(history).toHaveLength(1);
  });

  it("طلبا إقفال متزامنان يسجّلان إقفالاً واحداً فقط", async () => {
    const p = await seedProgram();
    const { closeProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programClosureHistory } = await import("@/db/schema");

    await Promise.all([
      closeProgramAction(p.id, null, fd({})),
      closeProgramAction(p.id, null, fd({})),
    ]);

    const history = await db.select().from(programClosureHistory).where(eq(programClosureHistory.programId, p.id));
    expect(history).toHaveLength(1);
  });

  it("إعادة الفتح تُرجع البرنامج وتحفظ تاريخ الإقفال السابق كاملاً", async () => {
    const p = await seedProgram();
    const { closeProgramAction, reopenClosedProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programs, programClosureHistory } = await import("@/db/schema");

    await closeProgramAction(p.id, null, fd({ note: "انتهى التنفيذ" }));
    await reopenClosedProgramAction(p.id, null, fd({ note: "استكمال متطلب" }));

    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.closedAt).toBeNull();
    expect(after.reopenedAt).toBeTruthy();
    expect(after.reopenedBy).toBe(testUserId);

    // السجل التاريخي يُضاف إليه فقط — صف الإقفال بملاحظته لم يُمسح ولم يُكتب فوقه
    const history = await db
      .select()
      .from(programClosureHistory)
      .where(eq(programClosureHistory.programId, p.id))
      .orderBy(programClosureHistory.at);
    expect(history.map((h) => h.action)).toEqual(["إقفال", "إعادة فتح"]);
    expect(history[0].note).toBe("انتهى التنفيذ");
  });

  it("دورات إقفال/فتح متكررة تُراكم التاريخ ولا تفقد أي سجل", async () => {
    const p = await seedProgram();
    const { closeProgramAction, reopenClosedProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programClosureHistory } = await import("@/db/schema");

    await closeProgramAction(p.id, null, fd({}));
    await reopenClosedProgramAction(p.id, null, fd({}));
    await closeProgramAction(p.id, null, fd({}));
    await reopenClosedProgramAction(p.id, null, fd({}));

    const history = await db.select().from(programClosureHistory).where(eq(programClosureHistory.programId, p.id));
    expect(history).toHaveLength(4);
  });

  it("إعادة فتح برنامج مفتوح لا تفعل شيئاً (idempotent)", async () => {
    const p = await seedProgram();
    const { reopenClosedProgramAction } = await import("@/app/(app)/plan/actions");
    const { db } = await import("@/db");
    const { programClosureHistory } = await import("@/db/schema");

    const res = await reopenClosedProgramAction(p.id, null, fd({}));
    expect(res?.success).toBeTruthy();
    const history = await db.select().from(programClosureHistory).where(eq(programClosureHistory.programId, p.id));
    expect(history).toHaveLength(0);
  });

  it("الإقفال يحفظ الشواهد والوثائق والمراجع المالية المرتبطة", async () => {
    const p = await seedProgram();
    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks, programs } = await import("@/db/schema");

    const [ev] = await db
      .insert(evidenceItems)
      .values({ title: "شاهد البرنامج", kind: "text", textContent: "محتوى الشاهد" })
      .returning();
    await db.insert(evidenceLinks).values({ evidenceId: ev.id, entityType: "program", entityId: p.id });

    const { closeProgramAction } = await import("@/app/(app)/plan/actions");
    await closeProgramAction(p.id, null, fd({}));

    // لا شيء يُحذف عند الإقفال: الشاهد ورابطه وسجل البرنامج كما هي
    expect(await db.select().from(evidenceItems).where(eq(evidenceItems.id, ev.id))).toHaveLength(1);
    expect(await db.select().from(evidenceLinks).where(eq(evidenceLinks.entityId, p.id))).toHaveLength(1);
    const [prog] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(prog.name).toBe("برنامج للإقفال");
  });
});

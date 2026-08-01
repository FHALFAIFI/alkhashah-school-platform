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

// مستخدم الطابور — نفس شكل CurrentUser الذي تتحقق منه الدالة
const queueUser = () =>
  ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["plan.read", "plan.approve"]),
    roleKeys: new Set<string>(),
    csrfToken: "x",
    sessionId: "x",
  }) as never;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db
    .insert(users)
    .values({ username: "t-queue", displayName: "اختبار الطابور", passwordHash: "x" })
    .returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

let yearId = "";
let seq = 1;
async function seedProgram(opts: {
  status?: string;
  completedAt?: Date | null;
  closedAt?: Date | null;
  archivedAt?: Date | null;
}) {
  const { db } = await import("@/db");
  const { planYears, programs } = await import("@/db/schema");
  if (!yearId) {
    const [y] = await db.insert(planYears).values({ key: "q-yr", nameAr: "سنة الطابور", status: "نشطة" }).returning();
    yearId = y.id;
  }
  const suffix = Math.floor(Math.random() * 1e9);
  const [p] = await db
    .insert(programs)
    .values({
      planYearId: yearId,
      seq: seq++,
      domain: "مجال",
      name: `برنامج طابور ${suffix}`,
      status: opts.status ?? "مسودة",
      completedAt: opts.completedAt ?? null,
      closedAt: opts.closedAt ?? null,
      archivedAt: opts.archivedAt ?? null,
    })
    .returning();
  return p;
}

describe("v2.4 §11: طابور «بانتظار اعتماد المدير» من حالات سير العمل الحقيقية", () => {
  it("(أ) المسودة تظهر في قائمة الجديد، والمكتمل الموثق في قائمة الإقفال، والمغلق والمؤرشف لا يظهران", async () => {
    const { getPlanApprovalQueue } = await import("@/lib/worklist");
    const draft = await seedProgram({ status: "مسودة" });
    const completed = await seedProgram({ status: "معتمد", completedAt: new Date() });
    const closed = await seedProgram({ status: "معتمد", completedAt: new Date(), closedAt: new Date() });
    const archived = await seedProgram({ status: "مسودة", archivedAt: new Date() });

    const queue = await getPlanApprovalQueue(queueUser());
    expect(queue).not.toBeNull();
    const draftIds = queue!.drafts.map((p) => p.id);
    const completedIds = queue!.completed.map((p) => p.id);
    expect(draftIds).toContain(draft.id);
    expect(draftIds).not.toContain(archived.id);
    expect(completedIds).toContain(completed.id);
    expect(completedIds).not.toContain(closed.id);
    expect(draftIds).not.toContain(closed.id);
  });

  it("(ب) اعتماد المسودة يخرجها من قائمة الجديد فوراً", async () => {
    const { getPlanApprovalQueue } = await import("@/lib/worklist");
    const { approveProgramAction } = await import("@/app/(app)/plan/actions");
    const draft = await seedProgram({ status: "مسودة" });

    const before = await getPlanApprovalQueue(queueUser());
    expect(before!.drafts.map((p) => p.id)).toContain(draft.id);

    const res = await approveProgramAction(draft.id);
    expect(res?.success).toBeTruthy();

    const after = await getPlanApprovalQueue(queueUser());
    expect(after!.drafts.map((p) => p.id)).not.toContain(draft.id);
  });

  it("(ج) بلا صلاحية plan.approve لا طابور إطلاقاً", async () => {
    const { getPlanApprovalQueue } = await import("@/lib/worklist");
    const noApprove = {
      id: testUserId,
      username: "t",
      displayName: "اختبار",
      personId: null,
      permissions: new Set(["plan.read"]),
      roleKeys: new Set<string>(),
      csrfToken: "x",
      sessionId: "x",
    } as never;
    expect(await getPlanApprovalQueue(noApprove)).toBeNull();
  });

  it("(د) طلب التعديل قيد الاعتماد يظهر في قائمته", async () => {
    const { db } = await import("@/db");
    const { programChangeRequests } = await import("@/db/schema");
    const { getPlanApprovalQueue } = await import("@/lib/worklist");
    const program = await seedProgram({ status: "معتمد" });
    await db.insert(programChangeRequests).values({
      programId: program.id,
      field: "name",
      fieldLabel: "اسم البرنامج",
      newValue: "اسم معدل",
      reason: "تصحيح اسم البرنامج",
      status: "قيد الاعتماد",
    });

    const queue = await getPlanApprovalQueue(queueUser());
    expect(queue!.changeRequests.some((cr) => cr.programId === program.id)).toBe(true);
  });

  it("(هـ) مركز العمل يضم مسودات البرامج ضمن «بانتظار الاعتماد»", async () => {
    const { getWorkCenter } = await import("@/lib/worklist");
    const draft = await seedProgram({ status: "مسودة" });
    const work = await getWorkCenter(queueUser());
    expect(work.awaitingApproval.some((i) => i.href === `/plan/${draft.id}`)).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["committees.write", "committees.approve"]),
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
  const [u] = await db.insert(users).values({ username: "actor", passwordHash: "x", displayName: "فاعل" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

let seedN = 0;
async function seedApprovedCommittee() {
  const { db } = await import("@/db");
  const { planYears, committees, committeeMembers, people } = await import("@/db/schema");
  seedN++;
  const [year] = await db.insert(planYears).values({ key: `cm-yr-${seedN}`, nameAr: "سنة" }).returning();
  const [chair] = await db.insert(people).values({ fullName: "الرئيس", category: "معلم" }).returning();
  const [sec] = await db.insert(people).values({ fullName: "المقرر", category: "معلم" }).returning();
  const [cmt] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: `لجنة الاختبار ${seedN}`, kind: "لجنة", status: "معتمدة" })
    .returning();
  const [m1] = await db
    .insert(committeeMembers)
    .values({ committeeId: cmt.id, personId: chair.id, role: "رئيس", effectiveFrom: "2026-08-01" })
    .returning();
  await db.insert(committeeMembers).values({ committeeId: cmt.id, personId: sec.id, role: "مقرر", effectiveFrom: "2026-08-01" });
  return { cmt, chair, sec, chairMember: m1 };
}

describe("عضوية اللجان المؤرّخة (§5)", () => {
  it("إنهاء عضوية معتمدة يؤرّخها ولا يحذف الصف — لا يُعاد كتابة التاريخ", async () => {
    const { db } = await import("@/db");
    const { committeeMembers } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { removeMemberAction } = await import("@/app/(app)/committees/actions");

    const { cmt, chairMember } = await seedApprovedCommittee();

    const fd = new FormData();
    fd.set("effectiveTo", "2027-01-15");
    fd.set("reason", "انتقل إلى مدرسة أخرى");
    const res = await removeMemberAction(chairMember.id, fd);
    expect(res?.success).toBeTruthy();

    // الصف باقٍ مع تاريخ الإنهاء — لم يُحذف
    const rows = await db.select().from(committeeMembers).where(eq(committeeMembers.committeeId, cmt.id));
    expect(rows.length).toBe(2);
    const ended = rows.find((r) => r.id === chairMember.id)!;
    expect(ended.effectiveTo).toBe("2027-01-15");
    expect(ended.endReason).toBe("انتقل إلى مدرسة أخرى");
    expect(ended.effectiveFrom).toBe("2026-08-01");
  });

  it("بعد إنهاء الرئيس يمكن تكليف رئيس جديد — العضوية المنتهية لا تمنع الدور", async () => {
    const { db } = await import("@/db");
    const { committees, people } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { addMemberAction } = await import("@/app/(app)/committees/actions");

    const [cmt] = await db.select().from(committees).orderBy(committees.createdAt).limit(1);
    const [newChair] = await db.insert(people).values({ fullName: "رئيس جديد", category: "معلم" }).returning();

    const fd = new FormData();
    fd.set("personId", newChair.id);
    fd.set("role", "رئيس");
    const res = await addMemberAction(cmt.id, null, fd);
    expect(res?.success).toBeTruthy();
    expect(res?.error).toBeUndefined();
  });

  it("توليد نموذج التكليف يُصدر وثيقة ويربطها باللجنة", async () => {
    const { db } = await import("@/db");
    const { committees, documents } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { generateAssignmentForm } = await import("@/lib/reports/assignment-form");
    const { users } = await import("@/db/schema");

    const { cmt } = await seedApprovedCommittee();
    const [u] = await db.insert(users).values({ username: "issuer2", passwordHash: "x", displayName: "مُصدِر" }).returning();
    const result = await generateAssignmentForm({ committeeId: cmt.id, issuedBy: u.id });

    const [doc] = await db.select().from(documents).where(eq(documents.id, result.docId));
    expect(doc.docType).toBe("committee_assignment");
    expect(doc.entityType).toBe("committee");
    expect(doc.entityId).toBe(cmt.id);
    // اللقطة تلتقط أسماء الأعضاء الفاعلين وترويسة الهوية
    expect(doc.htmlSnapshot).toContain("الرئيس");
    expect(doc.htmlSnapshot).toContain("المقرر");
    expect(doc.htmlSnapshot).toContain("مجمع الخشعة التعليمي للبنين");
  }, 30000);
});

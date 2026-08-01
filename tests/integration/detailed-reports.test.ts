import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4 §12-§13 — السجلات والتقارير التفصيلية:
 * سجل المجالس واللجان التفصيلي (كل عضو صف مستقل بمهامه وحالتها)، تقرير الأداء التفصيلي
 * للموظف (الأوزان والدرجات الموزونة والملاحظات)، تقرير المدرسة التفصيلي، وحالة مهام اللجان.
 */

let pool: Pool;
let userId = "";
let committeeId = "";
let memberId = "";
let taskId = "";
let personId = "";
let cycleId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: userId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["committees.read", "committees.write", "reports.generate", "performance.individual.read"]),
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
  await truncateAll(pool);
  const { db } = await import("@/db");
  const {
    users, planYears, committees, committeeMembers, committeeTaskAssignments, people,
    perfModels, perfIndicators, perfCycles, perfSessions, perfRatings,
  } = await import("@/db/schema");

  const [u] = await db.insert(users).values({ username: "t-detailed", displayName: "مصدر السجلات", passwordHash: "x" }).returning();
  userId = u.id;
  const [year] = await db.insert(planYears).values({ key: "det-1448", nameAr: "سنة السجل", status: "نشطة" }).returning();

  const [p1] = await db.insert(people).values({ fullName: "عضو اللجنة الأول", category: "معلم", active: true }).returning();
  const [p2] = await db.insert(people).values({ fullName: "عضو اللجنة الثاني", category: "موظف", active: true }).returning();
  personId = p1.id;

  const [c] = await db
    .insert(committees)
    .values({ planYearId: year.id, nameAr: "لجنة التميز التجريبية", kind: "لجنة", status: "معتمدة" })
    .returning();
  committeeId = c.id;
  const [m1] = await db
    .insert(committeeMembers)
    .values({ committeeId: c.id, personId: p1.id, role: "رئيس", position: "معلم رياضيات", sortOrder: 0 })
    .returning();
  memberId = m1.id;
  await db.insert(committeeMembers).values({ committeeId: c.id, personId: p2.id, role: "مقرر", position: "إداري", sortOrder: 1 });
  const [t] = await db
    .insert(committeeTaskAssignments)
    .values({ committeeId: c.id, title: "إعداد خطة اللجنة", assignedMemberId: m1.id, status: "قيد التنفيذ", sortOrder: 0 })
    .returning();
  taskId = t.id;

  // دورة أداء بلقطة نموذج مجمدة + جلسة نهائية بتقديرات وملاحظة
  const [model] = await db
    .insert(perfModels)
    .values({ key: "det-model", nameAr: "نموذج التقييم التجريبي", audience: "معلم", status: "معتمد" })
    .returning();
  const [ind1] = await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "إتقان التدريس", weight: "60" }).returning();
  const [ind2] = await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "الالتزام الوظيفي", weight: "40" }).returning();
  const [cycle] = await db
    .insert(perfCycles)
    .values({
      personId: p1.id,
      cycleType: "معلم",
      yearKey: "1448",
      modelId: model.id,
      modelSnapshot: {
        model: { id: model.id, key: model.key, nameAr: model.nameAr },
        indicators: [
          { id: ind1.id, nameAr: ind1.nameAr, weight: "60" },
          { id: ind2.id, nameAr: ind2.nameAr, weight: "40" },
        ],
      },
      status: "مكتملة",
    })
    .returning();
  cycleId = cycle.id;
  const [session] = await db
    .insert(perfSessions)
    .values({
      cycleId: cycle.id,
      sessionType: "نهائي",
      sessionDate: "2026-05-01",
      status: "مكتملة",
      strengths: "تمكن علمي واضح",
      recommendations: "التوسع في التعلم النشط",
      lockedAt: new Date(),
      lockedBy: userId,
    })
    .returning();
  await db.insert(perfRatings).values({ sessionId: session.id, indicatorId: ind1.id, rating: 4, note: "أداء مرتفع" });
  await db.insert(perfRatings).values({ sessionId: session.id, indicatorId: ind2.id, rating: 5 });
});

afterAll(async () => {
  await pool.end();
});

describe("حالة مهام اللجان (v2.4 §12)", () => {
  it("تحديد الحالة وإلغاؤها ورفض القيم غير المعروفة", async () => {
    const { db } = await import("@/db");
    const { committeeTaskAssignments } = await import("@/db/schema");
    const { setCommitteeTaskStatusAction } = await import("@/app/(app)/committees/task-actions");

    const bad = await setCommitteeTaskStatusAction(taskId, "منتهية تماماً");
    expect(bad?.error).toBeTruthy();

    const ok = await setCommitteeTaskStatusAction(taskId, "منجزة");
    expect(ok?.error).toBeUndefined();
    let [row] = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, taskId));
    expect(row.status).toBe("منجزة");

    await setCommitteeTaskStatusAction(taskId, "");
    [row] = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, taskId));
    expect(row.status).toBeNull();
    // إعادة الحالة لبقية الاختبارات
    await setCommitteeTaskStatusAction(taskId, "قيد التنفيذ");
  });
});

describe("تقارير مركز التقارير (v2.4 §12)", () => {
  it("سجل الأعضاء: صف مستقل لكل عضو بمهامه وحالتها — لا دمج", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { rows } = await runReportForExport("committee-members", {});
    const first = rows.find((r) => r.personName === "عضو اللجنة الأول");
    const second = rows.find((r) => r.personName === "عضو اللجنة الثاني");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first!.tasks).toContain("إعداد خطة اللجنة");
    expect(first!.taskStatuses).toContain("قيد التنفيذ");
    expect(second!.tasks).toBe("—");
    expect(first!.role).toBe("رئيس");
  });

  it("عضويات المنسوبين: صف لكل عضوية لا خلية مدموجة", async () => {
    const { runReportForExport } = await import("@/lib/reports/loaders");
    const { rows } = await runReportForExport("employee-committees", {});
    const mine = rows.filter((r) => r.fullName === "عضو اللجنة الأول");
    expect(mine).toHaveLength(1);
    expect(mine[0].committeeName).toBe("لجنة التميز التجريبية");
    expect(mine[0].role).toBe("رئيس");
  });
});

describe("سجل المجالس واللجان التفصيلي (v2.4 §12)", () => {
  it("يُصدر وثيقة مرقمة يظهر فيها كل عضو باسمه ودوره ومهامه وحالتها", async () => {
    const { generateCommitteeRegistry } = await import("@/lib/reports/committee-report");
    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");

    const res = await generateCommitteeRegistry({ issuedBy: userId });
    expect(res.docNumber).toBeTruthy();
    const [doc] = await db.select().from(documents).where(eq(documents.id, res.docId));
    expect(doc.docType).toBe("committee_registry");
    expect(doc.htmlSnapshot).toContain("عضو اللجنة الأول");
    expect(doc.htmlSnapshot).toContain("عضو اللجنة الثاني");
    expect(doc.htmlSnapshot).toContain("إعداد خطة اللجنة");
    expect(doc.htmlSnapshot).toContain("قيد التنفيذ");
    expect(doc.htmlSnapshot).toContain("لجنة التميز التجريبية");
    expect(doc.pdfFileId).toBeTruthy();
  }, 60_000);
});

describe("تقارير الأداء الوظيفي التفصيلية (v2.4 §13)", () => {
  it("تقرير الموظف: المعايير بالوزن والتقدير والدرجة الموزونة والملاحظة والاعتماد", async () => {
    const { generateEmployeePerformanceReport } = await import("@/lib/reports/performance-reports");
    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");

    const res = await generateEmployeePerformanceReport({ personId, cycleId, issuedBy: userId });
    const [doc] = await db.select().from(documents).where(eq(documents.id, res.docId));
    expect(doc.docType).toBe("employee_performance_report");
    expect(doc.htmlSnapshot).toContain("إتقان التدريس");
    // الدرجة الموزونة: (4/5)×60 = 48 و(5/5)×40 = 40، والنتيجة 88٪
    expect(doc.htmlSnapshot).toContain("48");
    expect(doc.htmlSnapshot).toContain("88٪");
    expect(doc.htmlSnapshot).toContain("أداء مرتفع");
    expect(doc.htmlSnapshot).toContain("اعتُمدت بواسطة");
    expect(doc.pdfFileId).toBeTruthy();
  }, 60_000);

  it("تقرير المدرسة: مؤشرات عامة وملحق أسماء وتنبيه الحساسية (D-013)", async () => {
    const { generateOverallPerformanceReport } = await import("@/lib/reports/performance-reports");
    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");

    const res = await generateOverallPerformanceReport({ issuedBy: userId });
    const [doc] = await db.select().from(documents).where(eq(documents.id, res.docId));
    expect(doc.docType).toBe("overall_performance_report");
    expect(doc.htmlSnapshot).toContain("حالة دورات التقييم");
    expect(doc.htmlSnapshot).toContain("عضو اللجنة الأول"); // الملحق بالأسماء
    expect(doc.htmlSnapshot).toContain("D-013");
    expect(doc.pdfFileId).toBeTruthy();
  }, 60_000);
});

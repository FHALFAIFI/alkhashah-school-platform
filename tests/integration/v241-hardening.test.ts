import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4.1 Phase F — hardening found by the focused security/correctness review (§5).
 *
 * Four defects, each proved here before the fix and pinned after it:
 *  1. Halala-exact money in the new allocation/expense result paths (D-043 was bypassed by
 *     raw float subtraction, so `100.10 − 0.20` reached the principal as 99.90000000000001).
 *  2. An upper bound on every money input — `numeric` without precision accepts 1e30 and
 *     silently corrupts every total, percentage and printed report afterwards.
 *  3. The general item-edit form was a side door around the "allocation below spend"
 *     confirmation, and it logged no spent-at-change value.
 *  4. Bulk consistency correction accepted forged / archived program ids that the review
 *     screen never offered.
 */

let pool: Pool;
let testUserId = "";
let yearId = "";
let permissions = new Set<string>(["budget.read", "budget.write", "plan.read", "plan.write"]);

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions,
    roleKeys: new Set<string>(),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions })),
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
    .values({ username: "t-v241", displayName: "اختبار v2.4.1", passwordHash: "x" })
    .returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  permissions = new Set<string>(["budget.read", "budget.write", "plan.read", "plan.write"]);
  const { db } = await import("@/db");
  const { budgetExpenses, budgetIncome, financialItems, planYears, programs, recordVersions, auditLog } =
    await import("@/db/schema");
  await db.delete(recordVersions);
  await db.delete(auditLog);
  await db.delete(budgetExpenses);
  await db.delete(budgetIncome);
  await db.delete(financialItems);
  await db.delete(programs);
  await db.delete(planYears);
  const [y] = await db.insert(planYears).values({ key: "v241", nameAr: "سنة v2.4.1", status: "نشطة" }).returning();
  yearId = y.id;
});

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("§5.1 — دقة الهللة في مسارات المخصص والمصروف الجديدة", () => {
  it("رسالة حفظ المخصص وسجل التدقيق يستعملان حساب الهللة لا الطرح العشري الخام", async () => {
    const { db } = await import("@/db");
    const { financialItems, budgetExpenses, auditLog } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند دقة", allocatedAmount: "0" }).returning();
    // 0.1 + 0.2 هو المثال الكلاسيكي الذي يكسر الطرح العشري الخام
    await db.insert(budgetExpenses).values({ planYearId: yearId, financialItemId: item.id, amount: "0.1" });
    await db.insert(budgetExpenses).values({ planYearId: yearId, financialItemId: item.id, amount: "0.2" });

    const { setItemAllocationAction } = await import("@/app/(app)/budget/finance-actions");
    const res = await setItemAllocationAction(item.id, null, fd({ allocatedAmount: "1", confirmBelowSpent: "1" }));

    // `formatMoney` يعرض بالأرقام العربية الهندية (ar-SA) — المهم أن الرقم دقيق لا شكله
    expect(res?.success).toMatch(/٠٫٧(?!\d)/);
    expect(res?.success).not.toMatch(/٠٫٦٩٩٩٩٩|٠٫٧٠٠٠٠٠٠٠/);

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "finance.item_allocation_set"));
    expect((entry.detail as { remainingAfter: number }).remainingAfter).toBe(0.7);
  });

  it("رسالة «المتبقي بعد العملية» عند حفظ المصروف دقيقة بالهللة", async () => {
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند المصروف", allocatedAmount: "100.10" }).returning();

    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const res = await addExpenseAction(
      null,
      fd({ planYearId: yearId, financialItemId: item.id, amount: "0.20" }),
    );

    expect(res?.success).toContain("تم حفظ المصروف");
    expect(res?.success).toContain("المتبقي بعد العملية");
    expect(res?.success).toMatch(/٩٩٫٩(?!\d)/);
    expect(res?.success).not.toMatch(/٩٩٫٩٠٠٠٠٠٠٠/);
  });

  it("البند بلا مخصص يقول لماذا تعذّر الاحتساب بدل اختلاق صفر", async () => {
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند بلا مخصص", allocatedAmount: null }).returning();

    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const res = await addExpenseAction(null, fd({ planYearId: yearId, financialItemId: item.id, amount: "50" }));
    expect(res?.success).toContain("لا يمكن احتساب المتبقي لأن المخصص غير محدد");
  });
});

describe("§5.2 — سقف المبالغ", () => {
  it("يرفض مخصصاً يتجاوز الحد الأعلى بدل تخزينه في عمود numeric بلا سقف", async () => {
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند السقف", allocatedAmount: null }).returning();

    const { setItemAllocationAction } = await import("@/app/(app)/budget/finance-actions");
    const res = await setItemAllocationAction(item.id, null, fd({ allocatedAmount: "1e30" }));
    expect(res?.error).toContain("أكبر من الحد المسموح");

    const [after] = await db.select().from(financialItems).where(eq(financialItems.id, item.id));
    expect(after.allocatedAmount).toBeNull();
  });

  it("يرفض مبلغ مصروف يتجاوز الحد الأعلى", async () => {
    const { addExpenseAction } = await import("@/app/(app)/budget/actions");
    const res = await addExpenseAction(null, fd({ planYearId: yearId, amount: "999999999999999" }));
    expect(res?.error).toContain("أكبر من الحد المسموح");
  });

  it("يقبل مبلغاً واقعياً عند الحد الأدنى من الحساسية", async () => {
    const { db } = await import("@/db");
    const { financialItems } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند عادي", allocatedAmount: null }).returning();
    const { setItemAllocationAction } = await import("@/app/(app)/budget/finance-actions");
    const res = await setItemAllocationAction(item.id, null, fd({ allocatedAmount: "125000.75" }));
    expect(res?.error).toBeUndefined();
  });
});

describe("§5.3 — لا باب جانبي حول تأكيد «المخصص أقل من المصروف»", () => {
  it("نموذج تعديل البند العام يخضع للتأكيد نفسه ولا يحفظ بدونه", async () => {
    const { db } = await import("@/db");
    const { financialItems, budgetExpenses } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند الباب الجانبي", allocatedAmount: "4000" }).returning();
    await db.insert(budgetExpenses).values({ planYearId: yearId, financialItemId: item.id, amount: "3000" });

    const { updateFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const blocked = await updateFinancialItemAction(item.id, null, fd({ nameAr: "بند الباب الجانبي", allocatedAmount: "1000" }));
    expect(blocked?.error).toContain("سيصبح البند متجاوزاً");
    expect(blocked?.needsConfirmation).toBe(true);

    const [unchanged] = await db.select().from(financialItems).where(eq(financialItems.id, item.id));
    expect(Number(unchanged.allocatedAmount)).toBe(4000);

    const ok = await updateFinancialItemAction(
      item.id,
      null,
      fd({ nameAr: "بند الباب الجانبي", allocatedAmount: "1000", confirmBelowSpent: "1" }),
    );
    expect(ok?.success).toBeTruthy();
    const [changed] = await db.select().from(financialItems).where(eq(financialItems.id, item.id));
    expect(Number(changed.allocatedAmount)).toBe(1000);
  });

  it("تعديل بند بلا تغيير المخصص لا يفرض تأكيداً ولا يستعلم عن المصروف", async () => {
    const { db } = await import("@/db");
    const { financialItems, budgetExpenses } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "قديم", allocatedAmount: "100" }).returning();
    await db.insert(budgetExpenses).values({ planYearId: yearId, financialItemId: item.id, amount: "900" });

    const { updateFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    const res = await updateFinancialItemAction(item.id, null, fd({ nameAr: "جديد", allocatedAmount: "100" }));
    expect(res?.success).toBeTruthy();
  });

  it("التدقيق يسجّل المصروف وقت التغيير من المسارين معاً", async () => {
    const { db } = await import("@/db");
    const { financialItems, budgetExpenses, auditLog } = await import("@/db/schema");
    const [item] = await db.insert(financialItems).values({ nameAr: "بند التدقيق", allocatedAmount: "500" }).returning();
    await db.insert(budgetExpenses).values({ planYearId: yearId, financialItemId: item.id, amount: "120" });

    const { updateFinancialItemAction } = await import("@/app/(app)/budget/finance-actions");
    await updateFinancialItemAction(item.id, null, fd({ nameAr: "بند التدقيق", allocatedAmount: "800" }));

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "finance.item_updated"));
    expect(entry.detail).toMatchObject({ previousAllocation: 500, newAllocation: 800, spentAtChange: 120 });
  });
});

describe("§5.4 — التصحيح الجماعي لا يقبل معرّفات مُلفَّقة", () => {
  async function seedProgram(name: string, extra: Record<string, unknown> = {}) {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [p] = await db
      .insert(programs)
      .values({
        planYearId: yearId,
        seq: Math.floor(Math.random() * 100000),
        domain: "مجال",
        name,
        status: "معتمد",
        executionStatus: "مكتمل",
        progress: 0,
        ...extra,
      })
      .returning();
    return p;
  }

  it("يرفض معرّفاً ليس UUID بدل تمريره إلى استعلام على عمود uuid", async () => {
    const p = await seedProgram("برنامج سليم");
    const { bulkCorrectProgramsAction } = await import("@/app/(app)/plan/actions");
    const res = await bulkCorrectProgramsAction(
      null,
      fd({ operation: "clearCompletionDate", programIds: `${p.id},not-a-uuid`, note: "سبب", confirm: "1" }),
    );
    // المعرّف غير الصالح يسقط في الترشيح، فيبقى معرّف واحد ويطابق صفاً واحداً
    expect(res?.error).toBeUndefined();
    expect(res?.success).toContain("1");
  });

  it("يرفض معرّف برنامج مؤرشف لا تعرضه شاشة المراجعة", async () => {
    const archived = await seedProgram("برنامج مؤرشف", { archivedAt: new Date() });
    const { bulkCorrectProgramsAction } = await import("@/app/(app)/plan/actions");
    const res = await bulkCorrectProgramsAction(
      null,
      fd({ operation: "resetToNotStarted", programIds: archived.id, note: "سبب", confirm: "1" }),
    );
    expect(res?.error).toBeTruthy();

    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [after] = await db.select().from(programs).where(eq(programs.id, archived.id));
    expect(after.executionStatus).toBe("مكتمل");
  });

  it("يرفض الدفعة التي تتجاوز السقف", async () => {
    const p = await seedProgram("برنامج");
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const { bulkCorrectProgramsAction } = await import("@/app/(app)/plan/actions");
    const res = await bulkCorrectProgramsAction(
      null,
      fd({ operation: "clearCompletionDate", programIds: [p.id, ...many].join(","), note: "سبب", confirm: "1" }),
    );
    expect(res?.error).toContain("محدود");
  });

  it("يظل يرفض بلا تأكيد صريح وبلا سبب", async () => {
    const p = await seedProgram("برنامج");
    const { bulkCorrectProgramsAction } = await import("@/app/(app)/plan/actions");
    const noConfirm = await bulkCorrectProgramsAction(
      null,
      fd({ operation: "clearCompletionDate", programIds: p.id, note: "سبب" }),
    );
    expect(noConfirm?.error).toContain("أكّد");
    const noNote = await bulkCorrectProgramsAction(
      null,
      fd({ operation: "clearCompletionDate", programIds: p.id, note: "", confirm: "1" }),
    );
    expect(noNote?.error).toBeTruthy();
  });
});

describe("§5.5 — تصحيح البرنامج المفرد", () => {
  it("يرفض تاريخ اكتمال خارج المدى الواقعي", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [p] = await db
      .insert(programs)
      .values({ planYearId: yearId, seq: 1, domain: "م", name: "برنامج", status: "معتمد", executionStatus: "مكتمل", progress: 0 })
      .returning();

    const { correctProgramConsistencyAction } = await import("@/app/(app)/plan/actions");
    const res = await correctProgramConsistencyAction(
      p.id,
      null,
      fd({ executionStatus: "مكتمل", progress: "100", completedAt: "9999-01-01", note: "سبب" }),
    );
    expect(res?.error).toContain("خارج المدى المقبول");
  });

  it("يرد معرّفاً مُلفَّقاً برسالة عربية لا بخطأ خادم", async () => {
    const { correctProgramConsistencyAction } = await import("@/app/(app)/plan/actions");
    const res = await correctProgramConsistencyAction(
      "'; drop table programs; --",
      null,
      fd({ executionStatus: "مكتمل", progress: "100", note: "سبب" }),
    );
    expect(res?.error).toBe("البرنامج غير موجود");
  });

  it("لا يمسّ الاعتماد ولا الإقفال، ويكتب لقطة سجل وسجل تدقيق", async () => {
    const { db } = await import("@/db");
    const { programs, recordVersions, auditLog } = await import("@/db/schema");
    const approvedAt = new Date("2026-01-01T00:00:00.000Z");
    const [p] = await db
      .insert(programs)
      .values({
        planYearId: yearId,
        seq: 2,
        domain: "م",
        name: "برنامج معتمد",
        status: "معتمد",
        approvedAt,
        executionStatus: "مكتمل",
        progress: 0,
      })
      .returning();

    const { correctProgramConsistencyAction } = await import("@/app/(app)/plan/actions");
    const res = await correctProgramConsistencyAction(
      p.id,
      null,
      fd({ executionStatus: "في المسار", progress: "40", note: "الواقع التشغيلي" }),
    );
    expect(res?.success).toBeTruthy();

    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.executionStatus).toBe("في المسار");
    expect(after.progress).toBe(40);
    expect(after.status).toBe("معتمد");
    expect(after.approvedAt?.toISOString()).toBe(approvedAt.toISOString());
    expect(after.closedAt).toBeNull();

    const versions = await db.select().from(recordVersions).where(eq(recordVersions.entityId, p.id));
    expect(versions.length).toBeGreaterThan(0);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "program.consistency_corrected"));
    expect(audits.length).toBe(1);
  });

  it("السجل المقفل يُصحَّح بسبب مكتوب ولا يُرفع إقفاله", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const [p] = await db
      .insert(programs)
      .values({
        planYearId: yearId,
        seq: 3,
        domain: "م",
        name: "برنامج مقفل",
        status: "معتمد",
        closedAt: new Date(),
        executionStatus: "قيد التنفيذ",
        progress: 20,
      })
      .returning();

    // v2.4.1 §1.6: الإقفال لم يعد مانعاً. `plan.override` لم تُمنح لأي دور قط، فكان
    // الشرط منعاً مطلقاً لا استثناءً مخوَّلاً. الحارس الباقي هو السبب المكتوب الإلزامي.
    const { correctProgramConsistencyAction } = await import("@/app/(app)/plan/actions");
    const noReason = await correctProgramConsistencyAction(
      p.id,
      null,
      fd({ executionStatus: "مكتمل", progress: "100", note: "" }),
    );
    expect(noReason?.error).toBeTruthy();

    const allowed = await correctProgramConsistencyAction(
      p.id,
      null,
      fd({ executionStatus: "مكتمل", progress: "100", note: "تصحيح سجل مقفل بقرار المدير" }),
    );
    expect(allowed?.success).toBeTruthy();

    // والإقفال نفسه لم يُرفع
    const [after] = await db.select().from(programs).where(eq(programs.id, p.id));
    expect(after.closedAt).not.toBeNull();
    expect(after.progress).toBe(100);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

// محاكاة سياق الطلب: صلاحيات إدارة النماذج والدورات كاملة
vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set([
      "performance.read",
      "performance.write",
      "performance.approve",
      "performance.individual.read",
      "performance.models.manage",
    ]),
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
    .values({ username: "t-model-admin", displayName: "اختبار النماذج", passwordHash: "x" })
    .returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

/** نموذج تجريبي مع مؤشر واحد وزنه 100 — بيانات صناعية داخل الاختبار */
async function seedModel(opts?: { status?: string; official?: boolean; audience?: string }) {
  const { db } = await import("@/db");
  const { perfModels, perfIndicators } = await import("@/db/schema");
  const suffix = Math.floor(Math.random() * 1e9);
  const [model] = await db
    .insert(perfModels)
    .values({
      key: `t-model-${suffix}`,
      nameAr: `نموذج تجريبي ${suffix}`,
      audience: opts?.audience ?? "موظف",
      official: opts?.official ?? false,
      status: opts?.status ?? "مسودة",
    })
    .returning();
  await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "مؤشر تجريبي", weight: "100" });
  return model;
}

async function seedPersonWithCycle(modelId: string, yearKey: string) {
  const { db } = await import("@/db");
  const { people, perfCycles } = await import("@/db/schema");
  const suffix = Math.floor(Math.random() * 1e9);
  const [person] = await db
    .insert(people)
    .values({ fullName: `موظف تجريبي ${suffix}`, category: "موظف", active: true })
    .returning();
  const [cycle] = await db
    .insert(perfCycles)
    .values({
      personId: person.id,
      cycleType: "موظف",
      yearKey,
      modelId,
      modelSnapshot: { model: { id: modelId }, indicators: [] },
    })
    .returning();
  return { person, cycle };
}

/**
 * v2.5.0 §8.1: الحذف النهائي للنموذج صار يمرّ بضوابط الحذف نفسها المطبَّقة على الموظف
 * ودورة الأداء — إقرار صريح واسم مكتوب حرفياً وسبب إلزامي وشاهد حذف. هذه المساعدة تبني
 * الطلب الكامل، فتبقى الاختبارات معبّرة عن العقد الجديد لا عن نداء بمعرّف واحد.
 */
function deleteFd(name: string, reason = "نموذج تجريبي لم يُستعمل") {
  const fd = new FormData();
  fd.set("confirm", "1");
  fd.set("typedName", name);
  fd.set("reason", reason);
  return fd;
}

describe("إدارة نماذج الأداء (v2.4 §6 · v2.5.0 §8.1): الحذف الآمن والأرشفة والاستعادة", () => {
  it("(أ) حذف نهائي لمسودة غير مستخدمة: يحذف النموذج ومؤشراته مع لقطة وسجل تدقيق", async () => {
    const { db } = await import("@/db");
    const { perfModels, perfIndicators, auditLog, recordVersions } = await import("@/db/schema");
    const { deleteModelAction } = await import("@/app/(app)/performance/actions");
    const model = await seedModel({ status: "مسودة" });

    const res = await deleteModelAction(model.id, null, deleteFd(model.nameAr));
    expect(res?.error).toBeUndefined();

    const gone = await db.select().from(perfModels).where(eq(perfModels.id, model.id));
    expect(gone).toHaveLength(0);
    const inds = await db.select().from(perfIndicators).where(eq(perfIndicators.modelId, model.id));
    expect(inds).toHaveLength(0);

    const versions = await db
      .select()
      .from(recordVersions)
      .where(and(eq(recordVersions.entityType, "perf_model"), eq(recordVersions.entityId, model.id)));
    expect(versions.length).toBeGreaterThan(0);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "perf_model.permanently_deleted"), eq(auditLog.entityId, model.id)));
    expect(audits).toHaveLength(1);

    // شاهد الحذف يحمل السبب والأعداد — §8.2/§17
    const { deletionTombstones } = await import("@/db/schema");
    const [tomb] = await db
      .select()
      .from(deletionTombstones)
      .where(and(eq(deletionTombstones.entityType, "perf_model"), eq(deletionTombstones.entityId, model.id)));
    expect(tomb.reason).toContain("لم يُستعمل");
  });

  it("(ب) حذف نموذج معتمد غير مستخدم: يمر عندما يوجد نموذج معتمد نشط آخر لنفس الفئة", async () => {
    const { db } = await import("@/db");
    const { perfModels } = await import("@/db/schema");
    const { deleteModelAction } = await import("@/app/(app)/performance/actions");
    await seedModel({ status: "معتمد" }); // بديل نشط يبقي الفئة مغطاة
    const model = await seedModel({ status: "معتمد" });

    const res = await deleteModelAction(model.id, null, deleteFd(model.nameAr));
    expect(res?.error).toBeUndefined();
    expect(await db.select().from(perfModels).where(eq(perfModels.id, model.id))).toHaveLength(0);
  });

  it("(ج) النموذج الرسمي لا يحذف نهائياً", async () => {
    const { deleteModelAction } = await import("@/app/(app)/performance/actions");
    const model = await seedModel({ status: "معتمد", official: true });
    const res = await deleteModelAction(model.id, null, deleteFd(model.nameAr));
    expect(res?.error).toContain("الرسمية");
  });

  it("(د) النموذج المستخدم لا يحذف — الرسالة ترشد إلى الأرشفة وتذكر السجلات المرتبطة", async () => {
    const { db } = await import("@/db");
    const { perfModels } = await import("@/db/schema");
    const { deleteModelAction } = await import("@/app/(app)/performance/actions");
    const model = await seedModel({ status: "معتمد" });
    await seedPersonWithCycle(model.id, "2026-t-d");

    const res = await deleteModelAction(model.id, null, deleteFd(model.nameAr));
    expect(res?.error).toContain("أرشفة");
    expect(res?.error).toContain("دورة تقييم");
    expect(await db.select().from(perfModels).where(eq(perfModels.id, model.id))).toHaveLength(1);
  });

  it("(هـ) أرشفة نموذج مستخدم: تعلم النموذج وتحفظ لقطة الدورة التاريخية كما هي، والأرشفة متكررة بأمان", async () => {
    const { db } = await import("@/db");
    const { perfModels, perfCycles, auditLog } = await import("@/db/schema");
    const { archiveModelAction } = await import("@/app/(app)/performance/actions");
    await seedModel({ status: "معتمد" }); // بديل نشط
    const model = await seedModel({ status: "معتمد" });
    const { cycle } = await seedPersonWithCycle(model.id, "2026-t-h");

    const fd = new FormData();
    fd.set("reason", "استبدال بنموذج أحدث");
    const res = await archiveModelAction(model.id, null, fd);
    expect(res?.success).toBeTruthy();

    const [after] = await db.select().from(perfModels).where(eq(perfModels.id, model.id));
    expect(after.archivedAt).not.toBeNull();
    expect(after.archivedBy).toBe(testUserId);
    expect(after.archivedReason).toBe("استبدال بنموذج أحدث");

    // اللقطة المجمدة في الدورة لم تمس — التقارير التاريخية تبقى قابلة للعرض
    const [cycleAfter] = await db.select().from(perfCycles).where(eq(perfCycles.id, cycle.id));
    expect(cycleAfter.modelSnapshot).toBeTruthy();
    expect(cycleAfter.modelId).toBe(model.id);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "perf_model.archived"), eq(auditLog.entityId, model.id)));
    expect(audits).toHaveLength(1);

    // تكرار الأرشفة لا يفشل ولا يكرر التدقيق الجوهري
    const again = await archiveModelAction(model.id, null, new FormData());
    expect(again?.success).toContain("مسبقاً");
  });

  it("(و) لا تؤرشف ولا يحذف آخر نموذج معتمد نشط لفئته", async () => {
    const { db } = await import("@/db");
    const { perfModels } = await import("@/db/schema");
    const { archiveModelAction, deleteModelAction } = await import("@/app/(app)/performance/actions");
    // فئة مستقلة تماماً حتى لا تتأثر ببقية الاختبارات
    const audience = "معلم";
    // أرشفة كل المعتمد النشط السابق لهذه الفئة إن وجد (عزل)
    await db
      .update(perfModels)
      .set({ archivedAt: new Date() })
      .where(and(eq(perfModels.audience, audience), eq(perfModels.status, "معتمد")));
    const last = await seedModel({ status: "معتمد", audience });

    const resA = await archiveModelAction(last.id, null, new FormData());
    expect(resA?.error).toContain("آخر نموذج معتمد");
    const resD = await deleteModelAction(last.id, null, deleteFd(last.nameAr));
    expect(resD?.error).toContain("آخر نموذج معتمد");
  });

  it("(ز) الاستعادة تلغي الأرشفة وتسجل في التدقيق", async () => {
    const { db } = await import("@/db");
    const { perfModels, auditLog } = await import("@/db/schema");
    const { archiveModelAction, restoreModelAction } = await import("@/app/(app)/performance/actions");
    const model = await seedModel({ status: "مسودة" });
    await archiveModelAction(model.id, null, new FormData());

    const res = await restoreModelAction(model.id);
    expect(res?.success).toBeTruthy();
    const [after] = await db.select().from(perfModels).where(eq(perfModels.id, model.id));
    expect(after.archivedAt).toBeNull();
    expect(after.archivedReason).toBeNull();
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "perf_model.restored"), eq(auditLog.entityId, model.id)));
    expect(audits).toHaveLength(1);
  });

  it("(ح) لا تنشأ دورة تقييم على نموذج مؤرشف", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { createCycleAction } = await import("@/app/(app)/performance/actions");
    const { archiveModelAction } = await import("@/app/(app)/performance/actions");
    await seedModel({ status: "معتمد" }); // بديل نشط
    const model = await seedModel({ status: "معتمد" });
    await archiveModelAction(model.id, null, new FormData());

    const [person] = await db
      .insert(people)
      .values({ fullName: "موظف دورة مؤرشفة", category: "موظف", active: true })
      .returning();
    const fd = new FormData();
    fd.set("personId", person.id);
    fd.set("modelId", model.id);
    fd.set("cycleType", "موظف");
    fd.set("yearKey", "2026-t-arch");
    const res = await createCycleAction(null, fd);
    expect(res?.error).toContain("مؤرشف");
  });

  it("(ط) عدّ السجلات المرتبطة يشمل المسارات غير المباشرة (التقديرات عبر مؤشرات النموذج)", async () => {
    const { db } = await import("@/db");
    const { perfIndicators, perfSessions, perfRatings } = await import("@/db/schema");
    const { modelLinkedRecords } = await import("@/lib/performance/model-admin");
    const model = await seedModel({ status: "معتمد", audience: "موظف" });
    const { cycle } = await seedPersonWithCycle(model.id, "2026-t-i");
    const [session] = await db
      .insert(perfSessions)
      .values({ cycleId: cycle.id, sessionType: "نهائي", sessionDate: "2026-06-01" })
      .returning();
    const [ind] = await db.select().from(perfIndicators).where(eq(perfIndicators.modelId, model.id));
    await db.insert(perfRatings).values({ sessionId: session.id, indicatorId: ind.id, rating: 4 });

    const counts = await modelLinkedRecords(model.id);
    expect(counts.employees).toBe(1);
    expect(counts.cycles).toBe(1);
    expect(counts.sessions).toBe(1);
    expect(counts.ratings).toBe(1);
  });
});

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
    permissions: new Set([
      "performance.read", "performance.write", "performance.approve",
      "performance.individual.read", "performance.models.manage",
      "evidence.write", "reports.generate", "branding.use",
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
  const [u] = await db.insert(users).values({ username: "t-perf", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

/** نموذج اصطناعي معتمد بوزن 100 + دورة + شخص */
async function seedPerformanceFixture() {
  const { db } = await import("@/db");
  const { people, perfModels, perfIndicators, perfCycles } = await import("@/db/schema");
  const suffix = Math.floor(Math.random() * 1e9);
  const [person] = await db.insert(people).values({ fullName: `معلم تجريبي ${suffix}`, category: "معلم" }).returning();
  const [model] = await db
    .insert(perfModels)
    .values({ key: `test-model-${suffix}`, nameAr: "نموذج اختبار", audience: "معلم", status: "معتمد" })
    .returning();
  const inds = await db
    .insert(perfIndicators)
    .values([
      { modelId: model.id, nameAr: "مؤشر أول", weight: "40", requiresEvidence: true, sortOrder: 0 },
      { modelId: model.id, nameAr: "مؤشر ثانٍ", weight: "35", requiresEvidence: false, sortOrder: 1 },
      { modelId: model.id, nameAr: "مؤشر ثالث", weight: "25", requiresEvidence: false, sortOrder: 2 },
    ])
    .returning();
  const [cycle] = await db
    .insert(perfCycles)
    .values({
      personId: person.id,
      cycleType: "معلم",
      yearKey: `y-${suffix}`,
      modelId: model.id,
      calendarSnapshot: { events: [{ anchorKey: "students_start", gregFrom: "2026-08-30" }] },
      modelSnapshot: { model: { id: model.id, nameAr: model.nameAr, official: false, version: 1 }, indicators: inds },
    })
    .returning();
  return { person, model, inds, cycle };
}

async function createSessionViaAction(cycleId: string, type: string, date?: string) {
  const { createSessionAction } = await import("@/app/(app)/performance/actions");
  const fd = new FormData();
  fd.set("sessionType", type);
  if (date) fd.set("sessionDate", date);
  const res = await createSessionAction(cycleId, null, fd);
  if (res?.error) return { error: res.error, session: null };
  const { db } = await import("@/db");
  const { perfSessions } = await import("@/db/schema");
  const { and, desc } = await import("drizzle-orm");
  const sessions = await db
    .select()
    .from(perfSessions)
    .where(and(eq(perfSessions.cycleId, cycleId), eq(perfSessions.sessionType, type)))
    .orderBy(desc(perfSessions.createdAt));
  return { error: null, session: sessions[0] };
}

describe("إدارة الأداء (A3, A4 وبوابة المرحلة 3)", () => {
  it("النموذج لا يعتمد إلا بمجموع أوزان 100٪ تماماً", async () => {
    const { db } = await import("@/db");
    const { perfModels, perfIndicators } = await import("@/db/schema");
    const { approveModelAction } = await import("@/app/(app)/performance/actions");
    const [m] = await db.insert(perfModels).values({ key: `w-${Math.random()}`, nameAr: "نموذج ناقص", audience: "موظف" }).returning();
    await db.insert(perfIndicators).values({ modelId: m.id, nameAr: "مؤشر", weight: "60", sortOrder: 0 });
    const rejected = await approveModelAction(m.id);
    expect(rejected?.error).toContain("100");
    await db.insert(perfIndicators).values({ modelId: m.id, nameAr: "مؤشر مكمل", weight: "40", sortOrder: 1 });
    const accepted = await approveModelAction(m.id);
    expect(accepted?.error).toBeUndefined();
  });

  it("A4: النتيجة تحسب في الخادم وأي قيمة نتيجة مرسلة من العميل تتجاهل", async () => {
    const { db } = await import("@/db");
    const { perfSessions } = await import("@/db/schema");
    const { saveRatingsAction } = await import("@/app/(app)/performance/actions");
    const { cycle, inds } = await seedPerformanceFixture();
    const { session } = await createSessionViaAction(cycle.id, "تخطيط");

    const fd = new FormData();
    fd.set(`rating_${inds[0].id}`, "5"); // 40
    fd.set(`rating_${inds[1].id}`, "4"); // 28
    fd.set(`rating_${inds[2].id}`, "3"); // 15
    // محاولة تلاعب: إرسال نتيجة مزورة
    fd.set("sessionResult", "100");
    fd.set("coverage", "1");
    const res = await saveRatingsAction(session!.id, null, fd);
    expect(res?.error).toBeUndefined();

    const [after] = await db.select().from(perfSessions).where(eq(perfSessions.id, session!.id));
    expect(Number(after.sessionResult)).toBe(83); // 40+28+15 — وليس 100 المزورة
    expect(Number(after.coverage)).toBe(1);
  });

  it("يرفض تقديراً خارج 1..5", async () => {
    const { saveRatingsAction } = await import("@/app/(app)/performance/actions");
    const { cycle, inds } = await seedPerformanceFixture();
    const { session } = await createSessionViaAction(cycle.id, "تخطيط");
    const fd = new FormData();
    fd.set(`rating_${inds[0].id}`, "7");
    const res = await saveRatingsAction(session!.id, null, fd);
    expect(res?.error).toContain("1 إلى 5");
  });

  it("جلسات التخطيط والمنتصف والنهائي مرة واحدة فقط، والزيارات غير محدودة", async () => {
    const { cycle } = await seedPerformanceFixture();
    expect((await createSessionViaAction(cycle.id, "تخطيط")).error).toBeNull();
    expect((await createSessionViaAction(cycle.id, "تخطيط")).error).toContain("مرة واحدة");
    expect((await createSessionViaAction(cycle.id, "زيارة", "2026-10-01")).error).toBeNull();
    expect((await createSessionViaAction(cycle.id, "زيارة", "2026-10-15")).error).toBeNull();
  });

  it("زيارة قبل بداية دراسة الطلاب = تنبيه فقط ولا تمنع", async () => {
    const { cycle } = await seedPerformanceFixture();
    const { error, session } = await createSessionViaAction(cycle.id, "زيارة", "2026-08-25");
    expect(error).toBeNull();
    expect(session!.warningFlags?.[0]).toContain("قبل بداية دراسة الطلاب");
  });

  it("A3: الجلسة لا تكتمل دون تقرير صادر وتقرير موقع مرفوع", async () => {
    const { db } = await import("@/db");
    const { perfSessions, storedFiles, documents } = await import("@/db/schema");
    const { completeSessionAction } = await import("@/app/(app)/performance/actions");
    const { cycle } = await seedPerformanceFixture();
    const { session } = await createSessionViaAction(cycle.id, "متابعة");

    // بلا تقرير صادر
    const r1 = await completeSessionAction(session!.id);
    expect(r1?.error).toContain("تقرير");

    // تقرير صادر لكن بلا نسخة موقعة
    const [doc] = await db
      .insert(documents)
      .values({ docNumber: `T-${Math.random()}`, verificationCode: `V-${Math.random()}`, docType: "performance_report", title: "ت", issuedBy: testUserId })
      .returning();
    await db.update(perfSessions).set({ reportDocId: doc.id }).where(eq(perfSessions.id, session!.id));
    const r2 = await completeSessionAction(session!.id);
    expect(r2?.error).toContain("الموقع");

    // برفع النسخة الموقعة يكتمل
    const [f] = await db
      .insert(storedFiles)
      .values({ originalName: "تقرير-موقع.pdf", mime: "application/pdf", size: 10, sha256: "x", storagePath: `attachments/p-${Math.random()}.pdf` })
      .returning();
    await db.update(perfSessions).set({ signedReportFileId: f.id }).where(eq(perfSessions.id, session!.id));
    const r3 = await completeSessionAction(session!.id);
    expect(r3?.error).toBeUndefined();
    const [done] = await db.select().from(perfSessions).where(eq(perfSessions.id, session!.id));
    expect(done.status).toBe("مكتملة");
  });

  it("التقييم النهائي لا يقفل قبل تقييم كل المؤشرات واكتمال الشواهد المطلوبة — وإقفاله يكمل الدورة وإعادة فتحه تعيدها نشطة", async () => {
    const { db } = await import("@/db");
    const { perfSessions, perfCycles, storedFiles, documents, evidenceItems } = await import("@/db/schema");
    const { completeSessionAction, saveRatingsAction } = await import("@/app/(app)/performance/actions");
    const { linkEvidence } = await import("@/lib/evidence");
    const { cycle, inds } = await seedPerformanceFixture();
    const { session } = await createSessionViaAction(cycle.id, "نهائي");

    // تجهيز التقرير والنسخة الموقعة أولاً
    const [doc] = await db
      .insert(documents)
      .values({ docNumber: `TF-${Math.random()}`, verificationCode: `VF-${Math.random()}`, docType: "performance_report", title: "ت", issuedBy: testUserId })
      .returning();
    const [f] = await db
      .insert(storedFiles)
      .values({ originalName: "موقع.pdf", mime: "application/pdf", size: 10, sha256: "x", storagePath: `attachments/f-${Math.random()}.pdf` })
      .returning();
    await db.update(perfSessions).set({ reportDocId: doc.id, signedReportFileId: f.id }).where(eq(perfSessions.id, session!.id));

    // تقييم ناقص → يرفض
    const fd1 = new FormData();
    fd1.set(`rating_${inds[0].id}`, "4");
    await saveRatingsAction(session!.id, null, fd1);
    const r1 = await completeSessionAction(session!.id);
    expect(r1?.error).toContain("جميع المؤشرات");

    // تقييم كامل لكن شاهد المؤشر الأول (يتطلب شواهد) مفقود → يرفض
    const fd2 = new FormData();
    fd2.set(`rating_${inds[0].id}`, "4");
    fd2.set(`rating_${inds[1].id}`, "5");
    fd2.set(`rating_${inds[2].id}`, "3");
    await saveRatingsAction(session!.id, null, fd2);
    const r2 = await completeSessionAction(session!.id);
    expect(r2?.error).toContain("الشواهد");

    // ربط شاهد بكل مؤشر يتطلب شواهد (subKey = معرف المؤشر) عبر المسار الحقيقي → يقفل
    const requiresEvidence = inds.filter((i) => i.requiresEvidence);
    for (const ind of requiresEvidence) {
      const [ev] = await db.insert(evidenceItems).values({ title: `شاهد ${ind.nameAr}`, kind: "text", textContent: "ن" }).returning();
      await linkEvidence({ evidenceId: ev.id, entityType: "perf_session", entityId: session!.id, subKey: ind.id });
    }
    const r3 = await completeSessionAction(session!.id);
    expect(r3?.error).toBeUndefined();
    const [locked] = await db.select().from(perfSessions).where(eq(perfSessions.id, session!.id));
    expect(locked.status).toBe("مقفلة");

    // إقفال التقييم النهائي يكمل الدورة
    const [completedCycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, cycle.id));
    expect(completedCycle.status).toBe("مكتملة");

    // إعادة الفتح تتطلب سبباً وتحفظ النسخة
    const { reopenSessionAction } = await import("@/app/(app)/performance/actions");
    const noReason = new FormData();
    noReason.set("reason", "");
    expect((await reopenSessionAction(session!.id, noReason))?.error).toContain("إلزامي");
    const withReason = new FormData();
    withReason.set("reason", "تصحيح تقدير مؤشر");
    expect(await reopenSessionAction(session!.id, withReason)).toBeNull();
    const { getVersions } = await import("@/lib/versioning");
    const versions = await getVersions("perf_session", session!.id);
    expect(versions.some((v) => v.action === "reopened" && v.reason === "تصحيح تقدير مؤشر")).toBe(true);

    // إعادة فتح الجلسة النهائية تعيد الدورة إلى «نشطة»
    const [reactivatedCycle] = await db.select().from(perfCycles).where(eq(perfCycles.id, cycle.id));
    expect(reactivatedCycle.status).toBe("نشطة");
  });

  it("D-014: دورة موظف بلا نموذج معتمد لفئته تنشأ بنموذج معلم معتمد (اختيار يدوي)، وترفض عند وجود نموذج مطابق", async () => {
    const { db } = await import("@/db");
    const { and } = await import("drizzle-orm");
    const { people, perfModels, perfCycles } = await import("@/db/schema");
    const { createCycleAction } = await import("@/app/(app)/performance/actions");

    // لا نموذج معتمد لفئة «موظف» (تحيد أي نموذج اعتمد في اختبارات سابقة)
    await db
      .update(perfModels)
      .set({ status: "مسودة" })
      .where(and(eq(perfModels.audience, "موظف"), eq(perfModels.status, "معتمد")));

    const { model } = await seedPerformanceFixture(); // نموذج «معلم» معتمد
    const suffix = Math.floor(Math.random() * 1e9);
    const [staff] = await db.insert(people).values({ fullName: `موظف تجريبي ${suffix}`, category: "موظف" }).returning();

    const fd = new FormData();
    fd.set("personId", staff.id);
    fd.set("modelId", model.id);
    fd.set("cycleType", "موظف");
    fd.set("yearKey", "2026");
    const res = await createCycleAction(null, fd);
    expect(res?.error).toBeUndefined();

    const [cycle] = await db.select().from(perfCycles).where(eq(perfCycles.personId, staff.id));
    expect(cycle).toBeDefined();
    expect(cycle.cycleType).toBe("موظف");
    expect(cycle.status).toBe("نشطة");
    expect(cycle.startDate).toBe("2026-01-01");
    expect(cycle.endDate).toBe("2026-12-31");

    // عند وجود نموذج معتمد مطابق للفئة يرفض عدم التطابق
    const [staffModel] = await db
      .insert(perfModels)
      .values({ key: `staff-model-${suffix}`, nameAr: "نموذج موظفين", audience: "موظف", status: "معتمد" })
      .returning();
    expect(staffModel).toBeDefined();
    const [staff2] = await db.insert(people).values({ fullName: `موظف ثانٍ ${suffix}`, category: "موظف" }).returning();
    const fd2 = new FormData();
    fd2.set("personId", staff2.id);
    fd2.set("modelId", model.id); // نموذج «معلم» رغم وجود نموذج موظفين معتمد
    fd2.set("cycleType", "موظف");
    fd2.set("yearKey", "2026");
    const rejected = await createCycleAction(null, fd2);
    expect(rejected?.error).toContain("مخصص لفئة");
  });

  it("خطط التحسين: منع التكرار بنفس العنوان وتقدم الحالة مسودة → قيد التنفيذ → مكتملة", async () => {
    const { db } = await import("@/db");
    const { improvementPlans } = await import("@/db/schema");
    const { createImprovementPlanAction, advanceImprovementPlanAction } = await import("@/app/(app)/performance/actions");
    const { cycle } = await seedPerformanceFixture();

    const fd = new FormData();
    fd.set("title", "خطة تطوير القراءة");
    const first = await createImprovementPlanAction(cycle.id, null, fd);
    expect(first?.error).toBeUndefined();
    const dup = await createImprovementPlanAction(cycle.id, null, fd);
    expect(dup?.error).toContain("العنوان نفسه");

    const [plan] = await db.select().from(improvementPlans).where(eq(improvementPlans.cycleId, cycle.id));
    expect(plan.status).toBe("مسودة");
    expect((await advanceImprovementPlanAction(plan.id))?.error).toBeUndefined();
    expect((await advanceImprovementPlanAction(plan.id))?.error).toBeUndefined();
    const [done] = await db.select().from(improvementPlans).where(eq(improvementPlans.id, plan.id));
    expect(done.status).toBe("مكتملة");
    expect((await advanceImprovementPlanAction(plan.id))?.error).toContain("لا حالة تالية");
  });

  it("بوابة D-014: لا يُقفَل التقييم النهائي على نموذج رسمي أصلي فيه خلية بانتظار مطابقة فارس (رغم استيفاء بقية الشروط)", async () => {
    const { db } = await import("@/db");
    const { people, perfModels, perfIndicators, perfCycles, perfSessions, storedFiles, documents } = await import("@/db/schema");
    const { completeSessionAction, saveRatingsAction } = await import("@/app/(app)/performance/actions");
    const suffix = Math.floor(Math.random() * 1e9);
    const [person] = await db.insert(people).values({ fullName: `وكيل تجريبي ${suffix}`, category: "معلم" }).returning();
    // نموذج رسمي أصلي (النسخة 1) فيه خلية D-014 «ينفذ إجراءات علمية…» بوزن 5٪
    const [model] = await db
      .insert(perfModels)
      .values({ key: "school-vice", nameAr: "وكيل المدرسة", audience: "معلم", official: true, status: "معتمد", version: 1 })
      .returning();
    const inds = await db
      .insert(perfIndicators)
      .values([
        { modelId: model.id, nameAr: "ينفذ إجراءات علمية لتحسين نتائج التعلم", weight: "5", requiresEvidence: false, sortOrder: 0 },
        { modelId: model.id, nameAr: "أداء الواجبات الوظيفية", weight: "95", requiresEvidence: false, sortOrder: 1 },
      ])
      .returning();
    const [cycle] = await db
      .insert(perfCycles)
      .values({
        personId: person.id,
        cycleType: "معلم",
        yearKey: `d014-${suffix}`,
        modelId: model.id,
        calendarSnapshot: { events: [] },
        modelSnapshot: { model: { id: model.id, key: model.key, nameAr: model.nameAr, official: true, version: 1 }, indicators: inds },
      })
      .returning();
    const { session } = await createSessionViaAction(cycle.id, "نهائي");

    // استيفاء بقية الشروط: تقرير صادر + نسخة موقعة + تقييم كل المؤشرات (لا شواهد مطلوبة)
    const [doc] = await db
      .insert(documents)
      .values({ docNumber: `DF-${Math.random()}`, verificationCode: `VF-${Math.random()}`, docType: "performance_report", title: "ت", issuedBy: testUserId })
      .returning();
    const [f] = await db
      .insert(storedFiles)
      .values({ originalName: "موقع.pdf", mime: "application/pdf", size: 10, sha256: "x", storagePath: `attachments/d014-${Math.random()}.pdf` })
      .returning();
    await db.update(perfSessions).set({ reportDocId: doc.id, signedReportFileId: f.id }).where(eq(perfSessions.id, session!.id));
    const fd = new FormData();
    fd.set(`rating_${inds[0].id}`, "4");
    fd.set(`rating_${inds[1].id}`, "5");
    await saveRatingsAction(session!.id, null, fd);

    // كل الشروط مستوفاة عدا D-014 → تُرفض بوابة فارس
    const res = await completeSessionAction(session!.id);
    expect(res?.error).toContain("D-014");
    expect(res?.error).toContain("فارس");
    const [still] = await db.select().from(perfSessions).where(eq(perfSessions.id, session!.id));
    expect(still.status).not.toBe("مقفلة");
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4.1 §5.3 / §5.4 — الحذف النهائي لدورة الحياة.
 *
 * أخطر ميزة في هذا الإصدار، فالاختبار يبني منسوباً تجريبياً بدورة حياة كاملة (دورتا أداء
 * وجلسات وتقديرات وخطة تحسين ووثيقة صادرة وشاهد) **ومعه ارتباطات مؤسسية مشتركة** (عضوية
 * لجنة، ملكية برنامج ونشاط، مهمة، بلاغ صيانة، مصروف)، ثم يثبت:
 *   • أن المملوك يُمحى بالكامل،
 *   • أن المشترك يبقى ويُفكّ ارتباطه فقط،
 *   • أن الشاهد المرتبط بسجل آخر لا يُمسّ،
 *   • أن الشاهد الخاص به وحده يُمحى،
 *   • أن الشاهد التدقيقي يُكتب بلا محتوى تقييمي،
 *   • أن كل حارس (الاسم المكتوب، السبب، حذف الذات، آخر حساب مخوَّل) يفشل مغلقاً.
 */

let pool: Pool;
let actorId = "";

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
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-purge-actor", displayName: "المدير", passwordHash: "x" }).returning();
  actorId = u.id;
});

/** يبني منسوباً بدورة حياة كاملة + ارتباطات مؤسسية مشتركة */
async function seedEmployeeLifecycle() {
  const { db } = await import("@/db");
  const {
    people, perfModels, perfIndicators, perfCycles, perfSessions, perfRatings, improvementPlans,
    planYears, programs, programActivities, committeeTemplates, committees, committeeMembers,
    committeeTaskAssignments, actionTasks, maintenanceIssues, budgetExpenses, financialItems,
    documents, evidenceItems, evidenceLinks, users,
  } = await import("@/db/schema");

  const [person] = await db
    .insert(people)
    .values({ fullName: "منسوب تجريبي للحذف", category: "معلم", employeeType: "معلم", jobNumber: "T-9001" })
    .returning();
  // منسوب ثانٍ يبقى — يثبت أن الحذف لا يمس غير المستهدف
  const [other] = await db
    .insert(people)
    .values({ fullName: "منسوب باقٍ", category: "معلم", employeeType: "معلم", jobNumber: "T-9002" })
    .returning();

  const [linkedUser] = await db
    .insert(users)
    .values({ username: "t-purge-linked", displayName: "حساب المنسوب", passwordHash: "x", personId: person.id })
    .returning();

  const [model] = await db.insert(perfModels).values({ key: "m-purge", nameAr: "نموذج", audience: "معلم", status: "معتمد" }).returning();
  const [ind] = await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "مؤشر", weight: "100" }).returning();
  const snapshot = { model: { nameAr: "نموذج", official: false }, indicators: [{ id: ind.id, nameAr: "مؤشر", weight: "100", requiresEvidence: false }] };

  const [cycleA] = await db
    .insert(perfCycles)
    .values({ personId: person.id, cycleType: "معلم", yearKey: "1448", modelId: model.id, modelSnapshot: snapshot })
    .returning();
  const [cycleB] = await db
    .insert(perfCycles)
    .values({ personId: person.id, cycleType: "معلم", yearKey: "1449", modelId: model.id, modelSnapshot: snapshot })
    .returning();
  // دورة لمنسوب آخر — يجب ألا تُمسّ
  const [otherCycle] = await db
    .insert(perfCycles)
    .values({ personId: other.id, cycleType: "معلم", yearKey: "1448", modelId: model.id, modelSnapshot: snapshot })
    .returning();

  const [sessionA] = await db.insert(perfSessions).values({ cycleId: cycleA.id, sessionType: "نهائي" }).returning();
  const [sessionB] = await db.insert(perfSessions).values({ cycleId: cycleB.id, sessionType: "نهائي" }).returning();
  await db.insert(perfSessions).values({ cycleId: otherCycle.id, sessionType: "نهائي" });
  await db.insert(perfRatings).values([
    { sessionId: sessionA.id, indicatorId: ind.id, rating: 4, note: "ملاحظة تقييم حساسة" },
    { sessionId: sessionB.id, indicatorId: ind.id, rating: 5 },
  ]);
  await db.insert(improvementPlans).values({ cycleId: cycleA.id, sessionId: sessionA.id, title: "خطة تحسين" });

  // وثيقة صادرة عن جلسة الدورة الأولى
  const [doc] = await db
    .insert(documents)
    .values({ docNumber: "D-9001", verificationCode: "V-9001", docType: "employee_performance_report", title: "تقرير", entityType: "perf_session", entityId: sessionA.id })
    .returning();

  // شاهد خاص بالجلسة وحدها (يُمحى) وشاهد مشترك مع برنامج (يبقى)
  const [ownEvidence] = await db.insert(evidenceItems).values({ title: "شاهد خاص بالجلسة", kind: "text", textContent: "x" }).returning();
  const [sharedEvidence] = await db.insert(evidenceItems).values({ title: "شاهد مشترك", kind: "text", textContent: "y" }).returning();

  const [year] = await db.insert(planYears).values({ key: "1448-1449", nameAr: "1448-1449" }).returning();
  const [program] = await db
    .insert(programs)
    .values({ planYearId: year.id, seq: 1, domain: "التعليم", name: "برنامج مشترك", ownerPersonId: person.id })
    .returning();
  const [activity] = await db
    .insert(programActivities)
    .values({ programId: program.id, name: "نشاط", ownerPersonId: person.id })
    .returning();

  await db.insert(evidenceLinks).values([
    { evidenceId: ownEvidence.id, entityType: "perf_session", entityId: sessionA.id },
    { evidenceId: sharedEvidence.id, entityType: "perf_session", entityId: sessionA.id },
    { evidenceId: sharedEvidence.id, entityType: "program", entityId: program.id },
  ]);

  const [tpl] = await db.insert(committeeTemplates).values({ key: "c-purge", nameAr: "لجنة", kind: "لجنة" }).returning();
  const [committee] = await db
    .insert(committees)
    .values({ templateId: tpl.id, planYearId: year.id, nameAr: "لجنة مشتركة", kind: "لجنة" })
    .returning();
  const [member] = await db.insert(committeeMembers).values({ committeeId: committee.id, personId: person.id, role: "عضو" }).returning();
  const [otherMember] = await db.insert(committeeMembers).values({ committeeId: committee.id, personId: other.id, role: "رئيس" }).returning();
  const [assignment] = await db
    .insert(committeeTaskAssignments)
    .values({ committeeId: committee.id, title: "مهمة اللجنة", assignedMemberId: member.id })
    .returning();

  const [task] = await db.insert(actionTasks).values({ title: "مهمة مؤسسية", ownerPersonId: person.id }).returning();
  const [issue] = await db
    .insert(maintenanceIssues)
    .values({ code: "KHS-MNT-9001", title: "بلاغ", ownerPersonId: person.id })
    .returning();
  const [item] = await db.insert(financialItems).values({ nameAr: "بند" }).returning();
  const [expense] = await db
    .insert(budgetExpenses)
    .values({ planYearId: year.id, financialItemId: item.id, amount: "100", responsiblePersonId: person.id })
    .returning();

  return {
    person, other, linkedUser, cycleA, cycleB, otherCycle, sessionA, sessionB, doc,
    ownEvidence, sharedEvidence, program, activity, committee, member, otherMember,
    assignment, task, issue, expense,
  };
}

describe("§5.3 — معاينة أثر حذف المنسوب", () => {
  it("تعدّ المملوك والمشترك بدقة وتسمّي كلاً منهما", async () => {
    const s = await seedEmployeeLifecycle();
    const { assessPersonDeletion } = await import("@/lib/lifecycle-delete");
    const impact = (await assessPersonDeletion(s.person.id))!;

    const owned = Object.fromEntries(impact.owned.map((l) => [l.type, l.count]));
    expect(owned.perf_cycles).toBe(2);
    expect(owned.perf_sessions).toBe(2);
    expect(owned.perf_ratings).toBe(2);
    expect(owned.improvement_plans).toBe(1);
    expect(owned.documents).toBe(1);

    const shared = Object.fromEntries(impact.shared.map((l) => [l.type, l.count]));
    expect(shared.committee_members).toBe(1);
    expect(shared.programs).toBe(1);
    expect(shared.program_activities).toBe(1);
    expect(shared.action_tasks).toBe(1);
    expect(shared.maintenance_issues).toBe(1);
    expect(shared.budget_expenses).toBe(1);
    expect(shared.users).toBe(1);

    // المرجع التعريفي آمن: اسم ورقم وظيفي وفئة — بلا أي محتوى تقييمي
    expect(impact.displayRef).toContain("منسوب تجريبي للحذف");
    expect(impact.displayRef).toContain("T-9001");
    expect(impact.displayRef).not.toContain("ملاحظة تقييم حساسة");
  });
});

describe("§5.3 — الحراسات تفشل مغلقة", () => {
  it("الاسم المكتوب الخاطئ يُرفض ولا يُحذف شيء", async () => {
    const s = await seedEmployeeLifecycle();
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    const res = await deletePersonPermanently({ personId: s.person.id, actorId, reason: "سبب كافٍ للحذف", typedName: "اسم خاطئ" });
    expect(res.error).toBeTruthy();

    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    expect(await db.select().from(people).where(eq(people.id, s.person.id))).toHaveLength(1);
  });

  it("السبب الناقص يُرفض", async () => {
    const s = await seedEmployeeLifecycle();
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    const res = await deletePersonPermanently({ personId: s.person.id, actorId, reason: "قصير", typedName: s.person.fullName });
    expect(res.error).toContain("سبب");
  });

  it("المستخدم لا يحذف المنسوب المرتبط بحسابه الحالي", async () => {
    const s = await seedEmployeeLifecycle();
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    const res = await deletePersonPermanently({
      personId: s.person.id,
      actorId: s.linkedUser.id,
      reason: "محاولة حذف الذات",
      typedName: s.person.fullName,
    });
    expect(res.error).toContain("حسابك الحالي");
  });

  it("آخر حساب فعّال يملك إدارة المستخدمين لا يُعطَّل بالحذف", async () => {
    const s = await seedEmployeeLifecycle();
    const { db } = await import("@/db");
    const { roles, permissions, rolePermissions, userRoles } = await import("@/db/schema");
    const [role] = await db.insert(roles).values({ key: "principal", nameAr: "مدير" }).returning();
    const [perm] = await db.insert(permissions).values({ key: "admin.users", nameAr: "إدارة المستخدمين", module: "admin" }).returning();
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id });
    await db.insert(userRoles).values({ userId: s.linkedUser.id, roleId: role.id });

    const { assessPersonDeletion, deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    const impact = (await assessPersonDeletion(s.person.id))!;
    expect(impact.blockers.join(" ")).toContain("آخر حساب فعّال");

    const res = await deletePersonPermanently({ personId: s.person.id, actorId, reason: "سبب كافٍ للحذف", typedName: s.person.fullName });
    expect(res.error).toBeTruthy();
  });
});

describe("§5.3 — التنفيذ: المملوك يُمحى والمشترك يبقى", () => {
  it("يمحو دورة الحياة كاملةً ويحافظ على كل سجل مؤسسي", async () => {
    const s = await seedEmployeeLifecycle();
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    const res = await deletePersonPermanently({
      personId: s.person.id,
      actorId,
      reason: "انتهاء الخدمة وطلب حذف السجل",
      typedName: s.person.fullName,
    });
    expect(res.error).toBeUndefined();
    expect(res.success).toBeTruthy();

    const { db } = await import("@/db");
    const {
      people, perfCycles, perfSessions, perfRatings, improvementPlans, documents,
      evidenceItems, evidenceLinks, committees, committeeMembers, committeeTaskAssignments,
      programs, programActivities, actionTasks, maintenanceIssues, budgetExpenses,
      users, deletionTombstones, personStages,
    } = await import("@/db/schema");

    // ── المملوك: لا شيء متبقٍّ ──────────────────────────────────────────
    expect(await db.select().from(people).where(eq(people.id, s.person.id))).toHaveLength(0);
    expect(await db.select().from(perfCycles).where(eq(perfCycles.personId, s.person.id))).toHaveLength(0);
    expect(await db.select().from(perfSessions).where(eq(perfSessions.cycleId, s.cycleA.id))).toHaveLength(0);
    expect(await db.select().from(perfRatings).where(eq(perfRatings.sessionId, s.sessionA.id))).toHaveLength(0);
    expect(await db.select().from(improvementPlans).where(eq(improvementPlans.cycleId, s.cycleA.id))).toHaveLength(0);
    expect(await db.select().from(documents).where(eq(documents.id, s.doc.id))).toHaveLength(0);
    expect(await db.select().from(personStages).where(eq(personStages.personId, s.person.id))).toHaveLength(0);

    // ── الشواهد: الخاص يُمحى والمشترك يبقى بروابطه الأخرى ───────────────
    expect(await db.select().from(evidenceItems).where(eq(evidenceItems.id, s.ownEvidence.id))).toHaveLength(0);
    expect(await db.select().from(evidenceItems).where(eq(evidenceItems.id, s.sharedEvidence.id))).toHaveLength(1);
    const remainingLinks = await db.select().from(evidenceLinks).where(eq(evidenceLinks.evidenceId, s.sharedEvidence.id));
    expect(remainingLinks).toHaveLength(1);
    expect(remainingLinks[0].entityType).toBe("program");

    // ── المشترك: السجل الأب باقٍ والصلة مفكوكة ─────────────────────────
    expect(await db.select().from(committees).where(eq(committees.id, s.committee.id))).toHaveLength(1);
    expect(await db.select().from(committeeMembers).where(eq(committeeMembers.id, s.member.id))).toHaveLength(0);
    expect(await db.select().from(committeeMembers).where(eq(committeeMembers.id, s.otherMember.id))).toHaveLength(1);
    // المهمة تبقى قائمة بلا مكلَّف — لا تُحذف مع العضوية
    const [assignment] = await db.select().from(committeeTaskAssignments).where(eq(committeeTaskAssignments.id, s.assignment.id));
    expect(assignment).toBeTruthy();
    expect(assignment.assignedMemberId).toBeNull();

    const [program] = await db.select().from(programs).where(eq(programs.id, s.program.id));
    expect(program.ownerPersonId).toBeNull();
    const [activity] = await db.select().from(programActivities).where(eq(programActivities.id, s.activity.id));
    expect(activity.ownerPersonId).toBeNull();
    const [task] = await db.select().from(actionTasks).where(eq(actionTasks.id, s.task.id));
    expect(task.ownerPersonId).toBeNull();
    const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, s.issue.id));
    expect(issue.ownerPersonId).toBeNull();
    const [expense] = await db.select().from(budgetExpenses).where(eq(budgetExpenses.id, s.expense.id));
    expect(expense.responsiblePersonId).toBeNull();

    // ── حساب الدخول: يُعطَّل ويُفكّ لا يُحذف (سجل التدقيق يشير إليه) ────
    const [account] = await db.select().from(users).where(eq(users.id, s.linkedUser.id));
    expect(account).toBeTruthy();
    expect(account.active).toBe(false);
    expect(account.personId).toBeNull();

    // ── منسوب آخر ودورته لم تُمسّا ──────────────────────────────────────
    expect(await db.select().from(people).where(eq(people.id, s.other.id))).toHaveLength(1);
    expect(await db.select().from(perfCycles).where(eq(perfCycles.id, s.otherCycle.id))).toHaveLength(1);

    // ── الشاهد التدقيقي: مكتوب وبلا محتوى تقييمي ────────────────────────
    const [tomb] = await db.select().from(deletionTombstones).where(eq(deletionTombstones.entityId, s.person.id));
    expect(tomb).toBeTruthy();
    expect(tomb.entityType).toBe("person");
    expect(tomb.actorId).toBe(actorId);
    expect(tomb.reason).toBe("انتهاء الخدمة وطلب حذف السجل");
    expect(tomb.displayRef).toContain("منسوب تجريبي للحذف");
    expect(tomb.counts?.perf_cycles).toBe(2);
    const serialized = JSON.stringify(tomb);
    expect(serialized).not.toContain("ملاحظة تقييم حساسة");
    expect(serialized).not.toContain("خطة تحسين");
  });

  it("لا تبقى صفوف يتيمة تشير إلى المنسوب المحذوف", async () => {
    const s = await seedEmployeeLifecycle();
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    await deletePersonPermanently({ personId: s.person.id, actorId, reason: "تنظيف السجل التجريبي", typedName: s.person.fullName });

    // فحص شامل: أي عمود يشير إلى الأشخاص لا يحمل المعرّف المحذوف
    const columns = [
      ["perf_cycles", "person_id"],
      ["person_stages", "person_id"],
      ["committee_members", "person_id"],
      ["programs", "owner_person_id"],
      ["program_activities", "owner_person_id"],
      ["action_tasks", "owner_person_id"],
      ["maintenance_issues", "owner_person_id"],
      ["inspection_findings", "responsible_person_id"],
      ["budget_expenses", "responsible_person_id"],
      ["users", "person_id"],
    ] as const;
    for (const [table, column] of columns) {
      const { rows } = await pool.query(`SELECT count(*)::int AS c FROM ${table} WHERE ${column} = $1`, [s.person.id]);
      expect({ table, count: rows[0].c }).toEqual({ table, count: 0 });
    }
  });

  it("فشل داخل المعاملة يتراجع بالكامل — لا حذف جزئي", async () => {
    const s = await seedEmployeeLifecycle();
    const { db } = await import("@/db");

    // نجبر الفشل بعد بدء الحذف: قيد مؤقت يرفض حذف صفوف `people`
    await pool.query(`
      CREATE OR REPLACE FUNCTION t_block_person_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER t_block_person BEFORE DELETE ON people
      FOR EACH ROW EXECUTE FUNCTION t_block_person_delete();
    `);
    try {
      const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
      await expect(
        deletePersonPermanently({ personId: s.person.id, actorId, reason: "اختبار التراجع الكامل", typedName: s.person.fullName }),
      ).rejects.toThrow();
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS t_block_person ON people; DROP FUNCTION IF EXISTS t_block_person_delete();");
    }

    // كل شيء كما كان: الدورات والجلسات والوثيقة والعضوية والشاهد التدقيقي غائب
    const { perfCycles, perfSessions, documents, committeeMembers, deletionTombstones, people } = await import("@/db/schema");
    expect(await db.select().from(people).where(eq(people.id, s.person.id))).toHaveLength(1);
    expect(await db.select().from(perfCycles).where(eq(perfCycles.personId, s.person.id))).toHaveLength(2);
    expect(await db.select().from(perfSessions).where(eq(perfSessions.cycleId, s.cycleA.id))).toHaveLength(1);
    expect(await db.select().from(documents).where(eq(documents.id, s.doc.id))).toHaveLength(1);
    expect(await db.select().from(committeeMembers).where(eq(committeeMembers.id, s.member.id))).toHaveLength(1);
    expect(await db.select().from(deletionTombstones).where(eq(deletionTombstones.entityId, s.person.id))).toHaveLength(0);
  });
});

describe("§5.4 — حذف دورة أداء واحدة", () => {
  it("يمحو الدورة المختارة ويبقي الموظف ودوراته الأخرى", async () => {
    const s = await seedEmployeeLifecycle();
    const { assessCycleDeletion, deleteCyclePermanently } = await import("@/lib/lifecycle-delete");

    const impact = (await assessCycleDeletion(s.cycleA.id))!;
    expect(impact.confirmName).toBe("1448");
    const owned = Object.fromEntries(impact.owned.map((l) => [l.type, l.count]));
    expect(owned.perf_cycles).toBe(1);
    expect(owned.perf_sessions).toBe(1);
    expect(owned.perf_ratings).toBe(1);
    expect(owned.improvement_plans).toBe(1);
    expect(owned.documents).toBe(1);
    // المنسوب ودورته الأخرى مذكوران بوصفهما باقيين
    expect(impact.shared.map((l) => l.type)).toContain("other_cycles");

    const res = await deleteCyclePermanently({
      cycleId: s.cycleA.id,
      actorId,
      reason: "دورة أُنشئت بالخطأ للسنة الخاطئة",
      typedConfirm: "1448",
    });
    expect(res.error).toBeUndefined();

    const { db } = await import("@/db");
    const { people, perfCycles, perfSessions, perfRatings, improvementPlans, documents, deletionTombstones } = await import("@/db/schema");

    expect(await db.select().from(perfCycles).where(eq(perfCycles.id, s.cycleA.id))).toHaveLength(0);
    expect(await db.select().from(perfSessions).where(eq(perfSessions.id, s.sessionA.id))).toHaveLength(0);
    expect(await db.select().from(perfRatings).where(eq(perfRatings.sessionId, s.sessionA.id))).toHaveLength(0);
    expect(await db.select().from(improvementPlans).where(eq(improvementPlans.cycleId, s.cycleA.id))).toHaveLength(0);
    expect(await db.select().from(documents).where(eq(documents.id, s.doc.id))).toHaveLength(0);

    // الموظف باقٍ، ودورته الثانية بجلستها وتقديرها كما هي
    expect(await db.select().from(people).where(eq(people.id, s.person.id))).toHaveLength(1);
    expect(await db.select().from(perfCycles).where(eq(perfCycles.id, s.cycleB.id))).toHaveLength(1);
    expect(await db.select().from(perfSessions).where(eq(perfSessions.id, s.sessionB.id))).toHaveLength(1);
    expect(await db.select().from(perfRatings).where(eq(perfRatings.sessionId, s.sessionB.id))).toHaveLength(1);

    // والارتباطات المؤسسية لم تُمسّ إطلاقاً — حذف الدورة ليس حذف الموظف
    const { committeeMembers, programs } = await import("@/db/schema");
    expect(await db.select().from(committeeMembers).where(eq(committeeMembers.id, s.member.id))).toHaveLength(1);
    const [program] = await db.select().from(programs).where(eq(programs.id, s.program.id));
    expect(program.ownerPersonId).toBe(s.person.id);

    const [tomb] = await db.select().from(deletionTombstones).where(eq(deletionTombstones.entityId, s.cycleA.id));
    expect(tomb.entityType).toBe("perf_cycle");
    expect(tomb.reason).toBe("دورة أُنشئت بالخطأ للسنة الخاطئة");
    expect(JSON.stringify(tomb)).not.toContain("ملاحظة تقييم حساسة");
  });

  it("سنة الدورة الخاطئة تُرفض، والسبب الناقص يُرفض", async () => {
    const s = await seedEmployeeLifecycle();
    const { deleteCyclePermanently } = await import("@/lib/lifecycle-delete");
    expect((await deleteCyclePermanently({ cycleId: s.cycleA.id, actorId, reason: "سبب كافٍ للحذف", typedConfirm: "1449" })).error).toBeTruthy();
    expect((await deleteCyclePermanently({ cycleId: s.cycleA.id, actorId, reason: "لا", typedConfirm: "1448" })).error).toContain("سبب");

    const { db } = await import("@/db");
    const { perfCycles } = await import("@/db/schema");
    expect(await db.select().from(perfCycles).where(eq(perfCycles.id, s.cycleA.id))).toHaveLength(1);
  });

  it("الشاهد المشترك بين جلسة الدورة وبرنامج يبقى بعد حذف الدورة", async () => {
    const s = await seedEmployeeLifecycle();
    const { deleteCyclePermanently } = await import("@/lib/lifecycle-delete");
    await deleteCyclePermanently({ cycleId: s.cycleA.id, actorId, reason: "حذف دورة تجريبية", typedConfirm: "1448" });

    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks } = await import("@/db/schema");
    expect(await db.select().from(evidenceItems).where(eq(evidenceItems.id, s.sharedEvidence.id))).toHaveLength(1);
    expect(await db.select().from(evidenceItems).where(eq(evidenceItems.id, s.ownEvidence.id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(evidenceLinks)
        .where(and(eq(evidenceLinks.evidenceId, s.sharedEvidence.id), eq(evidenceLinks.entityType, "program"))),
    ).toHaveLength(1);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

/**
 * طبقة الحذف الآمن الموحّدة (نطاق المنتج v2 §2.3):
 * الحذف النهائي للسجل غير المستخدم فقط؛ وإلا أرشفة/إيقاف مع شرح عربي — ولا حذف تعاقبي.
 */
describe("الحذف الآمن الموحّد", () => {
  it("منسوب بلا أي إشارة: الحذف متاح", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");

    const [p] = await db.insert(people).values({ fullName: "منسوب بلا سجلات", category: "موظف" }).returning();
    const a = await assessDeletion("person", p.id);
    expect(a.blocked).toBe(false);
    expect(a.dependencies).toEqual([]);
    expect(a.messageAr).toContain("متاح");
  });

  it("يغطي كل مواضع الإشارة للمنسوب — لا مواضع منسية كما في الحارس القديم", async () => {
    const { db } = await import("@/db");
    const { people, planYears, programs, actionTasks, stages, personStages } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");

    // الحارس القديم كان يفحص دورات الأداء وعضويات اللجان فقط. هذه الحالات كانت تمر وتُحذف.
    const [owner] = await db.insert(people).values({ fullName: "مالك برنامج", category: "معلم" }).returning();
    const [year] = await db.insert(planYears).values({ key: "sd-yr", nameAr: "سنة" }).returning();
    await db.insert(programs).values({ planYearId: year.id, seq: 1, domain: "م", name: "برنامج", ownerPersonId: owner.id });
    const ownerCheck = await assessDeletion("person", owner.id);
    expect(ownerCheck.blocked).toBe(true);
    expect(ownerCheck.dependencies.map((d) => d.type)).toContain("programs");

    const [assignee] = await db.insert(people).values({ fullName: "مكلف بمهمة", category: "موظف" }).returning();
    await db.insert(actionTasks).values({ title: "مهمة", ownerPersonId: assignee.id });
    const taskCheck = await assessDeletion("person", assignee.id);
    expect(taskCheck.blocked).toBe(true);
    expect(taskCheck.dependencies.map((d) => d.type)).toContain("action_tasks");

    const [teacher] = await db.insert(people).values({ fullName: "معلم بمرحلة", category: "معلم" }).returning();
    const [stage] = await db.insert(stages).values({ key: "sd-primary", nameAr: "ابتدائي" }).returning();
    await db.insert(personStages).values({ personId: teacher.id, stageId: stage.id });
    const stageCheck = await assessDeletion("person", teacher.id);
    expect(stageCheck.blocked).toBe(true);
    expect(stageCheck.dependencies.map((d) => d.type)).toContain("person_stages");
  });

  it("الشرح العربي يذكر نوع التبعية وعددها والبديل المتاح", async () => {
    const { db } = await import("@/db");
    const { people, perfCycles, perfModels } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");

    const [p] = await db.insert(people).values({ fullName: "معلم بدورة", category: "معلم" }).returning();
    const [model] = await db
      .insert(perfModels)
      .values({ key: "sd-model", nameAr: "نموذج اختبار", audience: "معلم" })
      .returning();
    await db.insert(perfCycles).values({
      personId: p.id,
      yearKey: "1448-1449",
      cycleType: "معلم",
      modelId: model.id,
      modelSnapshot: { key: model.key, nameAr: model.nameAr, indicators: [] },
    });

    const a = await assessDeletion("person", p.id);
    expect(a.blocked).toBe(true);
    expect(a.messageAr).toContain("دورات تقييم أداء");
    expect(a.messageAr).toContain("(1)");
    expect(a.alternativeAr).toContain("أوقف");
  });

  it("برنامج له معالم ومخرجات: يُمنع حذفه ولا يُحذف أي سجل تابع", async () => {
    const { db } = await import("@/db");
    const { planYears, programs, programMilestones, programDeliverables } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");
    const { eq } = await import("drizzle-orm");

    const [year] = await db.insert(planYears).values({ key: "sd-yr2", nameAr: "سنة" }).returning();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 2, domain: "م", name: "برنامج تابع" }).returning();
    await db.insert(programMilestones).values({ programId: prog.id, title: "معلم", weight: 100 });
    await db.insert(programDeliverables).values({ programId: prog.id, mainOutput: "مخرج" });

    const a = await assessDeletion("program", prog.id);
    expect(a.blocked).toBe(true);
    const types = a.dependencies.map((d) => d.type);
    expect(types).toContain("milestones");
    expect(types).toContain("deliverables");

    // التقييم قراءة محضة — لا يحذف شيئاً
    expect((await db.select().from(programMilestones).where(eq(programMilestones.programId, prog.id))).length).toBe(1);
  });

  it("قالب اللجان المستخدم في تشكيل: يُمنع الحذف ويُقترح التعطيل", async () => {
    const { db } = await import("@/db");
    const { committeeTemplates, committees, planYears } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");

    const [tpl] = await db
      .insert(committeeTemplates)
      .values({ key: "sd-tpl", nameAr: "قالب", kind: "لجنة" })
      .returning();
    const [year] = await db.insert(planYears).values({ key: "sd-yr3", nameAr: "سنة" }).returning();

    const unused = await assessDeletion("committee_template", tpl.id);
    expect(unused.blocked).toBe(false);

    await db.insert(committees).values({ templateId: tpl.id, planYearId: year.id, nameAr: "تشكيل", kind: "لجنة" });
    const used = await assessDeletion("committee_template", tpl.id);
    expect(used.blocked).toBe(true);
    expect(used.alternativeAr).toContain("عطّل");
  });

  it("الشواهد المرتبطة تُحسب كتبعية لأي سجل — الشاهد المشترك يحمي السجلات جميعاً", async () => {
    const { db } = await import("@/db");
    const { planYears, programs, evidenceItems } = await import("@/db/schema");
    const { assessDeletion } = await import("@/lib/safe-delete");
    const { linkEvidence } = await import("@/lib/evidence");

    const [year] = await db.insert(planYears).values({ key: "sd-yr4", nameAr: "سنة" }).returning();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 3, domain: "م", name: "برنامج بشاهد" }).returning();
    const [ev] = await db.insert(evidenceItems).values({ title: "شاهد مشترك", kind: "text", textContent: "ن" }).returning();
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: prog.id });

    const a = await assessDeletion("program", prog.id);
    expect(a.dependencies.find((d) => d.type === "evidence_links")?.count).toBe(1);
  });
});

describe("دورة حياة الشاهد: النسخ والأرشفة", () => {
  it("الأرشفة تخفي الشاهد عن السجل دون حذف أي رابط، والاستعادة تعيده", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks, planYears, programs } = await import("@/db/schema");
    const { linkEvidence, evidenceForEntity } = await import("@/lib/evidence");
    const { eq } = await import("drizzle-orm");

    const [year] = await db.insert(planYears).values({ key: "arch-yr", nameAr: "سنة" }).returning();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 9, domain: "م", name: "برنامج أرشفة" }).returning();
    const [ev] = await db.insert(evidenceItems).values({ title: "شاهد يُؤرشف", kind: "text", textContent: "ن" }).returning();
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: prog.id });

    expect((await evidenceForEntity("program", prog.id)).length).toBe(1);

    await db.update(evidenceItems).set({ archivedAt: new Date(), archivedReason: "نسخة قديمة" }).where(eq(evidenceItems.id, ev.id));

    // مخفي افتراضياً، والرابط لم يُمس
    expect((await evidenceForEntity("program", prog.id)).length).toBe(0);
    expect((await evidenceForEntity("program", prog.id, { includeArchived: true })).length).toBe(1);
    expect((await db.select().from(evidenceLinks).where(eq(evidenceLinks.evidenceId, ev.id))).length).toBe(1);

    await db.update(evidenceItems).set({ archivedAt: null, archivedReason: null }).where(eq(evidenceItems.id, ev.id));
    expect((await evidenceForEntity("program", prog.id)).length).toBe(1);
  });

  it("«مستخدم في» يعرض كل السجلات التي يخدمها الشاهد الواحد عبر الوحدات", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, planYears, programs, committees } = await import("@/db/schema");
    const { linkEvidence, evidenceUsage } = await import("@/lib/evidence");

    const [year] = await db.insert(planYears).values({ key: "use-yr", nameAr: "سنة" }).returning();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 21, domain: "م", name: "برنامج مشترك" }).returning();
    const [cm] = await db.insert(committees).values({ planYearId: year.id, nameAr: "لجنة مشتركة", kind: "لجنة" }).returning();
    const [ev] = await db.insert(evidenceItems).values({ title: "محضر مشترك", kind: "text", textContent: "ن" }).returning();

    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: prog.id });
    await linkEvidence({ evidenceId: ev.id, entityType: "committee", entityId: cm.id });

    const usage = await evidenceUsage(ev.id);
    const types = usage.map((u) => u.entityType).sort();
    expect(types).toEqual(["committee", "program"]);
    expect(usage.flatMap((u) => u.refs).map((r) => r.labelAr).sort()).toEqual(["برنامج مشترك", "لجنة مشتركة"]);
  });

  it("سجل النسخ يحفظ المحتوى السابق ولا يمس أي رابط", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, evidenceVersions, evidenceLinks, planYears, programs } = await import("@/db/schema");
    const { linkEvidence } = await import("@/lib/evidence");
    const { eq } = await import("drizzle-orm");

    const [year] = await db.insert(planYears).values({ key: "ver-yr", nameAr: "سنة" }).returning();
    const [prog] = await db.insert(programs).values({ planYearId: year.id, seq: 31, domain: "م", name: "برنامج نسخ" }).returning();
    const [ev] = await db.insert(evidenceItems).values({ title: "شاهد يُستبدل", kind: "text", textContent: "النسخة الأولى" }).returning();
    await linkEvidence({ evidenceId: ev.id, entityType: "program", entityId: prog.id });

    // محاكاة الاستبدال كما ينفذه الإجراء: لقطة للنسخة السابقة ثم تحديث الشاهد نفسه
    await db.transaction(async (tx) => {
      await tx.insert(evidenceVersions).values({
        evidenceId: ev.id,
        version: ev.version,
        kind: ev.kind,
        textContent: ev.textContent,
        title: ev.title,
        reason: "تحديث المحتوى",
      });
      await tx
        .update(evidenceItems)
        .set({ textContent: "النسخة الثانية", version: ev.version + 1, reviewStatus: "لم يراجع" })
        .where(eq(evidenceItems.id, ev.id));
    });

    const [updated] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, ev.id));
    expect(updated.version).toBe(2);
    expect(updated.textContent).toBe("النسخة الثانية");
    expect(updated.reviewStatus).toBe("لم يراجع");

    const versions = await db.select().from(evidenceVersions).where(eq(evidenceVersions.evidenceId, ev.id));
    expect(versions.length).toBe(1);
    expect(versions[0].textContent).toBe("النسخة الأولى");

    // معرّف الشاهد لم يتغير، فالرابط باقٍ كما هو
    expect((await db.select().from(evidenceLinks).where(eq(evidenceLinks.evidenceId, ev.id))).length).toBe(1);
  });
});

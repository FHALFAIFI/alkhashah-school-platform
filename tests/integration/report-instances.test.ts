import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.6 §A/§B — دورة حياة التقرير المحفوظ وثبات لقطته (D-055).
 *
 * العقود المثبَّتة هنا هي شروط الإطلاق حرفياً:
 *  1. المسودة وحدها تُعدَّل وتُحذف؛ النهائي يرفض الاثنين في **الخدمة والقاعدة معاً**.
 *  2. الاعتماد معاملة متكرّرة التنفيذ بأمان: نقرتان لا تمنحان رقمين.
 *  3. الأرقام تتوالى ولا تتصادم ولا تُمنح لمسودة.
 *  4. **اللقطة لا تتغير بتغيّر البيانات المصدر بعد الاعتماد** — جوهر §B.
 *  5. المرشّحات معزولة: ما خرج عن النطاق لا يدخل اللقطة، ولو كان سجلاً شقيقاً.
 *  6. التقرير الحسّاس لا يظهر لمن لا يملك الصلاحية الفردية (D-013).
 */

let pool: Pool;
let userId = "";
let yearId = "";
let seq = 1;

const FULL = new Set([
  "reports.read",
  "reports.builder",
  "reports.generate",
  "documents.issue",
  "plan.read",
  "performance.read",
  "performance.individual.read",
]);

const viewer = (perms: Set<string> = FULL) => ({ id: userId, permissions: perms });

async function seedProgram(name: string, domain = "التعليم والتعلم") {
  const { db } = await import("@/db");
  const { programs } = await import("@/db/schema");
  const [p] = await db
    .insert(programs)
    .values({ planYearId: yearId, seq: seq++, domain, name, status: "معتمد" })
    .returning();
  return p;
}

async function draftOn(reportKey: string, extra?: Record<string, unknown>) {
  const { createInstance } = await import("@/lib/reports/instances/service");
  const result = await createInstance(
    {
      title: `تقرير اختبار ${seq}`,
      typeKey: "single",
      options: { reportKey },
      ...extra,
    },
    viewer(),
  );
  expect(result.error).toBeUndefined();
  return result.instanceId!;
}

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-inst", displayName: "اختبار", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "inst-yr", nameAr: "سنة التقارير", status: "نشطة" }).returning();
  yearId = y.id;
  await seedProgram("برنامج القراءة اليومية");
  await seedProgram("برنامج الأمن الرقمي", "البيئة المدرسية");
});

afterAll(async () => {
  await pool.end();
});

describe("§A — دورة الحياة", () => {
  it("المسودة تُنشأ وتُعدَّل وتُحذف؛ ولا رقم لها", async () => {
    const { getInstance, updateInstance, deleteDraft } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active");
    const row = await getInstance(id, viewer());
    expect(row!.status).toBe("مسودة");
    expect(row!.reportNumber).toBeNull();
    expect(row!.snapshot).toBeNull();

    const updated = await updateInstance(id, { title: "عنوان جديد", typeKey: "single", options: { reportKey: "programs-active" } }, viewer());
    expect(updated.error).toBeUndefined();

    const deleted = await deleteDraft(id, viewer());
    expect(deleted.error).toBeUndefined();
    expect(await getInstance(id, viewer())).toBeNull();
  });

  it("الاعتماد يمنح رقماً ويجمّد لقطة، وتكراره يعيد الرقم نفسه لا رقماً ثانياً", async () => {
    const { finalizeInstance, getInstance } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active");

    const first = await finalizeInstance(id, viewer());
    expect(first.error).toBeUndefined();
    expect(first.reportNumber).toMatch(/^KHS-RPT-\d{4}-\d{4}$/);

    const second = await finalizeInstance(id, viewer());
    expect(second.error).toBeUndefined();
    expect(second.reportNumber).toBe(first.reportNumber);

    const row = await getInstance(id, viewer());
    expect(row!.status).toBe("نهائي");
    expect(row!.snapshot).toBeTruthy();
    expect((row!.snapshot as { version: number }).version).toBe(1);
  });

  it("رقمان متتاليان لتقريرين متتاليين — لا فجوة ولا تصادم", async () => {
    const { finalizeInstance } = await import("@/lib/reports/instances/service");
    const a = await finalizeInstance(await draftOn("programs-active"), viewer());
    const b = await finalizeInstance(await draftOn("programs-active"), viewer());
    const numOf = (s?: string) => Number(s!.split("-").pop());
    expect(numOf(b.reportNumber)).toBe(numOf(a.reportNumber) + 1);
  });

  it("النهائي يرفض التعديل والحذف في الخدمة", async () => {
    const { finalizeInstance, updateInstance, deleteDraft } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active");
    await finalizeInstance(id, viewer());

    const upd = await updateInstance(id, { title: "عبث", typeKey: "single", options: { reportKey: "programs-active" } }, viewer());
    expect(upd.error).toContain("لا يُعدَّل");
    const del = await deleteDraft(id, viewer());
    expect(del.error).toBeTruthy();
  });

  it("النهائي يرفض التعديل والحذف في القاعدة نفسها — القادح لا الخدمة", async () => {
    const { finalizeInstance } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active");
    await finalizeInstance(id, viewer());

    await expect(pool.query(`UPDATE report_instances SET title = 'عبث مباشر' WHERE id = $1`, [id])).rejects.toThrow(/D-055/);
    await expect(pool.query(`UPDATE report_instances SET snapshot = '{"v":9}' WHERE id = $1`, [id])).rejects.toThrow(/D-055/);
    await expect(pool.query(`UPDATE report_instances SET status = 'مسودة' WHERE id = $1`, [id])).rejects.toThrow(/D-055/);
    await expect(pool.query(`DELETE FROM report_instances WHERE id = $1`, [id])).rejects.toThrow(/D-055/);
  });

  it("النسخة الجديدة تقرير جديد يشير إلى أصله ويأخذ رقماً مختلفاً", async () => {
    const { finalizeInstance, newVersion, getInstance } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active");
    const original = await finalizeInstance(id, viewer());

    const version = await newVersion(id, viewer());
    expect(version.error).toBeUndefined();
    const copy = await getInstance(version.instanceId!, viewer());
    expect(copy!.status).toBe("مسودة");
    expect(copy!.versionOfId).toBe(id);
    expect(copy!.reportNumber).toBeNull();

    const finalized = await finalizeInstance(version.instanceId!, viewer());
    expect(finalized.reportNumber).not.toBe(original.reportNumber);
  });

  it("الأرشفة تحويل حالة لا يمسّ المحتوى، والاستعادة تعيدها", async () => {
    const { finalizeInstance, archiveInstance, unarchiveInstance, getInstance } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active");
    await finalizeInstance(id, viewer());
    const before = await getInstance(id, viewer());

    const archived = await archiveInstance(id, viewer());
    expect(archived.error).toBeUndefined();
    const after = await getInstance(id, viewer());
    expect(after!.status).toBe("مؤرشف");
    expect(after!.snapshot).toEqual(before!.snapshot);
    expect(after!.reportNumber).toBe(before!.reportNumber);

    const restored = await unarchiveInstance(id, viewer());
    expect(restored.error).toBeUndefined();
    expect((await getInstance(id, viewer()))!.status).toBe("نهائي");
  });
});

describe("§B — ثبات اللقطة", () => {
  it("تغيير البيانات المصدر بعد الاعتماد لا يغيّر اللقطة حرفاً واحداً", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { finalizeInstance, getInstance, instanceDocument } = await import("@/lib/reports/instances/service");

    const target = await seedProgram("برنامج سيُعاد تسميته");
    const id = await draftOn("programs-active");
    await finalizeInstance(id, viewer());
    const frozen = JSON.stringify((await getInstance(id, viewer()))!.snapshot);
    expect(frozen).toContain("برنامج سيُعاد تسميته");

    // البيانات المصدر تتغير بعد الاعتماد
    await db.update(programs).set({ name: "اسم جديد تماماً" }).where(eq(programs.id, target.id));

    const rowAfter = (await getInstance(id, viewer()))!;
    expect(JSON.stringify(rowAfter.snapshot)).toBe(frozen);
    const doc = await instanceDocument(rowAfter, viewer());
    const docText = JSON.stringify(doc);
    expect(docText).toContain("برنامج سيُعاد تسميته");
    expect(docText).not.toContain("اسم جديد تماماً");

    // التنظيف: إعادة الاسم كي لا يتسرّب إلى اختبارات لاحقة
    await db.update(programs).set({ name: "برنامج سيُعاد تسميته" }).where(eq(programs.id, target.id));
  });

  it("المسودة على العكس تقرأ البيانات الحية عند كل معاينة", async () => {
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { getInstance, instanceDocument } = await import("@/lib/reports/instances/service");

    const target = await seedProgram("برنامج المعاينة الحية");
    const id = await draftOn("programs-active");
    const doc1 = await instanceDocument((await getInstance(id, viewer()))!, viewer());
    expect(JSON.stringify(doc1)).toContain("برنامج المعاينة الحية");

    await db.update(programs).set({ name: "برنامج المعاينة المتجددة" }).where(eq(programs.id, target.id));
    const doc2 = await instanceDocument((await getInstance(id, viewer()))!, viewer());
    expect(JSON.stringify(doc2)).toContain("برنامج المعاينة المتجددة");
  });
});

describe("§C/§D — عزل المرشّحات والحساسية", () => {
  it("مرشّح البحث يعزل: ما خرج عن النطاق لا يدخل اللقطة", async () => {
    const { finalizeInstance, getInstance } = await import("@/lib/reports/instances/service");
    const id = await draftOn("programs-active", {
      filters: { search: "القراءة اليومية" },
    });
    await finalizeInstance(id, viewer());
    const text = JSON.stringify((await getInstance(id, viewer()))!.snapshot);
    expect(text).toContain("برنامج القراءة اليومية");
    expect(text).not.toContain("برنامج الأمن الرقمي");
  });

  it("التقرير الحسّاس لا يظهر لمن لا يملك الصلاحية الفردية — قائمةً وقراءةً (D-013)", async () => {
    const { createInstance, getInstance, searchInstances } = await import("@/lib/reports/instances/service");
    const created = await createInstance(
      { title: "تقرير أداء حسّاس", typeKey: "single", options: { reportKey: "perf-results" } },
      viewer(),
    );
    expect(created.error).toBeUndefined();

    const limited = new Set([...FULL].filter((p) => p !== "performance.individual.read"));
    expect(await getInstance(created.instanceId!, viewer(limited))).toBeNull();
    const list = await searchInstances({}, viewer(limited));
    expect(list.rows.map((r) => r.id)).not.toContain(created.instanceId);
    // ومن يملكها يراه
    expect(await getInstance(created.instanceId!, viewer())).toBeTruthy();
  });

  it("من لا يملك صلاحية قسمٍ ما لا يستطيع إنشاء تقرير يحويه", async () => {
    const { createInstance } = await import("@/lib/reports/instances/service");
    const limited = new Set(["reports.read", "reports.builder", "documents.issue"]);
    const refused = await createInstance(
      { title: "تجاوز", typeKey: "single", options: { reportKey: "perf-results" } },
      viewer(limited),
    );
    expect(refused.error).toBeTruthy();
  });
});

describe("§B — البحث في الأرشيف", () => {
  it("البحث بالعنوان والرقم والحالة يجد التقرير", async () => {
    const { createInstance, finalizeInstance, searchInstances } = await import("@/lib/reports/instances/service");
    const created = await createInstance(
      { title: "التقرير الختامي للعام 1448", typeKey: "single", options: { reportKey: "programs-active" } },
      viewer(),
    );
    const fin = await finalizeInstance(created.instanceId!, viewer());

    const byTitle = await searchInstances({ search: "الختامي للعام" }, viewer());
    expect(byTitle.rows.map((r) => r.id)).toContain(created.instanceId);

    const byNumber = await searchInstances({ search: fin.reportNumber! }, viewer());
    expect(byNumber.rows.map((r) => r.id)).toContain(created.instanceId);

    const drafts = await searchInstances({ statuses: ["مسودة"] }, viewer());
    expect(drafts.rows.map((r) => r.id)).not.toContain(created.instanceId);
  });
});

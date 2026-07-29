import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import AdmZip from "adm-zip";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";
import { syntheticPlanWorkbook } from "../helpers/fixtures";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * يحاكي مصنفات المولد الرسمي (‎.NET/OpenXML): يعيد كتابة أجزاء XML الرئيسية
 * ببادئة نطاق أسماء <x:...> ويكرر نطاق دمج — وهو ما كانت exceljs ترفضه.
 */
function prefixedWorkbook(data: Buffer): Buffer {
  const zip = new AdmZip(data);
  for (const entry of zip.getEntries()) {
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(entry.entryName)) continue;
    let xml = entry.getData().toString("utf8");
    xml = xml.replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, "<$1x:$2");
    xml = xml.replace(`xmlns="${MAIN_NS}"`, `xmlns:x="${MAIN_NS}"`);
    if (entry.entryName.startsWith("xl/worksheets/")) {
      // نطاق دمج مكرر كما في الملفات الرسمية
      xml = xml.replace("</x:worksheet>", '<x:mergeCells count="2"><x:mergeCell ref="A1:B1" /><x:mergeCell ref="A1:B1" /></x:mergeCells></x:worksheet>');
    }
    zip.updateFile(entry.entryName, Buffer.from(xml, "utf8"));
  }
  return zip.toBuffer();
}

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("استيراد الخطة التشغيلية (A9, A10)", () => {
  it("يخزن القيم الرسمية حرفياً دون تعديل — بما فيها 1449/1/5", async () => {
    const { parsePlanWorkbook, commitPlanRows, rollbackPlanBatch, deriveMilestones } = await import("@/lib/imports/plan");
    const { createBatch, commitBatch, rollbackBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, programs, programActivities, programKpis, planYears } = await import("@/db/schema");

    const [u] = await db.insert(users).values({ username: "t-plan", displayName: "اختبار", passwordHash: "x" }).returning();

    const buf = await syntheticPlanWorkbook();
    const { rows, summary } = await parsePlanWorkbook(buf);
    expect(summary["برامج"]).toBe(2);
    expect(summary["مؤشرات"]).toBe(1);

    const batch = await createBatch({ importType: "operational_plan", sourceFileName: "plan-fixture.xlsx", rows, createdBy: u.id });
    await commitBatch(batch.id, u.id, (tx, ready) =>
      commitPlanRows(tx, ready, batch.id, { planYearKey: "test-1448", planYearName: "سنة اختبار", createdBy: u.id }),
    );

    const progs = await db.select().from(programs);
    expect(progs.length).toBe(2);
    const p1 = progs.find((p) => p.seq === 1)!;
    // القيم الرسمية حرفياً
    expect(p1.hijriStart).toBe("1448/3/2");
    expect(p1.hijriEnd).toBe("1449/1/5");
    expect(p1.name).toBe("برنامج تجريبي أول");
    expect(p1.status).toBe("مسودة");

    // الاستيراد لم يعد يُنشئ أنشطة (D-024) — البرنامج نفسه وحدة التنفيذ والمتابعة
    const acts = await db.select().from(programActivities).where(eq(programActivities.programId, p1.id));
    expect(acts.length).toBe(0);

    const kpis = await db.select().from(programKpis);
    expect(kpis[0].code).toBe("مؤشر-01");

    // التراجع الكامل
    await rollbackBatch(batch.id, u.id, (tx) => rollbackPlanBatch(tx, batch.id));
    expect((await db.select().from(programs)).length).toBe(0);
    expect((await db.select().from(programKpis)).length).toBe(0);
  });

  it("اشتقاق المعالم يوزع الأوزان بالتساوي والباقي للأول", async () => {
    const { deriveMilestones } = await import("@/lib/imports/plan");
    const three = deriveMilestones("أ؛ ب؛ ج");
    expect(three.map((m) => m.weight)).toEqual([34, 33, 33]);
    expect(deriveMilestones("")).toEqual([]);
  });
});

/**
 * التحليل الرباعي (SWOT) — ورقة رسمية موجودة في مصنف الخطة ولم تكن تُستورد.
 * البيانات تُحفظ حرفياً، والرمز مفتاح فريد داخل السنة يمنع التكرار عند إعادة الاستيراد.
 */
describe("استيراد التحليل الرباعي", () => {
  it("يقرأ الأنواع الأربعة ويتجاهل التكرار والنوع غير المعروف", async () => {
    const { parsePlanWorkbook } = await import("@/lib/imports/plan");
    const { summary, rows } = await parsePlanWorkbook(await syntheticPlanWorkbook());
    expect(summary["عناصر التحليل الرباعي"]).toBe(4);
    const swot = rows.filter((r) => r.mapped.rowType === "swot");
    expect(swot.map((r) => r.mapped.category)).toEqual(["قوة", "ضعف", "فرصة", "تهديد"]);
    // الصف المكرر والنوع غير المعروف لم يمرّا
    expect(swot.filter((r) => r.mapped.code === "قوة-01")).toHaveLength(1);
    expect(swot.some((r) => r.mapped.code === "س-01")).toBe(false);
  });

  it("يحفظ النص الرسمي حرفياً ويُرجعه التراجع", async () => {
    const { parsePlanWorkbook, commitPlanRows, rollbackPlanBatch } = await import("@/lib/imports/plan");
    const { createBatch, commitBatch, rollbackBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, planSwotItems } = await import("@/db/schema");
    await truncateAll(pool);

    const [u] = await db.insert(users).values({ username: "t-swot", displayName: "اختبار", passwordHash: "x" }).returning();
    const { rows } = await parsePlanWorkbook(await syntheticPlanWorkbook());
    const batch = await createBatch({ importType: "operational_plan", sourceFileName: "swot.xlsx", rows, createdBy: u.id });
    await commitBatch(batch.id, u.id, (tx, ready) =>
      commitPlanRows(tx, ready, batch.id, { planYearKey: "swot-1448", planYearName: "سنة اختبار", createdBy: u.id }),
    );

    const items = await db.select().from(planSwotItems);
    expect(items).toHaveLength(4);
    const strength = items.find((i) => i.code === "قوة-01")!;
    expect(strength.item).toBe("عنصر قوة تجريبي");
    expect(strength.implication).toBe("دلالة تجريبية للقوة");
    // الحقل الاختياري الفارغ يبقى null لا نصاً فارغاً
    expect(items.find((i) => i.code === "فرصة-01")!.implication).toBeNull();

    await rollbackBatch(batch.id, u.id, (tx) => rollbackPlanBatch(tx, batch.id));
    expect(await db.select().from(planSwotItems)).toHaveLength(0);
  });

  it("المسار المضبوط يقرأ ورقة التحليل الرباعي وحدها ولا يُنتج أي صف آخر", async () => {
    const { parseSwotWorkbook } = await import("@/lib/imports/plan");
    const { rows, summary } = await parseSwotWorkbook(await syntheticPlanWorkbook());
    expect(summary).toEqual({ "عناصر التحليل الرباعي": 4 });
    expect([...new Set(rows.map((r) => r.mapped.rowType))]).toEqual(["swot"]);
  });

  it("المسار المضبوط يرفض مصنفاً بلا ورقة تحليل رباعي برسالة عربية", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { parseSwotWorkbook } = await import("@/lib/imports/plan");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("ورقة أخرى");
    ws.addRow(["لا علاقة"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseSwotWorkbook(buf)).rejects.toThrow(/التحليل الرباعي/);
  });

  it("تنفيذ دفعة التحليل الرباعي لا يمسّ البرامج ولا المؤشرات ولا المخاطر، وهو idempotent", async () => {
    const { parsePlanWorkbook, commitPlanRows, parseSwotWorkbook, commitSwotRows, rollbackSwotBatch } =
      await import("@/lib/imports/plan");
    const { createBatch, commitBatch, rollbackBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, programs, programKpis, programRisks, planSwotItems } = await import("@/db/schema");
    await truncateAll(pool);

    const [u] = await db.insert(users).values({ username: "t-swot-only", displayName: "اختبار", passwordHash: "x" }).returning();

    // خط الأساس: خطة مستوردة بلا عناصر تحليل رباعي (تُستبعد صفوفها عمداً)
    const full = await parsePlanWorkbook(await syntheticPlanWorkbook());
    const planBatch = await createBatch({
      importType: "operational_plan",
      sourceFileName: "plan.xlsx",
      rows: full.rows.filter((r) => r.mapped.rowType !== "swot"),
      createdBy: u.id,
    });
    await commitBatch(planBatch.id, u.id, (tx, ready) =>
      commitPlanRows(tx, ready, planBatch.id, { planYearKey: "swot-only", planYearName: "سنة اختبار", createdBy: u.id }),
    );
    const before = {
      programs: (await db.select().from(programs)).length,
      kpis: (await db.select().from(programKpis)).length,
      risks: (await db.select().from(programRisks)).length,
    };
    expect(before.programs).toBe(2);
    expect(await db.select().from(planSwotItems)).toHaveLength(0);

    // المسار المضبوط
    const swot = await parseSwotWorkbook(await syntheticPlanWorkbook());
    const b1 = await createBatch({ importType: "plan_swot", sourceFileName: "swot.xlsx", rows: swot.rows, createdBy: u.id });
    await commitBatch(b1.id, u.id, (tx, ready) => commitSwotRows(tx, ready, b1.id));

    expect(await db.select().from(planSwotItems)).toHaveLength(4);
    // لا كيان آخر تغيّر
    expect((await db.select().from(programs)).length).toBe(before.programs);
    expect((await db.select().from(programKpis)).length).toBe(before.kpis);
    expect((await db.select().from(programRisks)).length).toBe(before.risks);

    // idempotent: تنفيذ ثانٍ لا يضيف ولا يعدّل
    const stored = await db.select().from(planSwotItems);
    const b2 = await createBatch({ importType: "plan_swot", sourceFileName: "swot2.xlsx", rows: (await parseSwotWorkbook(await syntheticPlanWorkbook())).rows, createdBy: u.id });
    await commitBatch(b2.id, u.id, (tx, ready) => commitSwotRows(tx, ready, b2.id));
    const after = await db.select().from(planSwotItems);
    expect(after).toHaveLength(4);
    expect(after.map((x) => x.id).sort()).toEqual(stored.map((x) => x.id).sort());

    // التراجع عن الدفعة الثانية لا يحذف ما أنشأته الأولى
    await rollbackBatch(b2.id, u.id, (tx) => rollbackSwotBatch(tx, b2.id));
    expect(await db.select().from(planSwotItems)).toHaveLength(4);

    // التراجع عن الأولى يحذف ما أنشأته هي فقط ولا يمسّ البرامج
    await rollbackBatch(b1.id, u.id, (tx) => rollbackSwotBatch(tx, b1.id));
    expect(await db.select().from(planSwotItems)).toHaveLength(0);
    expect((await db.select().from(programs)).length).toBe(before.programs);
  });

  it("دفعة التحليل الرباعي ترفض التنفيذ قبل وجود سنة تخطيطية", async () => {
    const { parseSwotWorkbook, commitSwotRows } = await import("@/lib/imports/plan");
    const { createBatch, commitBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    await truncateAll(pool);
    const [u] = await db.insert(users).values({ username: "t-swot-noyear", displayName: "اختبار", passwordHash: "x" }).returning();
    const swot = await parseSwotWorkbook(await syntheticPlanWorkbook());
    const b = await createBatch({ importType: "plan_swot", sourceFileName: "swot.xlsx", rows: swot.rows, createdBy: u.id });
    await expect(
      commitBatch(b.id, u.id, (tx, ready) => commitSwotRows(tx, ready, b.id)),
    ).rejects.toThrow(/سنة تخطيطية/);
  });

  it("إعادة الاستيراد لا تُنشئ نسخاً مكررة ولا تُنسب الصف القائم للدفعة الجديدة", async () => {
    const { parsePlanWorkbook, commitPlanRows, rollbackPlanBatch } = await import("@/lib/imports/plan");
    const { createBatch, commitBatch, rollbackBatch } = await import("@/lib/imports/framework");
    const { db } = await import("@/db");
    const { users, planSwotItems } = await import("@/db/schema");
    await truncateAll(pool);

    const [u] = await db.insert(users).values({ username: "t-swot2", displayName: "اختبار", passwordHash: "x" }).returning();
    const opts = { planYearKey: "swot-dup", planYearName: "سنة اختبار", createdBy: u.id };

    const first = await createBatch({
      importType: "operational_plan",
      sourceFileName: "a.xlsx",
      rows: (await parsePlanWorkbook(await syntheticPlanWorkbook())).rows,
      createdBy: u.id,
    });
    await commitBatch(first.id, u.id, (tx, ready) => commitPlanRows(tx, ready, first.id, opts));
    expect(await db.select().from(planSwotItems)).toHaveLength(4);

    // الدفعة الثانية تحمل صفوف التحليل الرباعي وحدها — إعادة استيراد البرامج نفسها في
    // السنة نفسها ممنوعة أصلاً بقيد (السنة، م) وليست موضوع هذا الاختبار
    const second = await createBatch({
      importType: "operational_plan",
      sourceFileName: "b.xlsx",
      rows: (await parsePlanWorkbook(await syntheticPlanWorkbook())).rows.filter((r) => r.mapped.rowType === "swot"),
      createdBy: u.id,
    });
    await commitBatch(second.id, u.id, (tx, ready) => commitPlanRows(tx, ready, second.id, opts));
    expect(await db.select().from(planSwotItems)).toHaveLength(4);

    // التراجع عن الدفعة الثانية لا يحذف عناصر أنشأتها الأولى
    await rollbackBatch(second.id, u.id, (tx) => rollbackPlanBatch(tx, second.id));
    expect(await db.select().from(planSwotItems)).toHaveLength(4);
  });
});

describe("قراءة مصنفات المولد الرسمي مبدوءة البادئة (البند الراسب 4)", () => {
  it("مصنف بنمط <x:workbook> ونطاقات دمج مكررة يُقرأ ويعطي نفس نتيجة المصنف العادي", async () => {
    const { parsePlanWorkbook } = await import("@/lib/imports/plan");
    const plain = await syntheticPlanWorkbook();
    const prefixed = prefixedWorkbook(plain);
    // تأكد أن المحاكاة صادقة: المصنف المبدوء يبدأ فعلاً بـ <x:workbook>
    const wbXml = new AdmZip(prefixed).getEntry("xl/workbook.xml")!.getData().toString("utf8");
    expect(wbXml).toContain("<x:workbook");

    const a = await parsePlanWorkbook(plain);
    const b = await parsePlanWorkbook(prefixed);
    expect(b.summary).toEqual(a.summary);
    expect(b.rows.length).toBe(a.rows.length);
    expect(b.rows.map((r) => r.mapped)).toEqual(a.rows.map((r) => r.mapped));
  });

  it("ملف غير صالح يعطي رسالة عربية لا خطأ تقنياً إنجليزياً", async () => {
    const { parsePlanWorkbook } = await import("@/lib/imports/plan");
    await expect(parsePlanWorkbook(Buffer.from("ليس ملف Excel"))).rejects.toThrow(/تعذر فتح الملف/);
  });

  it("صف إجمالي بنص غير رقمي في عمود «م» لا يُحتسب برنامجاً (لا برنامج شبح seq=0)", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { parsePlanWorkbook } = await import("@/lib/imports/plan");
    const base = await syntheticPlanWorkbook();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(base as unknown as ArrayBuffer);
    const main = wb.getWorksheet("الخطة التشغيلية")!;
    // صف إجمالي كالذي في الملف الرسمي: نص في كل الأعمدة بما فيها عمود «م»
    main.addRow(["إجمالي الميزانية المدرسية المباشرة", "إجمالي الميزانية المدرسية المباشرة"]);
    const withTotal = Buffer.from(await wb.xlsx.writeBuffer());

    const { summary, rows } = await parsePlanWorkbook(withTotal);
    // البرامج تبقى 2 (لا 3) — صف الإجمالي مُستبعد
    expect(summary["برامج"]).toBe(2);
    const programSeqs = rows.filter((r) => (r.mapped as { rowType: string }).rowType === "program").map((r) => (r.mapped as { seq: number }).seq);
    expect(programSeqs).not.toContain(0);
    expect(programSeqs.sort()).toEqual([1, 2]);
  });
});

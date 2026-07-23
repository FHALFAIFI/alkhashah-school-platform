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

    // الاستيراد يُنشئ أنشطةً (D-020) لا معالم — الوزن المشتق محفوظ للتتبع والبرنامج بوضع متساوٍ
    const acts = await db.select().from(programActivities).where(eq(programActivities.programId, p1.id));
    expect(acts.length).toBe(3);
    expect(acts.reduce((s, a) => s + (a.weight ?? 0), 0)).toBe(100);
    expect(p1.weightingMode).toBe("متساوٍ");

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

describe("حساب التقدم من المعالم الموزونة", () => {
  it("يحسب التقدم الموزون لا عدد المرفقات", async () => {
    const { computeProgramProgress } = await import("@/lib/plan/progress");
    expect(computeProgramProgress([])).toBe(0);
    expect(
      computeProgramProgress([
        { weight: 50, progress: 100 },
        { weight: 50, progress: 0 },
      ]),
    ).toBe(50);
    expect(
      computeProgramProgress([
        { weight: 34, progress: 100 },
        { weight: 33, progress: 50 },
        { weight: 33, progress: 0 },
      ]),
    ).toBe(51);
  });

  it("جاهزية الحزمة: تنفيذ + مخرج + أثر (+ خارجي عند الانطباق)", async () => {
    const { computePackageReadiness } = await import("@/lib/plan/progress");
    const r1 = computePackageReadiness({ requiresExternal: false, evidenceRoles: ["تنفيذ", "مخرج"] });
    expect(r1.readiness).toBe(67);
    expect(r1.missing).toEqual(["أثر"]);
    const r2 = computePackageReadiness({ requiresExternal: true, evidenceRoles: ["تنفيذ", "مخرج", "أثر", "خارجي"] });
    expect(r2.readiness).toBe(100);
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

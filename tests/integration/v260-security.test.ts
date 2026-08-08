import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";
import { REPORTS } from "@/lib/reports/catalog";

/**
 * v2.6 §D/§H — المراجعة الأمنية للتقارير المحفوظة، اختباراتٍ لا نثراً (سياسة v2.5.0 §22).
 *
 * المغطى: تقليل البيانات (لا هوية وطنية ولا اتصال في أي تقرير)، حدود التفويض على
 * الأرشيف، تطهير البحث، رفض الملفات الخطرة للنسخة الموقّعة، تجاوزات الهوية المقيَّدة،
 * ومرشّحات الأقسام التي لا تتجاوز القوائم البيضاء.
 */

let pool: Pool;
let userId = "";

const FULL = new Set([
  "reports.read",
  "reports.builder",
  "reports.generate",
  "documents.issue",
  "plan.read",
]);
const viewer = (perms: Set<string> = FULL) => ({ id: userId, permissions: perms });

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears, programs } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-sec26", displayName: "أمان", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "sec-yr", nameAr: "سنة الأمان", status: "نشطة" }).returning();
  await db.insert(programs).values({ planYearId: y.id, seq: 1, domain: "التعليم", name: "برنامج 100% حرفي", status: "معتمد" });
});

afterAll(async () => {
  await pool.end();
});

describe("§D — تقليل البيانات: سجل التقارير كله", () => {
  it("لا تقرير يعرض هوية وطنية أو رقم اتصال أو بريداً — مفتاحاً أو تسمية", () => {
    const forbiddenKeys = /^(nationalId|civilId|iqamaId|phone|mobile|email|iban)$/i;
    const forbiddenLabels = ["رقم الهوية", "الهوية الوطنية", "رقم الجوال", "الجوال", "البريد الإلكتروني", "رقم الآيبان"];
    for (const report of REPORTS) {
      for (const column of report.columns) {
        expect(forbiddenKeys.test(column.key), `${report.key}.${column.key}`).toBe(false);
        for (const label of forbiddenLabels) {
          expect(column.label.includes(label), `${report.key}: «${column.label}»`).toBe(false);
        }
      }
    }
  });
});

describe("§B/§D — حدود التفويض على الأرشيف", () => {
  it("بلا reports.read لا قائمة ولا قراءة ولا وجود يُكشف", async () => {
    const { createInstance, getInstance, searchInstances } = await import("@/lib/reports/instances/service");
    const created = await createInstance(
      { title: "تقرير محجوب", typeKey: "single", options: { reportKey: "programs-active" } },
      viewer(),
    );
    const none = new Set<string>();
    expect(await getInstance(created.instanceId!, viewer(none))).toBeNull();
    const list = await searchInstances({}, viewer(none));
    expect(list.rows).toHaveLength(0);
  });

  it("الاعتماد يتطلب documents.issue لا صلاحية البناء وحدها", async () => {
    const { createInstance, finalizeInstance } = await import("@/lib/reports/instances/service");
    const created = await createInstance(
      { title: "بلا إصدار", typeKey: "single", options: { reportKey: "programs-active" } },
      viewer(),
    );
    const noIssue = new Set([...FULL].filter((p) => p !== "documents.issue"));
    const refused = await finalizeInstance(created.instanceId!, viewer(noIssue));
    expect(refused.error).toContain("إصدار الوثائق");
  });

  it("محارف SQL الجامحة في البحث تُهرَّب لا تُنفَّذ ولا تتوسع", async () => {
    const { searchInstances } = await import("@/lib/reports/instances/service");
    for (const term of ["%", "_", "%%%", "'; DROP TABLE report_instances; --", "\\"]) {
      const result = await searchInstances({ search: term }, viewer());
      // «%» حرفي لا بدل — لا يطابق كل الصفوف
      expect(result.rows.every((r) => r.title.includes(term) || (r.reportNumber ?? "").includes(term))).toBe(true);
    }
    // البحث الحرفي عن «100%» يجد البرنامج المسمى به فقط عبر العنوان المطابق
    const { createInstance } = await import("@/lib/reports/instances/service");
    await createInstance({ title: "نتيجة 100% نهائية", typeKey: "single", options: { reportKey: "programs-active" } }, viewer());
    const hit = await searchInstances({ search: "100%" }, viewer());
    expect(hit.rows.length).toBeGreaterThan(0);
    expect(hit.rows.every((r) => r.title.includes("100%"))).toBe(true);
  });
});

describe("§H — النسخة الموقّعة: فحص المحتوى لا الاسم", () => {
  it("ملف تنفيذي مقنَّع بامتداد pdf ونوع pdf يُرفض بتوقيعه الفعلي", async () => {
    const { saveUploadedFile, UploadValidationError } = await import("@/lib/storage");
    // ترويسة MZ التنفيذية — الاسم والامتداد والنوع كلها تدّعي PDF
    const fakeExe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)]);
    await expect(
      saveUploadedFile({ originalName: "نسخة موقعة.pdf", mime: "application/pdf", data: fakeExe, scope: "reports", uploadedBy: userId }),
    ).rejects.toThrow(UploadValidationError);
  });

  it("الامتداد الخطر يُرفض ولو زُوِّر النوع", async () => {
    const { saveUploadedFile } = await import("@/lib/storage");
    await expect(
      saveUploadedFile({ originalName: "evil.exe", mime: "application/pdf", data: Buffer.from("%PDF-1.4"), scope: "reports", uploadedBy: userId }),
    ).rejects.toThrow();
  });

  it("مسار حفظ المخرجات المولَّدة مغلق على الصيغ الأربع", async () => {
    const { saveGeneratedFile } = await import("@/lib/storage");
    await expect(
      saveGeneratedFile({ originalName: "x.html", mime: "text/html", data: Buffer.from("<html>"), uploadedBy: userId }),
    ).rejects.toThrow(/غير مدعوم/);
  });
});

describe("§A/§D — الخيارات المخزَّنة لا تتجاوز القوائم البيضاء", () => {
  it("مرشّح قسم بمفتاح ترتيب ملفَّق يسقط في التحليل ولا يصل إلى استعلام", async () => {
    const { sectionFilters } = await import("@/lib/reports/instances/snapshot");
    const filters = sectionFilters(
      { key: "main", reportKey: "programs-active" },
      { search: ["حرفي"] },
      { sectionFilters: { main: { sort: ["pg_sleep(10)"], col: ["secret_column"], search: ["إضافي"] } } },
      { from: null, to: null },
    );
    expect(filters.sort).toBeUndefined();
    expect(filters.columns).toBeUndefined();
    // الإضافة المشروعة تمر
    expect(filters.search).toBeTruthy();
  });

  it("تجاوز هوية أطول من الحد يسقط كله عبر المخطط الصارم", async () => {
    const { parseInstanceOptions } = await import("@/lib/reports/instances/options");
    const evil = parseInstanceOptions({
      identityOverrides: { schoolName: "م".repeat(500) },
      reportKey: "programs-active",
    });
    expect(evil.identityOverrides).toBeUndefined();
    expect(evil.reportKey).toBe("programs-active");
  });

  it("عنوان التقرير يُقصّ عند حدّه فلا يفسد ترويسة ولا اسم ملف", async () => {
    const { createInstance, getInstance } = await import("@/lib/reports/instances/service");
    const created = await createInstance(
      { title: "ع".repeat(1000), typeKey: "single", options: { reportKey: "programs-active" } },
      viewer(),
    );
    const row = await getInstance(created.instanceId!, viewer());
    expect(row!.title.length).toBeLessThanOrEqual(200);
  });
});

/**
 * اختبارات التحقق من المصادر الحقيقية (D-014):
 * 1) النماذج الرسمية الثمانية موجودة بأسمائها وأوزانها وترتيبها كما في ملف الوزارة
 *    (الجدول المرجعي أدناه منسوخ مستقلاً من الفحص البصري — docs/PERFORMANCE_MODEL_VALIDATION.md).
 * 2) كل نموذج = 100٪ تماماً ومقفل عن التعديل العادي.
 * 3) نموذج المدير محفوظ دون سماح بتقييم ذاتي.
 * 4) ملف فارس الحقيقي: 52 صفاً، استبعاد الحقول الحساسة، وبقاء التصنيف والنموذج
 *    قابلين للتعديل قبل الموافقة (يتخطى إن غاب الملف — reference_files خارج Git).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { eq, asc } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";
let selfPersonId: string | null = null;

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: selfPersonId,
    permissions: new Set([
      "performance.read", "performance.write", "performance.approve",
      "performance.individual.read", "performance.models.manage",
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

const FARES_PATH = path.resolve("reference_files", "بيانات الموظفين في فارس.xlsx");
const hasFares = existsSync(FARES_PATH);

/**
 * الجدول المرجعي — منقول من الفحص البصري لملف «نماذج تقييم أداء شاغلي الوظائف التعليمية»
 * (الإصدار الأول): المفتاح، الاسم الحرفي، تسلسل الأوزان بترتيب الصفوف، وعينات أسماء مثبتة
 * (الأول، الأخير، والمؤشرات محل الخلاف الموثق مع الدليل الإرشادي).
 */
const EXPECTED = [
  {
    key: "teacher",
    nameAr: "نموذج تقييم أداء المعلم",
    weights: [10, 10, 10, 10, 10, 10, 10, 5, 5, 10, 10],
    spot: { 0: "أداء الواجبات الوظيفية", 10: "تنوع أساليب التقويم" },
  },
  {
    key: "activity-leader",
    nameAr: "نموذج تقييم أداء معلم مسند له نشاط طلابي",
    weights: [10, 10, 10, 5, 5, 5, 5, 5, 5, 5, 5, 10, 5, 5, 10],
    spot: {
      11: "إعداد خطة مزمنة ومعتمدة لبرامج وفعاليات النشاط الطلابي",
      14: "يحفز المتعلمين على المشاركة في الأنشطة المدرسية",
    },
  },
  {
    key: "health-advisor",
    nameAr: "نموذج تقييم أداء معلم مسند له توجيه صحي",
    weights: [10, 10, 10, 5, 5, 5, 5, 5, 5, 5, 5, 15, 5, 10],
    spot: {
      11: "تنفيذ الخطة المشتركة للبرامج الصحية المدرسية",
      13: "تهيئة البيئة الصحية المدرسية",
    },
  },
  {
    key: "kindergarten-teacher",
    nameAr: "نموذج تقييم أداء معلمة رياض الأطفال",
    weights: [10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    spot: {
      // موضع الخلاف الموثق مع الدليل (D-014): ملف النماذج = 5٪
      11: "تهيئ بيئة تعلمية آمنة ومعززة للتطور النمائي والتعلم",
      18: "تدعم اكتساب المتعلمين القيم والمبادئ والاتجاهات",
    },
  },
  {
    key: "lab-technician",
    nameAr: "نموذج تقييم أداء محضر المختبر",
    weights: [10, 10, 10, 10, 10, 5, 5, 5, 5, 5, 5, 10, 10],
    spot: { 5: "يعد خطة يومية لأنشطة المختبر", 12: "يعد تقارير دورية عن حالة الأجهزة والمعدات" },
  },
  {
    key: "student-advisor",
    nameAr: "نموذج تقييم أداء الموجه الطلابي",
    weights: [20, 5, 5, 5, 5, 10, 10, 10, 10, 5, 5, 5, 5],
    spot: { 0: "أداء الواجبات الوظيفية", 12: "توعية المتعلمين وأولياء امورهم بقواعد السلوك والمواظبة" },
  },
  {
    key: "school-vice",
    nameAr: "نموذج تقييم أداء وكيل المدرسة",
    weights: [5, 5, 5, 5, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    spot: {
      // موضع الخلاف الموثق مع الدليل (D-014): ملف النماذج = 5٪
      11: "ينفذ إجراءات علمية لتحسين نتائج التعلم",
      13: "يشارك في إعداد الخطط المدرسية اللازمة",
      18: "يهيئ بيئة مدرسية آمنة ومحفزة على التعلم",
    },
  },
  {
    key: "school-principal",
    nameAr: "نموذج تقييم أداء مدير المدرسة",
    weights: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 10, 5, 5, 5, 5, 5, 5],
    spot: {
      7: "يعد خطة للتطوير المهني",
      11: "ينفذ إجراءات علمية لتحسين نتائج التعلم",
      12: "يسهم في تحسين مستوى أداء المدرسة",
      13: "يعد الخطط المدرسية اللازمة",
    },
  },
];

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-official", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
  const { seedOfficialPerfModels } = await import("@/db/seed-official-models");
  await seedOfficialPerfModels();
  await seedOfficialPerfModels(); // idempotency: تشغيل ثانٍ لا يكرر
});

afterAll(async () => {
  await pool.end();
});

async function loadModelWithIndicators(key: string) {
  const { db } = await import("@/db");
  const { perfModels, perfIndicators } = await import("@/db/schema");
  const [model] = await db.select().from(perfModels).where(eq(perfModels.key, key));
  if (!model) return null;
  const indicators = await db
    .select()
    .from(perfIndicators)
    .where(eq(perfIndicators.modelId, model.id))
    .orderBy(asc(perfIndicators.sortOrder));
  return { model, indicators };
}

describe("النماذج الرسمية الثمانية — التحقق من المصدر الحقيقي", () => {
  it("النماذج الثمانية موجودة بأسمائها الحرفية، رسمية، ودون تكرار", async () => {
    const { db } = await import("@/db");
    const { perfModels } = await import("@/db/schema");
    const officials = await db.select().from(perfModels).where(eq(perfModels.official, true));
    expect(officials.length).toBe(8);
    for (const exp of EXPECTED) {
      const m = officials.find((x) => x.key === exp.key);
      expect(m, `النموذج ${exp.key} مفقود`).toBeDefined();
      expect(m!.nameAr).toBe(exp.nameAr);
    }
  });

  it("ترتيب المؤشرات وأوزانها تطابق ملف الوزارة (نقل مثبت من الفحص البصري)", async () => {
    for (const exp of EXPECTED) {
      const data = await loadModelWithIndicators(exp.key);
      expect(data, exp.key).not.toBeNull();
      const weights = data!.indicators.map((i) => Number(i.weight));
      expect(weights, `أوزان ${exp.key}`).toEqual(exp.weights);
      for (const [idx, name] of Object.entries(exp.spot)) {
        expect(data!.indicators[Number(idx)].nameAr, `${exp.key}[${idx}]`).toBe(name);
      }
    }
  });

  it("مجموع أوزان كل نموذج رسمي = 100٪ تماماً", async () => {
    for (const exp of EXPECTED) {
      const data = await loadModelWithIndicators(exp.key);
      const total = data!.indicators.reduce((s, i) => s + Number(i.weight), 0);
      expect(total, exp.key).toBe(100);
    }
  });

  it("النماذج الرسمية معتمدة (مقفلة): إضافة مؤشر ترفض دون إعادة فتح موثقة", async () => {
    const data = await loadModelWithIndicators("teacher");
    expect(data!.model.status).toBe("معتمد");

    const { addIndicatorAction } = await import("@/app/(app)/performance/actions");
    const fd = new FormData();
    fd.set("nameAr", "مؤشر دخيل");
    fd.set("weight", "5");
    const res = await addIndicatorAction(data!.model.id, null, fd);
    expect(res?.error).toContain("معتمد");

    // لم يتغير عدد المؤشرات
    const after = await loadModelWithIndicators("teacher");
    expect(after!.indicators.length).toBe(11);
  });

  it("نموذج مدير المدرسة محفوظ للمستقبل ولا يسمح بدورة تقييم ذاتي", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const data = await loadModelWithIndicators("school-principal");
    expect(data!.model.status).toBe("معتمد");
    expect(data!.model.official).toBe(true);

    const [self] = await db
      .insert(people)
      .values({ fullName: "مدير المدرسة نفسه", category: "معلم" })
      .returning();
    selfPersonId = self.id;
    try {
      const { createCycleAction } = await import("@/app/(app)/performance/actions");
      const fd = new FormData();
      fd.set("personId", self.id);
      fd.set("modelId", data!.model.id);
      fd.set("cycleType", "معلم");
      fd.set("yearKey", "1448-1449");
      const res = await createCycleAction(null, fd);
      expect(res?.error).toBe("لا يجوز إنشاء دورة تقييم ذاتي");
    } finally {
      selfPersonId = null;
    }
  });
});

describe.skipIf(!hasFares)("ملف فارس الحقيقي — معاينة آمنة (المصدر الحقيقي)", () => {
  it("يكتشف 52 صف موظف ويستبعد الحقول الحساسة الأربعة افتراضياً", async () => {
    const { parsePeopleWorkbook } = await import("@/lib/imports/people");
    const { rows, detectedColumns } = await parsePeopleWorkbook(readFileSync(FARES_PATH));

    expect(rows.length).toBe(52);

    const sensitive = detectedColumns.filter((c) => c.sensitive).map((c) => c.header);
    expect(sensitive).toContain("الهوية الوطنية");
    expect(sensitive).toContain("تاريخ الميلاد");
    expect(sensitive).toContain("رقم الجوال");
    expect(sensitive).toContain("هوية المدير المباشر");

    for (const row of rows) {
      const all = JSON.stringify(row.raw) + JSON.stringify(row.mapped);
      // لا قيم هوية (10 خانات تبدأ بـ1) ولا جوال سعودي في أي حقل محفوظ
      expect(all).not.toMatch(/1\d{9}/);
      expect(all).not.toMatch(/05\d{8}/);
      expect(Object.keys(row.mapped)).not.toContain("nationalId");
      expect(Object.keys(row.mapped)).not.toContain("birthDate");
      expect(Object.keys(row.mapped)).not.toContain("mobile");
      expect(Object.keys(row.mapped)).not.toContain("managerNationalId");
    }
  });

  it("يقترح التصنيف (معلم/موظف) والنموذج ويترك غير المؤكد للمراجعة", async () => {
    const { parsePeopleWorkbook } = await import("@/lib/imports/people");
    const { rows } = await parsePeopleWorkbook(readFileSync(FARES_PATH));

    const teachers = rows.filter((r) => r.mapped.category === "معلم");
    const staff = rows.filter((r) => r.mapped.category === "موظف");
    expect(teachers.length + staff.length).toBe(52);
    expect(teachers.length).toBeGreaterThan(0);
    expect(staff.length).toBeGreaterThan(0);

    // كل معلم مقترح له نموذج، وكل غير مؤكد معلم «يحتاج مراجعة» (لا استيراد صامت)
    for (const t of teachers) expect(t.mapped.suggestedModelKey).toBeTruthy();
    for (const s of staff) expect(s.status).toBe("يحتاج مراجعة");
  });

  it("التصنيف واقتراح النموذج قابلان للتعديل قبل الموافقة (قبل أي تنفيذ)", async () => {
    const { parsePeopleWorkbook } = await import("@/lib/imports/people");
    const { createBatch, updateRowCorrection, getBatchWithRows } = await import("@/lib/imports/framework");
    const { rows } = await parsePeopleWorkbook(readFileSync(FARES_PATH));

    const batch = await createBatch({
      importType: "people",
      sourceFileName: "بيانات الموظفين في فارس.xlsx",
      rows,
      createdBy: testUserId,
    });

    const withRows = await getBatchWithRows(batch.id);
    expect(withRows!.batch.status).toBe("معاينة"); // لم ينفذ شيء
    const first = withRows!.rows[0];

    await updateRowCorrection(first.id, { category: "موظف", suggestedModelKey: null }, "جاهز");
    const after = await getBatchWithRows(batch.id);
    const corrected = after!.rows.find((r) => r.id === first.id)!;
    expect((corrected.mapped as Record<string, unknown>).category).toBe("موظف");
    expect((corrected.mapped as Record<string, unknown>).suggestedModelKey).toBeNull();

    // ثم إعادتها — التعديل حر بالكامل قبل الموافقة الصريحة
    await updateRowCorrection(first.id, { category: "معلم", suggestedModelKey: "teacher" });
    const back = await getBatchWithRows(batch.id);
    const restored = back!.rows.find((r) => r.id === first.id)!;
    expect((restored.mapped as Record<string, unknown>).category).toBe("معلم");
    expect((restored.mapped as Record<string, unknown>).suggestedModelKey).toBe("teacher");
  });
});

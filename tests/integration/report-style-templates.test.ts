import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.6 §E — قوالب الإخراج المخصصة ودورة حياتها (D-058).
 *
 * العقود: الأساسي لا يُمسّ؛ النسخة تُنشأ وتُعدَّل وتُؤرشف وتُستعاد ولا تُحذف؛ الإعداد
 * المخزَّن مُطهَّر دائماً؛ والقالب يُحلّ بالترتيب: الصريح ← افتراضي النوع ← قالب النوع.
 */

let pool: Pool;
let userId = "";

const FULL = new Set(["reports.read", "reports.builder", "reports.generate", "documents.issue", "plan.read"]);
const viewer = (perms: Set<string> = FULL) => ({ id: userId, permissions: perms });

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears, programs } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-styles", displayName: "قوالب", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "sty-yr", nameAr: "سنة القوالب", status: "نشطة" }).returning();
  await db.insert(programs).values({ planYearId: y.id, seq: 1, domain: "التعليم", name: "برنامج القوالب", status: "معتمد" });
});

afterAll(async () => {
  await pool.end();
});

describe("دورة حياة النسخة المخصصة", () => {
  it("تُنشأ من قالب أساسي وتُخزَّن بإعداد مُطهَّر كامل", async () => {
    const { createStyleTemplate, getStyleTemplate } = await import("@/lib/reports/instances/style-templates");
    const created = await createStyleTemplate(
      { name: "نسخة الاختبار", baseKey: "official", config: { primaryColor: "#112233" } },
      viewer(),
    );
    expect(created.error).toBeUndefined();
    const row = await getStyleTemplate(created.templateId!);
    expect(row!.baseKey).toBe("official");
    expect(row!.config.primaryColor).toBe("#112233");
    // بقية الحقول ورثت الأساس ولم تسقط
    expect(row!.config.cover).toBe("تلقائي");
    expect(row!.config.approvalBox).toBe(true);
  });

  it("إعداد ملفَّق أو مفتاح غريب يسقط ويبقى الأساس", async () => {
    const { createStyleTemplate, getStyleTemplate } = await import("@/lib/reports/instances/style-templates");
    const created = await createStyleTemplate(
      { name: "نسخة خبيثة", baseKey: "internal", config: { primaryColor: "red;}body{display:none", evilKey: "<script>" } },
      viewer(),
    );
    const row = await getStyleTemplate(created.templateId!);
    expect(row!.config.primaryColor).toBe("#1f5244");
    expect((row!.config as unknown as Record<string, unknown>).evilKey).toBeUndefined();
  });

  it("أساس مجهول يُرفض، والاسم الفارغ يُرفض", async () => {
    const { createStyleTemplate } = await import("@/lib/reports/instances/style-templates");
    expect((await createStyleTemplate({ name: "س", baseKey: "لا-وجود" }, viewer())).error).toBeTruthy();
    expect((await createStyleTemplate({ name: "  ", baseKey: "official" }, viewer())).error).toBeTruthy();
  });

  it("بلا صلاحية البناء لا إنشاء ولا تعديل ولا أرشفة", async () => {
    const { createStyleTemplate, updateStyleTemplate, archiveStyleTemplate } = await import(
      "@/lib/reports/instances/style-templates"
    );
    const none = new Set(["reports.read"]);
    expect((await createStyleTemplate({ name: "x", baseKey: "official" }, viewer(none))).error).toBeTruthy();
    expect((await updateStyleTemplate("00000000-0000-0000-0000-000000000000", { name: "x" }, viewer(none))).error).toBeTruthy();
    expect((await archiveStyleTemplate("00000000-0000-0000-0000-000000000000", viewer(none))).error).toBeTruthy();
  });

  it("التعديل يحفظ الاسم والإعداد المطهَّر", async () => {
    const { createStyleTemplate, updateStyleTemplate, getStyleTemplate } = await import(
      "@/lib/reports/instances/style-templates"
    );
    const created = await createStyleTemplate({ name: "قبل", baseKey: "analytical" }, viewer());
    const updated = await updateStyleTemplate(
      created.templateId!,
      { name: "بعد", config: { density: "مضغوط", toc: "نعم", primaryColor: "#010203" } },
      viewer(),
    );
    expect(updated.error).toBeUndefined();
    const row = await getStyleTemplate(created.templateId!);
    expect(row!.name).toBe("بعد");
    expect(row!.config.density).toBe("مضغوط");
    expect(row!.config.primaryColor).toBe("#010203");
  });

  it("الأرشفة تُخرجها من الاختيارات والاستعادة تعيدها — ولا دالة حذف أصلاً", async () => {
    const styles = await import("@/lib/reports/instances/style-templates");
    const created = await styles.createStyleTemplate({ name: "نسخة للأرشفة", baseKey: "executive" }, viewer());
    const id = created.templateId!;

    expect((await styles.templateChoices()).some((c) => c.key === id)).toBe(true);
    expect((await styles.archiveStyleTemplate(id, viewer())).error).toBeUndefined();
    expect((await styles.templateChoices()).some((c) => c.key === id)).toBe(false);
    // مؤرشفة مرتين مرفوض، والاستعادة تعيدها
    expect((await styles.archiveStyleTemplate(id, viewer())).error).toBeTruthy();
    expect((await styles.restoreStyleTemplate(id, viewer())).error).toBeUndefined();
    expect((await styles.templateChoices()).some((c) => c.key === id)).toBe(true);

    expect("deleteStyleTemplate" in styles).toBe(false);
  });

  it("الاختيارات تحمل الأساسية الخمسة أولاً ثم النسخ", async () => {
    const { templateChoices } = await import("@/lib/reports/instances/style-templates");
    const choices = await templateChoices();
    expect(choices.slice(0, 5).every((c) => c.isBase)).toBe(true);
    expect(choices.filter((c) => c.isBase)).toHaveLength(5);
  });
});

describe("القالب الافتراضي لكل نوع وترتيب الحلّ", () => {
  it("التعيين يُرفض لنوع مجهول أو قالب مؤرشف، ويُقبل للأساسي والنسخة الحية", async () => {
    const styles = await import("@/lib/reports/instances/style-templates");
    expect((await styles.setDefaultTemplate("لا-وجود", "official", viewer())).error).toBeTruthy();
    expect((await styles.setDefaultTemplate("periodic", "official", viewer())).error).toBeUndefined();

    const created = await styles.createStyleTemplate({ name: "افتراضي مؤرشف", baseKey: "plain" }, viewer());
    await styles.archiveStyleTemplate(created.templateId!, viewer());
    expect((await styles.setDefaultTemplate("periodic", created.templateId!, viewer())).error).toBeTruthy();
  });

  it("ترتيب الحلّ: الصريح ← افتراضي النوع ← قالب تعريف النوع", async () => {
    const styles = await import("@/lib/reports/instances/style-templates");
    // بلا افتراضي محفوظ: قالب تعريف النوع
    expect(await styles.resolveTemplateKey(undefined, "executive")).toBe("executive");
    // مع افتراضي محفوظ: يغلب تعريف النوع
    await styles.setDefaultTemplate("executive", "analytical", viewer());
    expect(await styles.resolveTemplateKey(undefined, "executive")).toBe("analytical");
    // الصريح يغلب الجميع
    expect(await styles.resolveTemplateKey("plain", "executive")).toBe("plain");
    // مفتاح مجهول يسقط إلى ما بعده
    expect(await styles.resolveTemplateKey("لا-وجود", "executive")).toBe("analytical");
  });

  it("اللقطة تُبنى بالقالب المحلول — والنسخة المخصصة تصل إلى الإعداد المجمّد", async () => {
    const styles = await import("@/lib/reports/instances/style-templates");
    const { buildSnapshot } = await import("@/lib/reports/instances/snapshot");
    const created = await styles.createStyleTemplate(
      { name: "قالب اللقطة", baseKey: "official", config: { primaryColor: "#aabbcc" } },
      viewer(),
    );
    const doc = await buildSnapshot({
      typeKey: "single",
      title: "تقرير القالب",
      storedFilters: {},
      storedOptions: { reportKey: "programs-active", templateKey: created.templateId },
      periodFrom: null,
      periodTo: null,
      viewer: viewer(),
    });
    expect(doc.templateKey).toBe(created.templateId);
    expect((doc.style as { primaryColor: string }).primaryColor).toBe("#aabbcc");
  });

  it("مسودة تشير إلى قالب مؤرشف تسقط إلى الافتراضي بدل أن تفشل", async () => {
    const styles = await import("@/lib/reports/instances/style-templates");
    const { buildSnapshot } = await import("@/lib/reports/instances/snapshot");
    const created = await styles.createStyleTemplate({ name: "قالب سيُؤرشف", baseKey: "internal" }, viewer());
    await styles.archiveStyleTemplate(created.templateId!, viewer());
    const doc = await buildSnapshot({
      typeKey: "single",
      title: "تقرير قالب مؤرشف",
      storedFilters: {},
      storedOptions: { reportKey: "programs-active", templateKey: created.templateId },
      periodFrom: null,
      periodTo: null,
      viewer: viewer(),
    });
    expect(doc.templateKey).not.toBe(created.templateId);
    expect(doc.style).toBeTruthy();
  });
});

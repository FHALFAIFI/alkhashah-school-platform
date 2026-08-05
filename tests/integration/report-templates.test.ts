import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.5.0 §4.5 / §16 / §17 — قوالب التقارير المحفوظة.
 *
 * ثلاثة عقود تُثبَّت هنا:
 *  1. **الذهاب والعودة** — ما يُحفظ يعود كما هو، بما فيه المرشّحات المتعدّدة القيم. هذه
 *     تحديداً كسرت أثناء البناء: `Object.fromEntries` على معاملات مكرّرة يُبقي الأخيرة
 *     وحدها، فقالبٌ بثلاث لجان يعود بلجنة واحدة — فقدان صامت لا يظهر إلا في تقرير ناقص.
 *  2. **القالب لا يمنح شيئاً** — قالب مشترك لتقرير أداء فردي لا يظهر ولا يُقرأ لمن لا
 *     يملك صلاحية ذلك التقرير.
 *  3. **الحذف لا يمسّ البيانات** — لا صف أعمال ولا وثيقة صادرة تتأثر بحذف قالب.
 */

let pool: Pool;
let ownerId = "";
let otherId = "";

let permissions = new Set<string>();
let currentUser = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: currentUser,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions,
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: currentUser, permissions })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ALL = new Set([
  "reports.read",
  "reports.builder",
  "reports.generate",
  "plan.read",
  "committees.read",
  "performance.read",
  "performance.individual.read",
  "reports.templates.share",
  "reports.templates.global",
]);

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [a] = await db.insert(users).values({ username: "t-owner", displayName: "المالك", passwordHash: "x" }).returning();
  const [b] = await db.insert(users).values({ username: "t-other", displayName: "آخر", passwordHash: "x" }).returning();
  ownerId = a.id;
  otherId = b.id;
  currentUser = ownerId;
  permissions = new Set(ALL);
});

afterAll(async () => {
  await pool.end();
});

const viewer = (id: string, perms: Set<string>) => ({ id, permissions: perms });

describe("§4.5 — الذهاب والعودة", () => {
  it("المرشّحات المتعدّدة القيم تعود كاملة، لا آخر قيمة فقط", async () => {
    const { createTemplate, getTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));

    const created = await createTemplate(
      {
        name: "اللجان الثلاث",
        description: "قالب اختبار",
        reportKey: "committee-registry-detailed",
        filters: { statuses: ["معتمدة", "مسودة"], search: "لجنة", flags: ["hasTasks"] },
        columns: ["committeeName", "personName", "taskText"],
        visibility: "خاص",
      },
      me,
    );
    expect(created.error).toBeUndefined();

    const loaded = await getTemplate(created.templateId!, me);
    expect(loaded).toBeTruthy();
    // القيمتان معاً — لا واحدة
    expect(loaded!.filters.statuses).toEqual(["معتمدة", "مسودة"]);
    expect(loaded!.filters.search).toBe("لجنة");
    expect(loaded!.filters.flags).toEqual(["hasTasks"]);
    expect(loaded!.columns).toEqual(["committeeName", "personName", "taskText"]);
  });

  it("رابط التشغيل يحمل المرشّحات والأعمدة كما حُفظت", async () => {
    const { createTemplate, getTemplate, templateRunHref } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    const created = await createTemplate(
      {
        name: "برامج مجالين",
        reportKey: "programs-by-domain",
        filters: { domains: ["المجال الأول", "المجال الثاني"] },
        columns: ["domain", "name"],
        visibility: "خاص",
      },
      me,
    );
    const t = await getTemplate(created.templateId!, me);
    const href = templateRunHref(t!);
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(sp.getAll("domain")).toEqual(["المجال الأول", "المجال الثاني"]);
    expect(sp.getAll("col")).toEqual(["domain", "name"]);
    expect(sp.get("report")).toBe("programs-by-domain");
  });

  it("عمود أو ترتيب غير معلَن في التقرير يُسقَط عند الحفظ", async () => {
    const { createTemplate, getTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    const created = await createTemplate(
      {
        name: "أعمدة ملفَّقة",
        reportKey: "programs-by-domain",
        filters: { sort: "password_hash" as string },
        columns: ["domain", "users.password_hash", "name"],
        visibility: "خاص",
      },
      me,
    );
    const t = await getTemplate(created.templateId!, me);
    expect(t!.columns).toEqual(["domain", "name"]);
    expect(t!.sortKey).toBeNull();
  });
});

describe("§16 — القالب لا يمنح صلاحية", () => {
  it("قالب مشترك لتقرير حسّاس لا يظهر لمن لا يملك صلاحية التقرير", async () => {
    const { createTemplate, listTemplates, getTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    const created = await createTemplate(
      {
        name: "أداء منخفض مشترك",
        reportKey: "perf-low-performers",
        filters: {},
        columns: [],
        visibility: "مشترك",
      },
      me,
    );
    expect(created.error).toBeUndefined();

    // مستخدم بلا `performance.individual.read`
    const limited = viewer(otherId, new Set(["reports.read", "reports.builder", "plan.read", "performance.read"]));
    const list = await listTemplates(limited);
    expect(list.some((t) => t.id === created.templateId)).toBe(false);
    expect(await getTemplate(created.templateId!, limited)).toBeNull();

    // ومن يملكها يراه
    const privileged = viewer(otherId, new Set(ALL));
    expect(await getTemplate(created.templateId!, privileged)).toBeTruthy();
  });

  it("القالب الخاص لا يظهر لغير صاحبه", async () => {
    const { createTemplate, listTemplates } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    const created = await createTemplate(
      { name: "خاص بي", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "خاص" },
      me,
    );
    const others = await listTemplates(viewer(otherId, new Set(ALL)));
    expect(others.some((t) => t.id === created.templateId)).toBe(false);
  });

  it("لا يُحفظ نطاق «مشترك» أو «عام» بلا صلاحيته", async () => {
    const { createTemplate } = await import("@/lib/reports/templates");
    const basic = viewer(ownerId, new Set(["reports.read", "reports.builder", "plan.read"]));
    const shared = await createTemplate(
      { name: "محاولة مشاركة", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "مشترك" },
      basic,
    );
    expect(shared.error).toContain("لا تملك صلاحية");
    const global = await createTemplate(
      { name: "محاولة عامة", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "عام" },
      basic,
    );
    expect(global.error).toContain("لا تملك صلاحية");
  });

  it("لا يُحفظ قالب لتقرير لا يملك المستخدم صلاحيته", async () => {
    const { createTemplate } = await import("@/lib/reports/templates");
    const basic = viewer(ownerId, new Set(["reports.read", "reports.builder", "plan.read"]));
    const res = await createTemplate(
      { name: "أداء", reportKey: "perf-low-performers", filters: {}, columns: [], visibility: "خاص" },
      basic,
    );
    expect(res.error).toContain("صلاحية");
  });

  it("غير المالك لا يعدّل ولا يحذف قالباً مشتركاً", async () => {
    const { createTemplate, updateTemplate, deleteTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    const created = await createTemplate(
      { name: "مشترك للتعديل", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "مشترك" },
      me,
    );
    const stranger = viewer(otherId, new Set(ALL));
    const upd = await updateTemplate(
      created.templateId!,
      { name: "مسروق", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "مشترك" },
      stranger,
    );
    expect(upd.error).toContain("صلاحية");
    const del = await deleteTemplate(created.templateId!, stranger);
    expect(del.error).toContain("صلاحية");
  });

  it("النسخة من قالب مشترك تكون خاصة بناسخها — المشاركة لا تتسع بالنسخ", async () => {
    const { createTemplate, duplicateTemplate, getTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    const created = await createTemplate(
      { name: "أصل مشترك", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "مشترك" },
      me,
    );
    const stranger = viewer(otherId, new Set(ALL));
    const copy = await duplicateTemplate(created.templateId!, stranger);
    expect(copy.error).toBeUndefined();
    const loaded = await getTemplate(copy.templateId!, stranger);
    expect(loaded!.visibility).toBe("خاص");
    expect(loaded!.ownerUserId).toBe(otherId);
    expect(loaded!.isOwner).toBe(true);
  });
});

describe("§4.5 / §17 — الحذف والتدقيق", () => {
  it("حذف القالب لا يمسّ أي بيانات، ويُسجَّل في التدقيق", async () => {
    const { db } = await import("@/db");
    const { auditLog, programs, planYears } = await import("@/db/schema");
    const { createTemplate, deleteTemplate, getTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));

    const [year] = await db.insert(planYears).values({ key: "tpl-yr", nameAr: "سنة", status: "نشطة" }).returning();
    await db.insert(programs).values({ planYearId: year.id, seq: 900, domain: "مجال", name: "برنامج لا يتأثر" });
    const before = await db.select().from(programs);

    const created = await createTemplate(
      { name: "للحذف", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "خاص" },
      me,
    );
    const res = await deleteTemplate(created.templateId!, me);
    expect(res.success).toBeTruthy();
    expect(await getTemplate(created.templateId!, me)).toBeNull();

    const after = await db.select().from(programs);
    expect(after).toHaveLength(before.length); // لا بيانات أعمال تأثرت

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, created.templateId!));
    expect(audits.some((a) => a.action === "report_template.created")).toBe(true);
    expect(audits.some((a) => a.action === "report_template.deleted")).toBe(true);
  });

  it("اسم فارغ مرفوض، والاسم الطويل مرفوض برسالة عربية", async () => {
    const { createTemplate } = await import("@/lib/reports/templates");
    const me = viewer(ownerId, new Set(ALL));
    expect((await createTemplate({ name: "   ", reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "خاص" }, me)).error)
      .toContain("إلزامي");
    expect(
      (
        await createTemplate(
          { name: "ط".repeat(200), reportKey: "programs-by-owner", filters: {}, columns: [], visibility: "خاص" },
          me,
        )
      ).error,
    ).toContain("أطول");
  });
});

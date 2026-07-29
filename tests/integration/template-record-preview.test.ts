import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Scope v2.2 §E4 — authorized preview against a real record.
 *
 * The guarantees under test:
 *  1. the preview never exposes a record the current user may not read;
 *  2. a record id of the wrong type (or one outside the eligible set) is refused — IDOR;
 *  3. the preview neither issues a document nor mutates the record;
 *  4. a doc type with no record source falls back to safe sample data.
 */

let pool: Pool;
let testUserId = "";
let permissions = new Set<string>(["documents.read", "admin.settings", "plan.read"]);

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async (perm: string) => {
    if (!permissions.has(perm)) throw new Error(`AuthError: ${perm}`);
    return { id: testUserId, username: "t", displayName: "اختبار", personId: null, permissions, csrfToken: "x", sessionId: "x" };
  }),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions })),
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
  const [u] = await db.insert(users).values({ username: "t-preview", displayName: "اختبار المعاينة", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { templateVersions, templateDefinitions, documents, programs, planYears, committees } = await import("@/db/schema");
  await db.delete(documents);
  await db.delete(templateVersions);
  await db.delete(templateDefinitions);
  await db.delete(committees);
  await db.delete(programs);
  await db.delete(planYears);
  permissions = new Set<string>(["documents.read", "admin.settings", "plan.read"]);
});

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function makeTemplate(docType: string) {
  const { createTemplateAction } = await import("@/app/(app)/admin/templates/actions");
  const res = await createTemplateAction(null, fd({ docType, nameAr: "قالب اختبار" }));
  expect(res?.error).toBeUndefined();
  const { db } = await import("@/db");
  const { templateDefinitions } = await import("@/db/schema");
  const rows = await db.select().from(templateDefinitions);
  return rows[rows.length - 1];
}

async function makeProgram(name = "برنامج المعاينة") {
  const { db } = await import("@/db");
  const { programs, planYears } = await import("@/db/schema");
  const existing = await db.select().from(planYears);
  const year = existing[0] ?? (await db.insert(planYears).values({ key: "1448-1449", nameAr: "١٤٤٨/١٤٤٩" }).returning())[0];
  const [p] = await db
    .insert(programs)
    .values({ planYearId: year.id, seq: 1, domain: "مجال المعاينة", name, progress: 42, executionStatus: "جارٍ" })
    .returning();
  return p;
}

const DEFAULT_CONFIG = JSON.stringify({ text: { titleAr: "تقرير {{program_name}}" } });

describe("§E4 — المعاينة بسجل حقيقي", () => {
  it("تعرض قيم السجل الحقيقي في الناتج", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram("برنامج التحسين الأكاديمي");
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.html).toContain("برنامج التحسين الأكاديمي");
    expect(res.html).toContain("مجال المعاينة");
    expect(res.recordLabel).toContain("برنامج التحسين الأكاديمي");
  });

  it("لا تُصدر وثيقة ولا تُنشئ نسخة قالب ولا تُعدّل السجل", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    const { db } = await import("@/db");
    const { documents, templateVersions, programs } = await import("@/db/schema");
    const versionsBefore = (await db.select().from(templateVersions)).length;
    const programBefore = JSON.stringify((await db.select().from(programs))[0]);

    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);

    expect(await db.select().from(documents)).toHaveLength(0);
    expect((await db.select().from(templateVersions)).length).toBe(versionsBefore);
    expect(JSON.stringify((await db.select().from(programs))[0])).toBe(programBefore);
  });

  it("تُسجَّل المعاينة في سجل التدقيق مع تصريح أنه لم تصدر وثيقة", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    const { db } = await import("@/db");
    const { auditLog } = await import("@/db/schema");
    const rows = await db.select().from(auditLog);
    const entry = rows.find((r) => r.action === "template.record_preview");
    expect(entry).toBeDefined();
    expect(entry!.summary).toContain("لم تصدر وثيقة");
  });
});

describe("§E4 — التفويض وحماية IDOR", () => {
  it("ترفض من لا يملك صلاحية إدارة القوالب", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    permissions = new Set<string>(["documents.read", "plan.read"]);
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    await expect(previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG)).rejects.toThrow(/AuthError/);
  });

  it("ترفض من يملك إدارة القوالب لكنه لا يملك صلاحية قراءة نوع السجل", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    // إدارة القوالب وحدها لا تُغني عن صلاحية قراءة السجل
    permissions = new Set<string>(["documents.read", "admin.settings"]);
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("صلاحية");
  });

  it("ترفض معرّف سجل من نوع آخر (IDOR)", async () => {
    const { db } = await import("@/db");
    const { committees, planYears } = await import("@/db/schema");
    const p = await makeProgram();
    const [year] = await db.select().from(planYears);
    const [committee] = await db
      .insert(committees)
      .values({ planYearId: year.id, nameAr: "لجنة سرية", kind: "لجنة" })
      .returning();

    // قالب تقرير برنامج + معرّف لجنة = سجل من نوع لا ينتمي لهذا القالب
    const t = await makeTemplate("program_report");
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, committee.id, DEFAULT_CONFIG);
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).not.toContain("لجنة سرية");
    expect(p.id).not.toBe(committee.id);
  });

  it("ترفض معرّفاً عشوائياً غير موجود بلا كشف أي بيانات", async () => {
    const t = await makeTemplate("program_report");
    await makeProgram();
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, "00000000-0000-4000-8000-000000000000", DEFAULT_CONFIG);
    expect("error" in res).toBe(true);
  });

  it("ترفض معرّفاً غير صالح الشكل قبل أي استعلام", async () => {
    const t = await makeTemplate("program_report");
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, "not-a-uuid", DEFAULT_CONFIG);
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("غير صالح");
  });

  it("لا تُعاين سجلاً مؤرشفاً — الاستعلام نفسه يبني القائمة ويحمّل السجل", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(programs).set({ archivedAt: new Date() }).where(eq(programs.id, p.id));

    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    expect("error" in res).toBe(true);
  });

  it("النوع بلا مصدر سجلات يرفض المعاينة الحقيقية ويصرّح بذلك", async () => {
    const t = await makeTemplate("official_letter");
    const p = await makeProgram();
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("نموذجية");
  });
});

describe("§E4 — سلامة الإعداد في المعاينة", () => {
  it("ترفض إعداداً غير صالح قبل قراءة السجل", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, JSON.stringify({ hacked: true }));
    expect("error" in res).toBe(true);
  });

  it("ترفض قسماً أو عموداً غير معروف في المعاينة كما في الحفظ", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, JSON.stringify({ sections: [{ key: "evil" }] }));
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("evil");
  });

  it("اسم سجل يحوي وسماً خبيثاً يُهرَّب ولا يُصيَّر حياً", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram('<img src=x onerror="alert(1)">');
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(res.html).not.toContain("<img src=x");
    expect(res.html).toContain("&lt;img");
  });

  it("لا يحوي الناتج مورداً خارجياً ولا نصاً برمجياً", async () => {
    const t = await makeTemplate("program_report");
    const p = await makeProgram();
    const { previewWithRecordAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await previewWithRecordAction(t.id, p.id, DEFAULT_CONFIG);
    if ("error" in res) throw new Error(res.error);
    expect(res.html).not.toMatch(/https?:\/\//);
    expect(res.html).not.toContain("<script");
    expect(res.html).not.toContain("@import");
  });
});

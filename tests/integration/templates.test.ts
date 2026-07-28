import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Scope v2.2 §E5/§E6 — template versioning and frozen history.
 *
 * The mandatory guarantee under test: editing a template must never alter a document
 * that was already issued. Everything else here — versioning, publish, restore, import
 * rejection, authorisation — protects that guarantee.
 */

let pool: Pool;
let testUserId = "";
let permissions = new Set<string>(["documents.read", "admin.settings"]);

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
  const [u] = await db.insert(users).values({ username: "t-tpl", displayName: "اختبار القوالب", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { templateVersions, templateDefinitions, documents } = await import("@/db/schema");
  await db.delete(documents);
  await db.delete(templateVersions);
  await db.delete(templateDefinitions);
  permissions = new Set<string>(["documents.read", "admin.settings"]);
});

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

async function makeTemplate(docType = "program_report") {
  const { createTemplateAction } = await import("@/app/(app)/admin/templates/actions");
  const res = await createTemplateAction(null, fd({ docType, nameAr: "قالب اختبار" }));
  expect(res?.error).toBeUndefined();
  const { db } = await import("@/db");
  const { templateDefinitions } = await import("@/db/schema");
  const [t] = await db.select().from(templateDefinitions);
  return t;
}

async function versionsOf(templateId: string) {
  const { db } = await import("@/db");
  const { templateVersions } = await import("@/db/schema");
  return db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId)).orderBy(templateVersions.versionNumber);
}

describe("§E1 — إدارة القوالب", () => {
  it("ينشئ قالباً بنسخة أولى مسودة بالإعداد الافتراضي", async () => {
    const t = await makeTemplate();
    const versions = await versionsOf(t.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].status).toBe("مسودة");
    // لا يُنشر تلقائياً — النشر قرار صريح
    expect(t.currentVersionId).toBeNull();
  });

  it("يرفض نوع وثيقة غير معروف", async () => {
    const { createTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await createTemplateAction(null, fd({ docType: "../../etc/passwd" }));
    expect(res?.error).toBeTruthy();
  });

  it("الاسم والوصف اختياريان (§8)", async () => {
    const { createTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await createTemplateAction(null, fd({ docType: "official_letter" }));
    expect(res?.error).toBeUndefined();
    const { db } = await import("@/db");
    const { templateDefinitions } = await import("@/db/schema");
    const [t] = await db.select().from(templateDefinitions);
    expect(t.nameAr).toBeNull();
  });

  it("لا يسمح بقالبين افتراضيين لنوع واحد", async () => {
    const { setDefaultTemplateAction, publishVersionAction } = await import("@/app/(app)/admin/templates/actions");
    const a = await makeTemplate("program_report");
    const va = (await versionsOf(a.id))[0];
    await publishVersionAction(va.id);
    await setDefaultTemplateAction(a.id);

    const { createTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    await createTemplateAction(null, fd({ docType: "program_report", nameAr: "قالب ثانٍ" }));
    const { db } = await import("@/db");
    const { templateDefinitions } = await import("@/db/schema");
    const all = await db.select().from(templateDefinitions);
    const second = all.find((t) => t.nameAr === "قالب ثانٍ")!;
    const vb = (await versionsOf(second.id))[0];
    await publishVersionAction(vb.id);
    await setDefaultTemplateAction(second.id);

    const after = await db.select().from(templateDefinitions);
    expect(after.filter((t) => t.isDefault && t.docType === "program_report")).toHaveLength(1);
  });

  it("يمنع تعيين قالب افتراضياً قبل نشر نسخة", async () => {
    const t = await makeTemplate();
    const { setDefaultTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await setDefaultTemplateAction(t.id);
    expect(res?.error).toContain("انشر");
  });
});

describe("§E5 — النسخ والتاريخ المجمَّد", () => {
  it("تعديل مسودة غير منشورة يُحدّثها في مكانها بلا تاريخ وهمي", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "عنوان أول" } }) }));
    const versions = await versionsOf(t.id);
    expect(versions).toHaveLength(1);
  });

  it("تعديل قالب بعد النشر يُنشئ نسخة جديدة ولا يمسّ المنشورة", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction, publishVersionAction } = await import("@/app/(app)/admin/templates/actions");
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "المنشور" } }) }));
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);

    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "المعدَّل" } }) }));
    const versions = await versionsOf(t.id);
    expect(versions).toHaveLength(2);
    // النسخة المنشورة كما هي حرفياً
    expect(versions[0].id).toBe(v1.id);
    expect((versions[0].config as { text: { titleAr: string } }).text.titleAr).toBe("المنشور");
    expect(versions[0].status).toBe("منشورة");
    // الجديدة مسودة لا تُستعمل حتى تُنشر
    expect(versions[1].status).toBe("مسودة");
  });

  it("**الوثيقة الصادرة لا تتغيّر أبداً عند تعديل القالب أو نشره**", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction, publishVersionAction } = await import("@/app/(app)/admin/templates/actions");
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "العنوان الأصلي" } }) }));
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);

    // إصدار وثيقة باللقطة المصيَّرة من النسخة المنشورة
    const { renderTemplate } = await import("@/lib/templates/render");
    const { configOf } = await import("@/lib/templates/service");
    const { issueDocument } = await import("@/lib/documents");
    const html = renderTemplate(configOf(v1), { values: { document_number: "D-1" } });
    const doc = await issueDocument({
      docType: "program_report",
      title: "وثيقة اختبار",
      htmlSnapshot: html,
      templateVersionId: v1.id,
      issuedBy: testUserId,
    });
    expect(html).toContain("العنوان الأصلي");

    // تعديل القالب جذرياً ونشره
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "عنوان مختلف تماماً" } }) }));
    const v2 = (await versionsOf(t.id))[1];
    await publishVersionAction(v2.id);

    const { db } = await import("@/db");
    const { documents } = await import("@/db/schema");
    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    // اللقطة المجمّدة كما صدرت — لا أثر للتعديل
    expect(after.htmlSnapshot).toBe(html);
    expect(after.htmlSnapshot).toContain("العنوان الأصلي");
    expect(after.htmlSnapshot).not.toContain("عنوان مختلف تماماً");
    // ونعرف بأي نسخة صدرت
    expect(after.templateVersionId).toBe(v1.id);
  });

  it("استعادة نسخة سابقة تنشئ نسخة جديدة ولا تحذف اللاحقة", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction, publishVersionAction, restoreVersionAction } = await import("@/app/(app)/admin/templates/actions");
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "الأولى" } }) }));
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "الثانية" } }) }));

    await restoreVersionAction(v1.id);
    const versions = await versionsOf(t.id);
    expect(versions).toHaveLength(3);
    expect(versions[2].versionNumber).toBe(3);
    expect((versions[2].config as { text: { titleAr: string } }).text.titleAr).toBe("الأولى");
    // النسخة الثانية لم تُحذف
    expect((versions[1].config as { text: { titleAr: string } }).text.titleAr).toBe("الثانية");
  });

  it("لا تُؤرشف نسخة منشورة", async () => {
    const t = await makeTemplate();
    const { publishVersionAction, archiveDraftVersionAction } = await import("@/app/(app)/admin/templates/actions");
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);
    const res = await archiveDraftVersionAction(v1.id);
    expect(res?.error).toContain("منشورة");
    expect(await versionsOf(t.id)).toHaveLength(1);
  });

  it("لا تُؤرشف نسخة صدرت بها وثيقة", async () => {
    const t = await makeTemplate();
    const v1 = (await versionsOf(t.id))[0];
    const { issueDocument } = await import("@/lib/documents");
    await issueDocument({ docType: "program_report", title: "وثيقة", htmlSnapshot: "<p>x</p>", templateVersionId: v1.id, issuedBy: testUserId });

    const { archiveDraftVersionAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await archiveDraftVersionAction(v1.id);
    expect(res?.error).toContain("صدرت بها وثائق");
  });

  it("أرقام النسخ لا تُعاد ولا تتكرّر", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction, publishVersionAction, archiveDraftVersionAction } = await import("@/app/(app)/admin/templates/actions");
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "ثانية" } }) }));
    const v2 = (await versionsOf(t.id))[1];
    await archiveDraftVersionAction(v2.id);
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "ثالثة" } }) }));
    const versions = await versionsOf(t.id);
    // الرقم 2 محجوز للأبد: المسودة أُرشفت ولم تُحذف، فلا يلتبس سجل التدقيق
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
    expect(versions[1].status).toBe("مؤرشفة");
  });

  it("أرشفة القالب لا تحذف نسخه", async () => {
    const t = await makeTemplate();
    const { archiveTemplateAction, restoreTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    await archiveTemplateAction(t.id);
    expect(await versionsOf(t.id)).toHaveLength(1);
    const again = await archiveTemplateAction(t.id);
    expect(again?.success).toContain("مؤرشف مسبقاً");
    await restoreTemplateAction(t.id);
    const { db } = await import("@/db");
    const { templateDefinitions } = await import("@/db/schema");
    const [after] = await db.select().from(templateDefinitions).where(eq(templateDefinitions.id, t.id));
    expect(after.archivedAt).toBeNull();
  });

  it("النشر idempotent", async () => {
    const t = await makeTemplate();
    const { publishVersionAction } = await import("@/app/(app)/admin/templates/actions");
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);
    const again = await publishVersionAction(v1.id);
    expect(again?.success).toContain("منشورة مسبقاً");
  });
});

describe("§E6 — الاستيراد والتعافي", () => {
  it("يرفض إعداداً مستورداً يحوي نصاً برمجياً", async () => {
    const t = await makeTemplate();
    const { importTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await importTemplateConfigAction(t.id, null, fd({ payload: JSON.stringify({ text: { titleAr: "<script>alert(1)</script>" } }) }));
    expect(res?.error).toContain("مرفوض");
    expect(await versionsOf(t.id)).toHaveLength(1);
  });

  it("يرفض إعداداً بمفتاح غير معروف", async () => {
    const t = await makeTemplate();
    const { importTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await importTemplateConfigAction(t.id, null, fd({ payload: JSON.stringify({ customCss: "body{}" }) }));
    expect(res?.error).toContain("مرفوض");
  });

  it("يرفض JSON غير صالح وحمولة ضخمة", async () => {
    const t = await makeTemplate();
    const { importTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    expect((await importTemplateConfigAction(t.id, null, fd({ payload: "{not json" })))?.error).toContain("JSON");
    expect((await importTemplateConfigAction(t.id, null, fd({ payload: "x".repeat(100_001) })))?.error).toContain("الحد المسموح");
  });

  it("يقبل إعداداً صالحاً ويُنشئه مسودة لا منشورة", async () => {
    const t = await makeTemplate();
    const { importTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await importTemplateConfigAction(t.id, null, fd({ payload: JSON.stringify({ text: { titleAr: "عنوان مستورد" } }) }));
    expect(res?.error).toBeUndefined();
    const versions = await versionsOf(t.id);
    expect(versions).toHaveLength(2);
    expect(versions[1].status).toBe("مسودة");
  });

  it("يرفض عنصراً نائباً غير معروف عند الحفظ", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "مرحباً {{secret_key}}" } }) }));
    expect(res?.error).toContain("secret_key");
  });

  it("يرفض عنصراً نائباً غير متاح لهذا النوع", async () => {
    const t = await makeTemplate("program_report");
    const { saveTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    const res = await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "{{committee_name}}" } }) }));
    expect(res?.error).toContain("committee_name");
  });

  it("إعادة الافتراضي تنشئ نسخة جديدة ولا تمسّ القائمة", async () => {
    const t = await makeTemplate();
    const { saveTemplateConfigAction, publishVersionAction, resetToDefaultAction } = await import("@/app/(app)/admin/templates/actions");
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "مخصص" } }) }));
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);
    await resetToDefaultAction(t.id);
    const versions = await versionsOf(t.id);
    expect(versions).toHaveLength(2);
    expect((versions[0].config as { text: { titleAr: string } }).text.titleAr).toBe("مخصص");
  });

  it("التكرار ينشئ قالباً مستقلاً غير افتراضي", async () => {
    const t = await makeTemplate();
    const { duplicateTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    await duplicateTemplateAction(t.id);
    const { db } = await import("@/db");
    const { templateDefinitions } = await import("@/db/schema");
    const all = await db.select().from(templateDefinitions);
    expect(all).toHaveLength(2);
    expect(all.every((x) => !x.isDefault)).toBe(true);
  });
});

describe("§10 — التفويض على حدود الخادم", () => {
  it("يمنع التحرير بلا صلاحية الإدارة حتى لو أُخفي الزر", async () => {
    const t = await makeTemplate();
    permissions = new Set<string>(["documents.read"]); // عرض فقط
    const { saveTemplateConfigAction, publishVersionAction, archiveTemplateAction, importTemplateConfigAction } = await import(
      "@/app/(app)/admin/templates/actions"
    );
    const v1 = (await versionsOf(t.id))[0];
    await expect(saveTemplateConfigAction(t.id, null, fd({ config: "{}" }))).rejects.toThrow();
    await expect(publishVersionAction(v1.id)).rejects.toThrow();
    await expect(archiveTemplateAction(t.id)).rejects.toThrow();
    await expect(importTemplateConfigAction(t.id, null, fd({ payload: "{}" }))).rejects.toThrow();
  });
});

describe("§E4 — الإصدار يستعمل القالب المنشور", () => {
  it("يستعمل النسخة المنشورة للقالب الافتراضي", async () => {
    const t = await makeTemplate("program_report");
    const { saveTemplateConfigAction, publishVersionAction, setDefaultTemplateAction } = await import("@/app/(app)/admin/templates/actions");
    await saveTemplateConfigAction(t.id, null, fd({ config: JSON.stringify({ text: { titleAr: "قالب معتمد" } }) }));
    const v1 = (await versionsOf(t.id))[0];
    await publishVersionAction(v1.id);
    await setDefaultTemplateAction(t.id);

    const { resolveTemplateForIssue } = await import("@/lib/templates/service");
    const resolved = await resolveTemplateForIssue("program_report");
    expect(resolved.versionId).toBe(v1.id);
    expect(resolved.config.text?.titleAr).toBe("قالب معتمد");
  });

  it("يسقط إلى الإعداد الافتراضي حين لا قالب — لا يتوقّف الإصدار", async () => {
    const { resolveTemplateForIssue } = await import("@/lib/templates/service");
    const resolved = await resolveTemplateForIssue("official_letter");
    expect(resolved.versionId).toBeNull();
    expect(resolved.config).toBeTruthy();
  });

  it("لا يستعمل مسودة غير منشورة في الإصدار", async () => {
    const t = await makeTemplate("official_letter");
    const { db } = await import("@/db");
    const { templateDefinitions } = await import("@/db/schema");
    // مسودة فقط، لم تُنشر — ومع ذلك عُيّنت افتراضية يدوياً في قاعدة البيانات
    await db.update(templateDefinitions).set({ isDefault: true }).where(eq(templateDefinitions.id, t.id));
    const { resolveTemplateForIssue } = await import("@/lib/templates/service");
    const resolved = await resolveTemplateForIssue("official_letter");
    expect(resolved.versionId).toBeNull();
  });
});

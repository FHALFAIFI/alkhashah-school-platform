import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Phase 3 — قوالب الفحص: CRUD + إصدارات + تجميد تاريخي.
 */

let pool: Pool;
let testUserId = "";
let roomId = "";

const fakeUser = () => ({
  id: testUserId,
  username: "t",
  displayName: "اختبار",
  personId: null,
  permissions: new Set(["inspections.read", "inspections.write", "building.publish", "building.read"]),
  csrfToken: "csrf-test-token",
  sessionId: "x",
});

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => fakeUser()),
  requireUser: vi.fn(async () => fakeUser()),
  getCurrentUser: vi.fn(async () => fakeUser()),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, siteZones, floors, rooms } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-tpl", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
  await db.insert(siteZones).values({ key: "boys", nameAr: "مجمع البنين", zoneType: "managed" });
  const [floor] = await db.insert(floors).values({ key: "ground", nameAr: "الأرضي", level: 0, zoneKey: "boys", sortOrder: 1 }).returning();
  const [room] = await db.insert(rooms).values({ code: "KHS-RM-0001", geomKey: "r1", nameAr: "غرفة", roomType: "فصل دراسي", floorId: floor.id }).returning();
  roomId = room.id;
});

const sections = (label = "الإضاءة تعمل") => [
  { key: "s1", title: "قسم", items: [{ key: "i1", label, required: true, responseType: "compliant" }] },
];

function fdFor(nameAr: string, secs: unknown) {
  const fd = new FormData();
  fd.set("nameAr", nameAr);
  fd.set("sectionsJson", JSON.stringify(secs));
  return fd;
}

describe("قوالب الفحص — الإنشاء والإصدارات", () => {
  it("الإنشاء ينتج مسودة إصدار 1 برمز عائلة وrootId=self وعناصر مسطّحة مشتقة", async () => {
    const { db } = await import("@/db");
    const { inspectionTemplates } = await import("@/db/schema");
    const { createTemplateAction } = await import("@/app/(app)/building/template-actions");
    const res = await createTemplateAction(null, fdFor("قالب اختبار", sections()));
    expect(res?.newId).toBeTruthy();
    const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, res!.newId!));
    expect(t.status).toBe("مسودة");
    expect(t.version).toBe(1);
    expect(t.code).toMatch(/KHS-TPL-/);
    expect(t.rootId).toBe(t.id);
    expect(t.items.length).toBe(1);
  });

  it("تحرير مسودة غير مستخدَمة يحدّثها في مكانها؛ وتحرير قالب مُفعّل ينشئ إصداراً جديداً", async () => {
    const { db } = await import("@/db");
    const { inspectionTemplates } = await import("@/db/schema");
    const { createTemplateAction, updateTemplateAction, activateTemplateAction } = await import("@/app/(app)/building/template-actions");

    const created = await createTemplateAction(null, fdFor("قالب", sections("الإضاءة")));
    const id = created!.newId!;

    // تحرير في المكان (مسودة)
    const upd = await updateTemplateAction(id, null, fdFor("قالب معدّل", sections("الإضاءة والتكييف")));
    expect(upd?.success).toMatch(/المسودة/);
    const [after] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
    expect(after.nameAr).toBe("قالب معدّل");
    const familyBefore = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.rootId, id));
    expect(familyBefore.length).toBe(1);

    // تفعيل ثم تحرير → إصدار جديد
    await activateTemplateAction(id);
    const newVer = await updateTemplateAction(id, null, fdFor("قالب v2", sections("بند جديد")));
    expect(newVer?.newId).toBeTruthy();
    expect(newVer!.newId).not.toBe(id);
    const family = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.rootId, id));
    expect(family.length).toBe(2);
    const [v2] = family.filter((f) => f.id === newVer!.newId);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("مسودة");
    // الإصدار المُفعّل الأصلي لم يتغيّر بإنشاء الإصدار الجديد (يبقى بالاسم المعدَّل قبل التفعيل)
    const [v1] = family.filter((f) => f.id === id);
    expect(v1.nameAr).toBe("قالب معدّل");
    expect(v1.status).toBe("معتمد");
  });

  it("التفعيل يعطّل الإصدارات المُفعّلة الأخرى في العائلة", async () => {
    const { db } = await import("@/db");
    const { inspectionTemplates } = await import("@/db/schema");
    const { createTemplateAction, updateTemplateAction, activateTemplateAction } = await import("@/app/(app)/building/template-actions");
    const created = await createTemplateAction(null, fdFor("قالب", sections()));
    const id = created!.newId!;
    await activateTemplateAction(id);
    const v2 = (await updateTemplateAction(id, null, fdFor("قالب v2", sections("بند"))))!.newId!;
    await activateTemplateAction(v2);
    const family = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.rootId, id));
    expect(family.find((f) => f.id === id)!.status).toBe("معطّل");
    expect(family.find((f) => f.id === v2)!.status).toBe("معتمد");
  });
});

describe("قوالب الفحص — الحذف والتجميد التاريخي", () => {
  it("لا يُحذف قالب مستخدَم؛ والفحص يجمّد نسخة القالب فلا تغيّرها التعديلات اللاحقة", async () => {
    const { db } = await import("@/db");
    const { inspectionTemplates, inspections } = await import("@/db/schema");
    const { createTemplateAction, activateTemplateAction, deleteTemplateDraftAction } = await import("@/app/(app)/building/template-actions");
    const { submitInspectionAction } = await import("@/app/(app)/building/actions");

    const created = await createTemplateAction(null, fdFor("قالب السلامة", sections("طفاية موجودة")));
    const id = created!.newId!;
    await activateTemplateAction(id);

    // فحص باستخدام القالب المُفعّل
    const insFd = new FormData();
    insFd.set("roomId", roomId);
    insFd.set("templateId", id);
    insFd.set("item_i1", "ok");
    const ins = await submitInspectionAction(null, insFd);
    expect(ins?.success).toBeTruthy();

    // الآن القالب مستخدَم → لا يُحذف
    const del = await deleteTemplateDraftAction(id);
    expect(del?.error).toBeTruthy();
    const stillThere = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
    expect(stillThere.length).toBe(1);

    // الفحص جمّد snapshot + version
    const [insp] = await db.select().from(inspections).where(eq(inspections.templateId, id));
    expect(insp.templateVersion).toBe(1);
    expect(insp.templateSnapshot).toBeTruthy();
  });

  it("يُحذف فقط ما هو مسودة غير مستخدَمة", async () => {
    const { db } = await import("@/db");
    const { inspectionTemplates } = await import("@/db/schema");
    const { createTemplateAction, deleteTemplateDraftAction } = await import("@/app/(app)/building/template-actions");
    const created = await createTemplateAction(null, fdFor("مسودة", sections()));
    const id = created!.newId!;
    const del = await deleteTemplateDraftAction(id);
    expect(del?.success).toBeTruthy();
    expect((await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id))).length).toBe(0);
  });
});

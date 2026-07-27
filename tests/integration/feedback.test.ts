import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await truncateAll(pool);
});

async function makeUser(displayName = "مدير المدرسة") {
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db
    .insert(users)
    .values({ username: `u-${displayName}-${Math.floor(performance.now() * 1000)}`, displayName, passwordHash: "x" })
    .returning();
  return u;
}

describe("قناة ملاحظات التشغيل — الخدمة", () => {
  it("createFeedback يولّد رقماً مرجعياً فريداً متزايداً ويلتقط بيانات آمنة فقط", async () => {
    const { createFeedback } = await import("@/lib/feedback/service");
    const u = await makeUser();

    const a = await createFeedback({
      actorId: u.id,
      pagePath: "/committees/abc",
      module: "اللجان والمجالس",
      category: "مشكلة",
      severity: "تؤثر جزئياً على العمل",
      title: "زر الحفظ لا يستجيب",
      attempted: "حفظ محضر",
      happened: "لا شيء",
      expected: "أن يُحفظ",
      blocked: true,
      viewport: "390x844",
      browser: "Safari",
      appVersion: "0.1.0+abc123",
    });
    const b = await createFeedback({
      actorId: u.id,
      pagePath: "/plan",
      module: "الخطة التشغيلية",
      category: "اقتراح",
      severity: "ملاحظة بسيطة",
      title: "اقتراح ثانٍ",
      blocked: false,
    });

    expect(a.ref).toMatch(/^FB-\d{4,}$/);
    expect(b.ref).toMatch(/^FB-\d{4,}$/);
    expect(a.ref).not.toBe(b.ref);
    // متزايد
    const na = Number(a.ref.slice(3));
    const nb = Number(b.ref.slice(3));
    expect(nb).toBe(na + 1);

    // البيانات الملتقطة آمنة: مقاس مطبّع + فئة جهاز مشتقة + متصفح + نسخة + مسار
    const { db } = await import("@/db");
    const { feedback } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(feedback).where(eq(feedback.id, a.id));
    expect(row.viewport).toBe("390×844");
    expect(row.deviceClass).toBe("جوال");
    expect(row.browser).toBe("Safari");
    expect(row.appVersion).toBe("0.1.0+abc123");
    expect(row.pagePath).toBe("/committees/abc");
    expect(row.blocked).toBe(true);
    // لا أعمدة لالتقاط الكوكيز/الرموز/HTML الصفحة — البنية نفسها تمنع ذلك
    const cols = Object.keys(row);
    for (const forbidden of ["cookie", "cookies", "token", "html", "dom", "password", "session"]) {
      expect(cols.some((c) => c.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  it("يرفض الفئة/الأهمية/المسار غير الصالح، ويقبل العنوان الفارغ (v2.1: الحقول اختيارية)", async () => {
    const { createFeedback, FeedbackError } = await import("@/lib/feedback/service");
    const u = await makeUser();
    const base = {
      actorId: u.id,
      pagePath: "/plan",
      module: "الخطة التشغيلية",
      category: "مشكلة",
      severity: "ملاحظة بسيطة",
      title: "عنوان",
      blocked: false,
    };
    const { db } = await import("@/db");
    const { feedback } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    // قيمة غير فارغة لكنها غير صالحة → ما زالت تُرفض (تحقّق الصيغة/القائمة البيضاء باقٍ)
    await expect(createFeedback({ ...base, category: "غير موجودة" })).rejects.toBeInstanceOf(FeedbackError);
    await expect(createFeedback({ ...base, severity: "خطيرة جداً" })).rejects.toBeInstanceOf(FeedbackError);
    await expect(createFeedback({ ...base, pagePath: "https://evil.com" })).rejects.toBeInstanceOf(FeedbackError);
    // العنوان الفارغ صار مقبولاً (لم يعد يُرفض) — يُخزَّن فارغاً
    const emptyTitle = await createFeedback({ ...base, title: "   " });
    const [t] = await db.select().from(feedback).where(eq(feedback.id, emptyTitle.id));
    expect(t.title.trim()).toBe("");
    // وحدة غير معروفة تُطبّع إلى «أخرى» (لا ترفض)
    const ok = await createFeedback({ ...base, module: "وحدة وهمية" });
    const [row] = await db.select().from(feedback).where(eq(feedback.id, ok.id));
    expect(row.module).toBe("أخرى");
  });

  it("يخزّن المرفق الخاص كملف حساس ويعرضه في التفاصيل", async () => {
    const { createFeedback, getFeedbackById } = await import("@/lib/feedback/service");
    const { db } = await import("@/db");
    const { storedFiles } = await import("@/db/schema");
    const u = await makeUser();
    const [file] = await db
      .insert(storedFiles)
      .values({
        originalName: "لقطة.png",
        mime: "image/png",
        size: 1234,
        sha256: "deadbeef",
        storagePath: `feedback/ab/${crypto.randomUUID()}.png`,
        scope: "feedback",
        sensitive: true,
        uploadedBy: u.id,
      })
      .returning();
    const f = await createFeedback({
      actorId: u.id,
      pagePath: "/building",
      module: "المبنى المدرسي",
      category: "مشكلة",
      severity: "ملاحظة بسيطة",
      title: "مع مرفق",
      blocked: false,
      attachmentFileId: file.id,
    });
    const detail = await getFeedbackById(f.id);
    expect(detail?.attachmentName).toBe("لقطة.png");
    expect(file.sensitive).toBe(true);
  });

  it("seedFeedbackRbac يضيف الأذونات ويمنحها للأدوار الإدارية (idempotent)", async () => {
    const { seedFeedbackRbac } = await import("@/lib/feedback/service");
    const { db } = await import("@/db");
    const { roles, permissions, rolePermissions } = await import("@/db/schema");
    const { eq, inArray, and } = await import("drizzle-orm");
    const [principal] = await db.insert(roles).values({ key: "principal", nameAr: "مدير المدرسة", system: true }).returning();
    await db.insert(roles).values({ key: "sysadmin", nameAr: "مسؤول النظام", system: true });

    await seedFeedbackRbac();
    await seedFeedbackRbac(); // تكرار آمن

    const perms = await db.select().from(permissions).where(inArray(permissions.key, ["feedback.create", "feedback.manage"]));
    expect(perms.length).toBe(2);
    const grants = await db
      .select()
      .from(rolePermissions)
      .where(and(eq(rolePermissions.roleId, principal.id), inArray(rolePermissions.permissionId, perms.map((p) => p.id))));
    expect(grants.length).toBe(2); // لا تكرار رغم التشغيل مرتين
  });

  it("تحويلات الحالة: النهائية تتطلب توثيقاً وتضبط تاريخ الحل، وتُدقَّق", async () => {
    const { createFeedback, updateFeedbackStatus, FeedbackError } = await import("@/lib/feedback/service");
    const { db } = await import("@/db");
    const { feedback, auditLog } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const u = await makeUser();
    const f = await createFeedback({
      actorId: u.id, pagePath: "/plan", module: "الخطة التشغيلية",
      category: "مشكلة", severity: "ملاحظة بسيطة", title: "للاختبار", blocked: false,
    });

    // حالة عادية — بلا توثيق إلزامي
    await updateFeedbackStatus({ id: f.id, status: "قيد المراجعة", actorId: u.id });
    // «لن تُنفذ» بلا سبب ترفض
    await expect(updateFeedbackStatus({ id: f.id, status: "لن تُنفذ", actorId: u.id })).rejects.toBeInstanceOf(FeedbackError);
    await expect(updateFeedbackStatus({ id: f.id, status: "تم الحل", actorId: u.id, note: "" })).rejects.toBeInstanceOf(FeedbackError);
    // «تم الحل» مع توثيق يضبط ملاحظة الحل وتاريخه
    await updateFeedbackStatus({ id: f.id, status: "تم الحل", actorId: u.id, note: "أُصلح في التحديث" });
    const [row] = await db.select().from(feedback).where(eq(feedback.id, f.id));
    expect(row.status).toBe("تم الحل");
    expect(row.resolutionNote).toBe("أُصلح في التحديث");
    expect(row.resolvedAt).not.toBeNull();

    // تدقيق: حدث إنشاء + أحداث تغيير حالة
    const created = await db.select().from(auditLog).where(and(eq(auditLog.action, "feedback.created"), eq(auditLog.entityId, f.id)));
    const changed = await db.select().from(auditLog).where(and(eq(auditLog.action, "feedback.status_changed"), eq(auditLog.entityId, f.id)));
    expect(created.length).toBe(1);
    expect(changed.length).toBe(2); // قيد المراجعة + تم الحل
  });

  it("لا حذف نهائي — الأرشفة تخفي بسبب موثق وتبقى قابلة للاسترجاع", async () => {
    const { createFeedback, archiveFeedback, unarchiveFeedback, listFeedback, FeedbackError } = await import("@/lib/feedback/service");
    const { db } = await import("@/db");
    const { feedback } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");
    const u = await makeUser();
    const f = await createFeedback({
      actorId: u.id, pagePath: "/plan", module: "الخطة التشغيلية",
      category: "مشكلة", severity: "ملاحظة بسيطة", title: "للأرشفة", blocked: false,
    });

    await expect(archiveFeedback({ id: f.id, reason: "  ", actorId: u.id })).rejects.toBeInstanceOf(FeedbackError);
    await archiveFeedback({ id: f.id, reason: "مكررة", actorId: u.id });

    // الصف ما زال موجوداً (لا حذف)
    const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(feedback);
    expect(c).toBe(1);
    // مستبعدة من العرض الافتراضي، ظاهرة في «المؤرشفة»
    expect((await listFeedback({ archived: "active" })).length).toBe(0);
    expect((await listFeedback({ archived: "archived" })).length).toBe(1);
    expect((await listFeedback({ archived: "all" })).length).toBe(1);

    await unarchiveFeedback({ id: f.id, actorId: u.id });
    expect((await listFeedback({ archived: "active" })).length).toBe(1);
  });

  it("listFeedback يرشّح حسب الوحدة والفئة والحالة", async () => {
    const { createFeedback, listFeedback } = await import("@/lib/feedback/service");
    const u = await makeUser();
    await createFeedback({ actorId: u.id, pagePath: "/plan", module: "الخطة التشغيلية", category: "مشكلة", severity: "ملاحظة بسيطة", title: "أ", blocked: false });
    await createFeedback({ actorId: u.id, pagePath: "/committees", module: "اللجان والمجالس", category: "اقتراح", severity: "ملاحظة بسيطة", title: "ب", blocked: false });
    expect((await listFeedback({ module: "الخطة التشغيلية" })).length).toBe(1);
    expect((await listFeedback({ category: "اقتراح" })).length).toBe(1);
    expect((await listFeedback({})).length).toBe(2);
  });
});

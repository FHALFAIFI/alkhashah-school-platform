import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

const fakeUser = () => ({
  id: testUserId,
  username: "t",
  displayName: "اختبار",
  personId: null,
  permissions: new Set([
    "building.read", "building.write", "building.publish",
    "assets.read", "assets.write", "inspections.read", "inspections.write",
    "maintenance.read", "maintenance.write",
  ]),
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
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, siteZones, floors } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-bld", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
  await db.insert(siteZones).values([
    { key: "boys", nameAr: "مجمع البنين", zoneType: "managed" },
    { key: "girls", nameAr: "مجمع البنات", zoneType: "context" },
  ]);
  await db.insert(floors).values([
    { key: "ground", nameAr: "الدور الأرضي", level: 0, zoneKey: "boys", sortOrder: 1 },
    { key: "girls-area", nameAr: "منطقة البنات", level: 0, zoneKey: "girls", sortOrder: 9 },
  ]);
});

afterAll(async () => {
  await pool.end();
});

const sampleGeometry = (name = "غرفة الاختبار", w = 5, h = 7) => ({
  unit: "m",
  rooms: [{ key: "r1", name, type: "فصل دراسي", x: 0, y: 0, w, h }],
});

describe("التوأم الرقمي (A11, A12, A14)", () => {
  it("A11: تعديل الاسم والأبعاد يحفظ في نسخة هندسة جديدة ويزامن سجل الغرف عند النشر", async () => {
    const { db } = await import("@/db");
    const { floors, floorGeometryVersions, rooms } = await import("@/db/schema");
    const { saveGeometryDraftAction, publishGeometryAction } = await import("@/app/(app)/building/actions");
    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));

    // نسخة 1
    const r1 = await saveGeometryDraftAction(ground.id, JSON.stringify(sampleGeometry("فصل أ", 5, 7)));
    expect(r1?.error).toBeUndefined();
    // نسخة 2: تغيير الاسم والبعد (المسار نفسه سواء عدل الحقل أو سحب الرسم — ثنائي الاتجاه)
    const r2 = await saveGeometryDraftAction(ground.id, JSON.stringify(sampleGeometry("فصل أ المعدل", 6.5, 7)));
    expect(r2?.error).toBeUndefined();

    const versions = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    expect(versions.length).toBe(2);
    expect(Math.max(...versions.map((v) => v.version))).toBe(2);

    // النشر يزامن سجل الغرف بالاسم والأبعاد والمساحة والمحيط
    const latest = versions.find((v) => v.version === 2)!;
    const pub = await publishGeometryAction(latest.id);
    expect(pub?.error).toBeUndefined();
    const [room] = await db.select().from(rooms).where(and(eq(rooms.floorId, ground.id), eq(rooms.geomKey, "r1")));
    expect(room.nameAr).toBe("فصل أ المعدل");
    expect(Number(room.lengthM)).toBe(6.5);
    expect(Number(room.widthM)).toBe(7);
    expect(Number(room.areaM2)).toBe(45.5);
    expect(Number(room.perimeterM)).toBe(27);
    expect(room.code).toMatch(/^KHS-RM-\d{4}$/);

    // النسخة الأولى تؤرشف والثانية منشورة — التاريخ محفوظ
    const after = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    expect(after.find((v) => v.version === 2)?.status).toBe("منشورة");
  });

  it("A12: استبدال الخلفية وتحويلها لا يغيران الهندسة المتجهة", async () => {
    const { db } = await import("@/db");
    const { floors, floorGeometryVersions, floorBackgrounds, storedFiles } = await import("@/db/schema");
    const { updateBackgroundTransformAction, replaceBackgroundAction } = await import("@/app/(app)/building/actions");
    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));

    const before = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    const beforeJson = JSON.stringify(before.map((v) => ({ v: v.version, g: v.geometry })).sort((a, b) => a.v - b.v));

    // خلفية أولية
    const [f] = await db
      .insert(storedFiles)
      .values({ originalName: "bg.png", mime: "image/png", size: 10, sha256: "x", storagePath: `backgrounds/t-${Math.random()}.png` })
      .returning();
    const [bg] = await db
      .insert(floorBackgrounds)
      .values({ floorId: ground.id, fileId: f.id, transform: { x: 0, y: 0, scale: 0.05, rotation: 0, opacity: 0.6, visible: true } })
      .returning();

    // تحويل الخلفية
    await updateBackgroundTransformAction(bg.id, JSON.stringify({ x: 5, y: 3, scale: 0.08, rotation: 15, opacity: 0.4, visible: true }));

    // استبدال الخلفية بملف جديد
    const fd = new FormData();
    const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");
    fd.set("file", new File([pngBytes], "aerial-new.png", { type: "image/png" }));
    const res = await replaceBackgroundAction(ground.id, null, fd);
    expect(res?.error).toBeUndefined();

    // الهندسة المتجهة لم تتغير بتاتاً
    const after = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    const afterJson = JSON.stringify(after.map((v) => ({ v: v.version, g: v.geometry })).sort((a, b) => a.v - b.v));
    expect(afterJson).toBe(beforeJson);

    // الخلفية القديمة عطلت والجديدة نشطة
    const bgs = await db.select().from(floorBackgrounds).where(eq(floorBackgrounds.floorId, ground.id));
    expect(bgs.filter((b) => b.active).length).toBe(1);
    expect(bgs.find((b) => b.active)?.label).toBe("aerial-new.png");
  });

  it("A14: منطقة مجمع البنات (سياق) ترفض الهندسة والأصول والسجلات", async () => {
    const { db } = await import("@/db");
    const { floors, rooms } = await import("@/db/schema");
    const { saveGeometryDraftAction, createAssetAction, submitInspectionAction } = await import("@/app/(app)/building/actions");
    const [girlsFloor] = await db.select().from(floors).where(eq(floors.key, "girls-area"));

    // هندسة في منطقة السياق ترفض
    const geo = await saveGeometryDraftAction(girlsFloor.id, JSON.stringify(sampleGeometry()));
    expect(geo?.error).toContain("سياق جغرافي فقط");

    // غرفة أدخلت قسرياً في منطقة السياق — الأصل يرفض
    const [forcedRoom] = await db
      .insert(rooms)
      .values({ floorId: girlsFloor.id, geomKey: "x1", code: `KHS-RM-X${Math.floor(Math.random() * 1000)}`, nameAr: "غرفة سياق", roomType: "فصل دراسي" })
      .returning();
    const fd = new FormData();
    fd.set("nameAr", "أصل ممنوع");
    fd.set("roomId", forcedRoom.id);
    fd.set("quantity", "1");
    fd.set("condition", "جيدة");
    const asset = await createAssetAction(null, fd);
    expect(asset?.error).toContain("سياق جغرافي فقط");

    // والفحص يرفض كذلك
    const insFd = new FormData();
    insFd.set("roomId", forcedRoom.id);
    insFd.set("templateId", "123e4567-e89b-42d3-a456-426614174000");
    const ins = await submitInspectionAction(null, insFd);
    expect(ins?.error).toBeDefined();
  });

  it("الجاهزية الشفافة (v2.3 §16): حرج فاشل = غير جاهز، غير حرج = يحتاج معالجة، لا فحص = لم يبدأ", async () => {
    const { computeRoomReadiness } = await import("@/lib/building/readiness");
    const snapshot = [
      { key: "a", label: "الإضاءة", severityOnFail: "متوسط" },
      { key: "b", label: "مخرج الطوارئ", severityOnFail: "حرج" },
    ];

    const full = computeRoomReadiness({
      latestInspection: { results: [{ key: "a", ok: true }, { key: "b", ok: true }], templateSnapshot: snapshot },
    });
    expect(full.statusAr).toBe("جاهز");
    expect(full.percent).toBe(100);
    expect(full.ready).toBe(true);

    // بند حرج فاشل — لا يمكن اعتبار الغرفة جاهزة مهما كانت النسبة
    const criticalFail = computeRoomReadiness({
      latestInspection: { results: [{ key: "a", ok: true }, { key: "b", ok: false }], templateSnapshot: snapshot },
    });
    expect(criticalFail.statusAr).toBe("غير جاهز");
    expect(criticalFail.ready).toBe(false);
    expect(criticalFail.failedCritical.map((c) => c.label)).toEqual(["مخرج الطوارئ"]);

    // بند غير حرج فاشل فقط — يحتاج معالجة بنسبة ظاهرة
    const minorFail = computeRoomReadiness({
      latestInspection: { results: [{ key: "a", ok: false }, { key: "b", ok: true }], templateSnapshot: snapshot },
    });
    expect(minorFail.statusAr).toBe("يحتاج معالجة");
    expect(minorFail.percent).toBe(50);
    expect(minorFail.failedOther.map((c) => c.label)).toEqual(["الإضاءة"]);

    // لا فحص بعد — «لم يبدأ» بلا نسبة مُختلقة
    const noInspection = computeRoomReadiness({ latestInspection: null });
    expect(noInspection.statusAr).toBe("لم يبدأ");
    expect(noInspection.percent).toBeNull();
    expect(noInspection.ready).toBeNull();

    const overridden = computeRoomReadiness({
      latestInspection: null,
      override: { value: 90, reason: "قرار المدير" },
    });
    expect(overridden.statusAr).toBe("تجاوز يدوي");
    expect(overridden.percent).toBe(90);
    expect(overridden.override?.reason).toBe("قرار المدير");
  });
});

describe("مصدر حقيقة واحد: تعديل الغرفة يمر عبر مسودة الهندسة", () => {
  it("updateRoomAction يحدث السجل وينشئ/يحدث مسودة هندسة، والنشر اللاحق لا يرجع الاسم", async () => {
    const { db } = await import("@/db");
    const { floors, floorGeometryVersions, rooms } = await import("@/db/schema");
    const { saveGeometryDraftAction, publishGeometryAction, updateRoomAction } = await import("@/app/(app)/building/actions");

    // دور جديد معزول عن بقية الاختبارات
    const [first] = await db
      .insert(floors)
      .values({ key: "first", nameAr: "الدور الأول", level: 1, zoneKey: "boys", sortOrder: 2 })
      .returning();

    // نسخة 1 منشورة — تنشئ سجل الغرفة
    const geo = {
      unit: "m",
      rooms: [{ key: "u1", name: "غرفة المصدر", type: "فصل دراسي", x: 1, y: 1, w: 5, h: 4, doors: [{ side: "bottom", offset: 4.5 }] }],
    };
    expect((await saveGeometryDraftAction(first.id, JSON.stringify(geo)))?.error).toBeUndefined();
    const [v1] = await db
      .select()
      .from(floorGeometryVersions)
      .where(and(eq(floorGeometryVersions.floorId, first.id), eq(floorGeometryVersions.version, 1)));
    expect((await publishGeometryAction(v1.id))?.error).toBeUndefined();
    const [room] = await db.select().from(rooms).where(and(eq(rooms.floorId, first.id), eq(rooms.geomKey, "u1")));
    expect(room.nameAr).toBe("غرفة المصدر");

    // تعديل من صفحة الغرفة: اسم ونوع وأبعاد جديدة
    const fd = new FormData();
    fd.set("nameAr", "غرفة معدلة");
    fd.set("roomType", "معمل");
    fd.set("lengthM", "8");
    fd.set("widthM", "3");
    const res = await updateRoomAction(room.id, null, fd);
    expect(res?.error).toBeUndefined();
    expect(res?.success).toContain("مسودة");

    // السجل حدث فوراً
    const [after] = await db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(after.nameAr).toBe("غرفة معدلة");
    expect(Number(after.lengthM)).toBe(8);
    expect(Number(after.widthM)).toBe(3);

    // نشأت مسودة نسخة 2 تحمل الاسم والأبعاد نفسها (تحجيم حول ركن التثبيت + قص إزاحة الباب)
    let versions = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, first.id));
    expect(versions.length).toBe(2);
    const draft = versions.find((v) => v.version === 2)!;
    expect(draft.status).toBe("مسودة");
    const draftRoom = (draft.geometry as { rooms: { key: string; name: string; type: string; x: number; y: number; w: number; h: number; doors?: { offset: number }[] }[] }).rooms.find((r) => r.key === "u1")!;
    expect(draftRoom.name).toBe("غرفة معدلة");
    expect(draftRoom.type).toBe("معمل");
    expect(draftRoom.w).toBe(8);
    expect(draftRoom.h).toBe(3);
    expect(draftRoom.x).toBe(1); // ركن التثبيت لا يتحرك
    expect(draftRoom.y).toBe(1);
    expect(draftRoom.doors?.[0].offset).toBeLessThanOrEqual(8);

    // تعديل ثانٍ يحدث المسودة نفسها في مكانها — لا نسخة ثالثة
    const fd2 = new FormData();
    fd2.set("nameAr", "غرفة معدلة نهائية");
    fd2.set("roomType", "معمل");
    const res2 = await updateRoomAction(room.id, null, fd2);
    expect(res2?.error).toBeUndefined();
    versions = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, first.id));
    expect(versions.length).toBe(2);

    // النشر يزامن السجل من الهندسة دون أن يرجع الاسم القديم
    const latestDraft = versions.find((v) => v.version === 2)!;
    expect((await publishGeometryAction(latestDraft.id))?.error).toBeUndefined();
    const [published] = await db.select().from(rooms).where(eq(rooms.id, room.id));
    expect(published.nameAr).toBe("غرفة معدلة نهائية");
    expect(Number(published.lengthM)).toBe(8);
    expect(Number(published.widthM)).toBe(3);
    expect(Number(published.areaM2)).toBe(24);
  });
});

describe("فتح غرفة بالرمز (بديل QR اليدوي على HTTP)", () => {
  it("يحل الرمز دون حساسية لحالة الأحرف والفراغات ويرفض الرمز المجهول", async () => {
    const { db } = await import("@/db");
    const { rooms } = await import("@/db/schema");
    const { findRoomByCode } = await import("@/lib/building/codes");

    const [anyRoom] = await db.select().from(rooms).limit(1);
    expect(anyRoom).toBeDefined();

    const resolved = await findRoomByCode(`  ${anyRoom.code.toLowerCase()}  `);
    expect(resolved?.id).toBe(anyRoom.id);

    const upper = await findRoomByCode(anyRoom.code.toUpperCase());
    expect(upper?.id).toBe(anyRoom.id);

    expect(await findRoomByCode("KHS-RM-9999")).toBeNull();
    expect(await findRoomByCode("   ")).toBeNull();
  });
});

describe("دورة حياة البلاغ (v2.3 §18): مسودة ← معتمد ← إرسال ← معالجة ← نتيجة ← إغلاق", () => {
  it("الانتقالات محكومة، الإرسال يتطلب جهة، وكل انتقال يُسجَّل في السجل الإلحاقي", async () => {
    const { db } = await import("@/db");
    const { people, maintenanceIssues, maintenanceStatusHistory } = await import("@/db/schema");
    const { createIssueAction, transitionIssueAction } = await import("@/app/(app)/building/actions");

    const [person] = await db
      .insert(people)
      .values({ fullName: "مكلف الصيانة الاختباري", category: "موظف" })
      .returning();

    const title = `تسريب مكيف اختبار ${Math.random().toString(36).slice(2, 8)}`;
    const fd = new FormData();
    fd.set("title", title);
    fd.set("description", "بلاغ اختبار سير العمل");
    fd.set("ownerPersonId", person.id);
    fd.set("priority", "عالية");
    const created = await createIssueAction(null, fd);
    expect(created?.error).toBeUndefined();

    const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.title, title));
    expect(issue.ownerPersonId).toBe(person.id);
    expect(issue.status).toBe("مسودة");

    const go = async (entries: Record<string, string>) => {
      const f = new FormData();
      f.set("issueId", issue.id);
      for (const [k, v] of Object.entries(entries)) f.set(k, v);
      return transitionIssueAction(null, f);
    };

    // انتقال غير مسموح من «مسودة»
    const illegal = await go({ toStatus: "تم الإصلاح" });
    expect(illegal?.error).toContain("لا يمكن الانتقال");

    // اعتماد
    expect((await go({ toStatus: "معتمد" }))?.success).toBeTruthy();
    let [cur] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issue.id));
    expect(cur.status).toBe("معتمد");
    expect(cur.approvedBy).toBe(testUserId);
    expect(cur.approvedAt).not.toBeNull();

    // الإرسال بلا جهة مستلمة يُرفض
    const noRecipient = await go({ toStatus: "تم الإرسال" });
    expect(noRecipient?.error).toContain("الجهة المستلمة");

    expect((await go({ toStatus: "تم الإرسال", sentTo: "شركة الصيانة المتحدة", sentAt: "2026-08-01" }))?.success).toBeTruthy();
    [cur] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issue.id));
    expect(cur.sentTo).toBe("شركة الصيانة المتحدة");
    expect(cur.sentAt).toBe("2026-08-01");

    expect((await go({ toStatus: "تحت المعالجة" }))?.success).toBeTruthy();
    expect(
      (
        await go({
          toStatus: "تم الإصلاح",
          visitDate: "2026-08-05",
          actionTaken: "استبدال صمام التصريف",
          repairNote: "تم الاختبار بعد الإصلاح",
        })
      )?.success,
    ).toBeTruthy();
    [cur] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issue.id));
    expect(cur.resolution).toBe("تم الإصلاح");
    expect(cur.visitDate).toBe("2026-08-05");
    expect(cur.closedAt).toBeNull();

    // الإغلاق بعد «تم الإصلاح» لا يتطلب سبباً — ويختم التاريخ والمتحقق
    expect((await go({ toStatus: "مغلق" }))?.success).toBeTruthy();
    const [closed] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issue.id));
    expect(closed.status).toBe("مغلق");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.verifiedBy).toBe(testUserId);
    expect(closed.repairNote).toBe("تم الاختبار بعد الإصلاح");

    // البلاغ المغلق نهائي
    const afterClose = await go({ toStatus: "تحت المعالجة" });
    expect(afterClose?.error).toContain("لا يمكن الانتقال");

    // السجل الإلحاقي: إنشاء + 5 انتقالات ناجحة
    const history = await db
      .select()
      .from(maintenanceStatusHistory)
      .where(eq(maintenanceStatusHistory.issueId, issue.id));
    expect(history.map((h) => h.toStatus)).toEqual([
      "مسودة",
      "معتمد",
      "تم الإرسال",
      "تحت المعالجة",
      "تم الإصلاح",
      "مغلق",
    ]);
  });

  it("إغلاق «لم يتم الإصلاح» يتطلب سبباً وتوصية وقرار تصعيد", async () => {
    const { db } = await import("@/db");
    const { maintenanceIssues } = await import("@/db/schema");
    const { createIssueAction, transitionIssueAction } = await import("@/app/(app)/building/actions");

    const title = `عطل لم يُصلح ${Math.random().toString(36).slice(2, 8)}`;
    const fd = new FormData();
    fd.set("title", title);
    fd.set("priority", "متوسطة");
    await createIssueAction(null, fd);
    const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.title, title));

    const go = async (entries: Record<string, string>) => {
      const f = new FormData();
      f.set("issueId", issue.id);
      for (const [k, v] of Object.entries(entries)) f.set(k, v);
      return transitionIssueAction(null, f);
    };

    await go({ toStatus: "معتمد" });
    await go({ toStatus: "تحت المعالجة" });
    await go({ toStatus: "لم يتم الإصلاح", actionTaken: "زيارة دون قطع الغيار المطلوبة" });

    // الإغلاق بلا سبب/توصية/تصعيد يُرفض
    expect((await go({ toStatus: "مغلق" }))?.error).toContain("سبب الإغلاق");
    expect((await go({ toStatus: "مغلق", closureReason: "تعذر توفير قطع الغيار" }))?.error).toContain("توصية");
    expect(
      (
        await go({
          toStatus: "مغلق",
          closureReason: "تعذر توفير قطع الغيار",
          followupRecommendation: "إعادة البلاغ مطلع الفصل القادم",
        })
      )?.error,
    ).toContain("تصعيد");

    const closedOk = await go({
      toStatus: "مغلق",
      closureReason: "تعذر توفير قطع الغيار",
      followupRecommendation: "إعادة البلاغ مطلع الفصل القادم",
      escalationNeeded: "نعم",
    });
    expect(closedOk?.success).toBeTruthy();
    const [closed] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issue.id));
    expect(closed.status).toBe("مغلق");
    expect(closed.resolution).toBe("لم يتم الإصلاح");
    expect(closed.closureReason).toBe("تعذر توفير قطع الغيار");
    expect(closed.escalationNeeded).toBe(true);
  });

  it("البلاغ يرفض مكلفاً غير موجود في سجل الأشخاص النشطين", async () => {
    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    const { createIssueAction } = await import("@/app/(app)/building/actions");

    const [inactive] = await db
      .insert(people)
      .values({ fullName: "موظف موقوف", category: "موظف", active: false })
      .returning();
    const fd = new FormData();
    fd.set("title", "بلاغ بمكلف موقوف");
    fd.set("ownerPersonId", inactive.id);
    const res = await createIssueAction(null, fd);
    expect(res?.error).toContain("سجل الأشخاص");
  });
});

describe("مزامنة الفحص دون اتصال (A13)", () => {
  it("إعادة إرسال الدفعة نفسها لا تنشئ سجلات مكررة", async () => {
    const { db } = await import("@/db");
    const { floors, rooms, inspectionTemplates, inspections } = await import("@/db/schema");
    const { POST } = await import("@/app/api/sync/inspections/route");
    const { NextRequest } = await import("next/server");

    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));
    const [room] = await db
      .insert(rooms)
      .values({ floorId: ground.id, geomKey: `sync-${Math.random()}`, code: `KHS-RM-S${Math.floor(Math.random() * 10000)}`, nameAr: "غرفة مزامنة", roomType: "فصل دراسي" })
      .returning();
    const [template] = await db
      .insert(inspectionTemplates)
      .values({ nameAr: "قالب مزامنة", roomType: null, items: [{ key: "a", label: "بند", required: true }], status: "معتمد" })
      .returning();

    const ops = [
      {
        clientOpId: `op-${Math.random().toString(36).slice(2)}-1`,
        roomId: room.id,
        templateId: template.id,
        inspectedAt: new Date().toISOString(),
        results: [{ key: "a", ok: true }],
        notes: "فحص دون اتصال",
      },
    ];
    const makeReq = () =>
      new NextRequest("http://localhost/api/sync/inspections", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" },
        body: JSON.stringify({ ops }),
      });

    const res1 = await POST(makeReq());
    const json1 = await res1.json();
    expect(json1.applied.length).toBe(1);
    expect(json1.skipped.length).toBe(0);

    // إعادة الإرسال (انقطاع اتصال ثم إعادة محاولة) — لا تكرار
    const res2 = await POST(makeReq());
    const json2 = await res2.json();
    expect(json2.applied.length).toBe(0);
    expect(json2.skipped.length).toBe(1);

    const stored = await db.select().from(inspections).where(eq(inspections.roomId, room.id));
    expect(stored.length).toBe(1);
  });

  it("المزامنة ترفض دون رمز الحماية أو في منطقة السياق", async () => {
    const { db } = await import("@/db");
    const { floors, rooms, inspectionTemplates } = await import("@/db/schema");
    const { POST } = await import("@/app/api/sync/inspections/route");
    const { NextRequest } = await import("next/server");

    // بلا رمز حماية
    const badCsrf = new NextRequest("http://localhost/api/sync/inspections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: [] }),
    });
    expect((await POST(badCsrf)).status).toBe(403);

    // غرفة في منطقة السياق
    const [girlsFloor] = await db.select().from(floors).where(eq(floors.key, "girls-area"));
    const [ctxRoom] = await db
      .insert(rooms)
      .values({ floorId: girlsFloor.id, geomKey: `g-${Math.random()}`, code: `KHS-RM-G${Math.floor(Math.random() * 10000)}`, nameAr: "سياق", roomType: "فصل دراسي" })
      .returning();
    const [template] = await db
      .insert(inspectionTemplates)
      .values({ nameAr: "قالب", roomType: null, items: [{ key: "a", label: "بند", required: true }], status: "معتمد" })
      .returning();
    const req = new NextRequest("http://localhost/api/sync/inspections", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "csrf-test-token" },
      body: JSON.stringify({
        ops: [{
          clientOpId: `ctx-${Math.random().toString(36).slice(2)}`,
          roomId: ctxRoom.id,
          templateId: template.id,
          inspectedAt: new Date().toISOString(),
          results: [{ key: "a", ok: true }],
        }],
      }),
    });
    const json = await (await POST(req)).json();
    expect(json.failed.length).toBe(1);
    expect(json.failed[0].error).toContain("سياق");
  });

  it("التراجع الموثق يُنشئ نسخة جديدة (لا يستبدل)، بسبب إلزامي محفوظ", async () => {
    const { db } = await import("@/db");
    const { floors, floorGeometryVersions } = await import("@/db/schema");
    const { saveGeometryDraftAction, rollbackGeometryAction } = await import("@/app/(app)/building/actions");
    const [ground] = await db.select().from(floors).where(eq(floors.key, "ground"));
    await saveGeometryDraftAction(ground.id, JSON.stringify(sampleGeometry("نسخة للتراجع", 4, 4)));
    const versions = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    const target = versions.reduce((a, b) => (a.version < b.version ? b : a));
    const countBefore = versions.length;

    // سبب قصير يُرفض
    expect((await rollbackGeometryAction(target.id, "لا"))?.error).toContain("إلزامي");

    const res = await rollbackGeometryAction(target.id, "استعادة مخطط سابق بعد مراجعة الصورة المصدرية");
    expect(res?.error).toBeUndefined();
    const after = await db.select().from(floorGeometryVersions).where(eq(floorGeometryVersions.floorId, ground.id));
    expect(after.length).toBe(countBefore + 1); // نسخة جديدة، لا استبدال
    const newest = after.reduce((a, b) => (a.version < b.version ? b : a));
    expect(newest.status).toBe("مسودة");
    expect(newest.note).toContain("تراجع موثق");
    expect(newest.note).toContain("استعادة مخطط سابق");
  });

  it("منع تكرار الأصول: نفس الرقم التسلسلي أو نفس الاسم في الغرفة نفسها", async () => {
    const { db } = await import("@/db");
    const { rooms } = await import("@/db/schema");
    const { createAssetAction } = await import("@/app/(app)/building/actions");
    const [room] = await db.select().from(rooms).limit(1);

    const mk = (name: string, serial?: string) => {
      const fd = new FormData();
      fd.set("nameAr", name);
      fd.set("roomId", room.id);
      fd.set("condition", "جيدة");
      if (serial) {
        fd.set("important", "on"); // الرقم التسلسلي يُحفظ للأصول المهمة
        fd.set("serialNumber", serial);
      }
      return fd;
    };

    expect((await createAssetAction(null, mk("سبورة ذكية", "SN-100")))?.error).toBeUndefined();
    // نفس الرقم التسلسلي → يُرفض
    expect((await createAssetAction(null, mk("سبورة أخرى", "SN-100")))?.error).toContain("الرقم التسلسلي");
    // نفس الاسم في الغرفة نفسها → يُرفض
    expect((await createAssetAction(null, mk("سبورة ذكية")))?.error).toContain("مسجل مسبقاً");
    // اسم مختلف بلا تسلسل → يُقبل
    expect((await createAssetAction(null, mk("كرسي معلم")))?.error).toBeUndefined();
  });
});

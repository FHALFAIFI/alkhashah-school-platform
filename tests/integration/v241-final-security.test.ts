import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4.1 §6 — المراجعة الأمنية للنطاق الموحّد النهائي.
 *
 * تركّز على الحذف النهائي (أخطر ميزة) وعلى الأسطح الجديدة: الصلاحية، والإسناد الجماعي،
 * وتنظيف الملفات، وحقن HTML في التقارير، والمعرّفات الملفَّقة.
 */

let pool: Pool;
let actorId = "";
/** مجموعة صلاحيات المستخدم المحاكى — تُبدَّل داخل الاختبار لفحص الحرمان */
let grantedPermissions = new Set<string>();

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async (...keys: string[]) => {
    for (const k of keys) {
      if (!grantedPermissions.has(k)) {
        const e = new Error("لا تملك الصلاحية اللازمة لهذا الإجراء") as Error & { status: number };
        e.status = 403;
        throw e;
      }
    }
    return {
      id: actorId,
      username: "t",
      displayName: "مستخدم",
      personId: null,
      permissions: grantedPermissions,
      roleKeys: new Set<string>(),
      csrfToken: "x",
      sessionId: "x",
    };
  }),
  requireUser: vi.fn(async () => ({ id: actorId, permissions: grantedPermissions })),
  getCurrentUser: vi.fn(async () => null),
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
  grantedPermissions = new Set([
    "people.read", "people.write", "people.delete", "performance.individual.read",
    "performance.read", "performance.write", "performance.approve",
    "plan.read", "plan.write", "maintenance.read", "maintenance.write", "inspections.write",
  ]);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-sec", displayName: "المدير", passwordHash: "x" }).returning();
  actorId = u.id;
});

async function makePerson(name = "منسوب أمني") {
  const { db } = await import("@/db");
  const { people } = await import("@/db/schema");
  const [p] = await db.insert(people).values({ fullName: name, category: "معلم", employeeType: "معلم" }).returning();
  return p;
}

describe("§6 — الصلاحية تُفرض على الخادم لا في الواجهة", () => {
  it("حذف الموظف نهائياً يتطلب الصلاحيتين معاً — الاطلاع الفردي شرط لا زينة", async () => {
    const person = await makePerson();
    const { purgePersonAction } = await import("@/app/(app)/people/actions");
    const fd = new FormData();
    fd.set("confirm", "1");
    fd.set("reason", "محاولة بلا صلاحية");
    fd.set("typedName", person.fullName);

    // «مسؤول النظام» نموذجياً: يملك الحذف ولا يملك الاطلاع الفردي (D-013)
    grantedPermissions = new Set(["people.read", "people.write", "people.delete"]);
    await expect(purgePersonAction(person.id, null, fd)).rejects.toThrow();

    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    expect(await db.select().from(people).where(eq(people.id, person.id))).toHaveLength(1);
  });

  it("حذف دورة الأداء يتطلب الكتابة والاعتماد والاطلاع الفردي", async () => {
    const { deleteCycleAction } = await import("@/app/(app)/performance/actions");
    const fd = new FormData();
    fd.set("confirm", "1");
    for (const missing of ["performance.write", "performance.approve", "performance.individual.read"]) {
      grantedPermissions = new Set(["performance.write", "performance.approve", "performance.individual.read"]);
      grantedPermissions.delete(missing);
      await expect(deleteCycleAction("00000000-0000-4000-8000-000000000000", null, fd)).rejects.toThrow();
    }
  });

  it("تعديل البرنامج يتطلب plan.write", async () => {
    grantedPermissions = new Set(["plan.read"]);
    const { updateProgramAction } = await import("@/app/(app)/plan/actions");
    const fd = new FormData();
    fd.set("updatedToken", new Date().toISOString());
    fd.set("field_name", "محاولة");
    await expect(updateProgramAction("00000000-0000-4000-8000-000000000000", null, fd)).rejects.toThrow();
  });

  it("تحرير بيانات تقرير الصيانة يتطلب maintenance.write", async () => {
    grantedPermissions = new Set(["maintenance.read"]);
    const { updateIssueReportFieldsAction } = await import("@/app/(app)/building/actions");
    await expect(
      updateIssueReportFieldsAction("00000000-0000-4000-8000-000000000000", null, new FormData()),
    ).rejects.toThrow();
  });
});

describe("§6 — إقرار التنفيذ لا يُتجاوز، والمعرّف الملفَّق لا يمرّ", () => {
  it("غياب مربع التأكيد يوقف الحذف قبل أي قراءة", async () => {
    const person = await makePerson();
    const { purgePersonAction } = await import("@/app/(app)/people/actions");
    const fd = new FormData();
    fd.set("reason", "سبب كافٍ للحذف");
    fd.set("typedName", person.fullName);
    expect((await purgePersonAction(person.id, null, fd))?.error).toContain("أكّد");

    const { db } = await import("@/db");
    const { people } = await import("@/db/schema");
    expect(await db.select().from(people).where(eq(people.id, person.id))).toHaveLength(1);
  });

  it("معرّف غير صالح يعيد رسالة عربية لا استثناء قاعدة بيانات", async () => {
    const { purgePersonAction } = await import("@/app/(app)/people/actions");
    const fd = new FormData();
    fd.set("confirm", "1");
    fd.set("reason", "سبب كافٍ للحذف");
    fd.set("typedName", "أي اسم");
    expect((await purgePersonAction("'; DROP TABLE people; --", null, fd))?.error).toBe("المنسوب غير موجود");
  });

  it("الاسم المكتوب لا يُقبل بفراغات محيطة مختلفة عن الاسم الحقيقي", async () => {
    const person = await makePerson("اسم دقيق");
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    expect((await deletePersonPermanently({ personId: person.id, actorId, reason: "سبب كافٍ", typedName: "اسم دقيقX" })).error).toBeTruthy();
    // الفراغ المحيط وحده مقبول (تسامح مع النسخ واللصق) — الاختلاف الحقيقي مرفوض
    expect((await deletePersonPermanently({ personId: person.id, actorId, reason: "سبب كافٍ", typedName: "  اسم دقيق  " })).error).toBeUndefined();
  });
});

describe("§6 — تنظيف الملفات: اليتيم يُمحى والمشترك يبقى", () => {
  it("ملف الوثيقة الخاصة بالدورة يُحذف، وملف مشترك مع اجتماع يبقى", async () => {
    const { db } = await import("@/db");
    const {
      people, perfModels, perfIndicators, perfCycles, perfSessions, documents,
      storedFiles, planYears, committeeTemplates, committees, meetings, meetingAttachments,
    } = await import("@/db/schema");
    const { storage } = await import("@/lib/storage");

    const [person] = await db.insert(people).values({ fullName: "صاحب الملفات", category: "معلم" }).returning();
    const [model] = await db.insert(perfModels).values({ key: "m-file", nameAr: "ن", audience: "معلم" }).returning();
    const [ind] = await db.insert(perfIndicators).values({ modelId: model.id, nameAr: "مؤشر", weight: "100" }).returning();
    const [cycle] = await db
      .insert(perfCycles)
      .values({
        personId: person.id,
        cycleType: "معلم",
        yearKey: "1448",
        modelId: model.id,
        modelSnapshot: { model: { nameAr: "ن" }, indicators: [{ id: ind.id, nameAr: "مؤشر", weight: "100" }] },
      })
      .returning();
    const [session] = await db.insert(perfSessions).values({ cycleId: cycle.id, sessionType: "نهائي" }).returning();

    // ملف يتيم (وثيقة الدورة وحدها) وملف مشترك (مرفق اجتماع أيضاً)
    await storage.put("reports/aa/orphan.pdf", Buffer.from("%PDF-orphan"));
    await storage.put("reports/bb/shared.pdf", Buffer.from("%PDF-shared"));
    const [orphanFile] = await db
      .insert(storedFiles)
      .values({ originalName: "orphan.pdf", mime: "application/pdf", size: 11, sha256: "a".repeat(64), storagePath: "reports/aa/orphan.pdf", scope: "reports" })
      .returning();
    const [sharedFile] = await db
      .insert(storedFiles)
      .values({ originalName: "shared.pdf", mime: "application/pdf", size: 11, sha256: "b".repeat(64), storagePath: "reports/bb/shared.pdf", scope: "reports" })
      .returning();

    await db.insert(documents).values([
      { docNumber: "D-1", verificationCode: "V-1", docType: "employee_performance_report", title: "t1", entityType: "perf_session", entityId: session.id, pdfFileId: orphanFile.id },
      { docNumber: "D-2", verificationCode: "V-2", docType: "employee_performance_report", title: "t2", entityType: "perf_session", entityId: session.id, pdfFileId: sharedFile.id },
    ]);

    // مرجع ثانٍ للملف المشترك من سجل مؤسسي باقٍ
    const [year] = await db.insert(planYears).values({ key: "1448-1449", nameAr: "y" }).returning();
    const [tpl] = await db.insert(committeeTemplates).values({ key: "c-file", nameAr: "لجنة", kind: "لجنة" }).returning();
    const [committee] = await db.insert(committees).values({ templateId: tpl.id, planYearId: year.id, nameAr: "لجنة", kind: "لجنة" }).returning();
    const [meeting] = await db.insert(meetings).values({ committeeId: committee.id, seq: 1 }).returning();
    await db.insert(meetingAttachments).values({ meetingId: meeting.id, title: "مرفق", category: "أخرى", fileId: sharedFile.id });

    const { deleteCyclePermanently } = await import("@/lib/lifecycle-delete");
    const res = await deleteCyclePermanently({ cycleId: cycle.id, actorId, reason: "تنظيف دورة تجريبية", typedConfirm: "1448" });
    expect(res.error).toBeUndefined();

    // الصف اليتيم اختفى ومعه ملفه على القرص
    expect(await db.select().from(storedFiles).where(eq(storedFiles.id, orphanFile.id))).toHaveLength(0);
    await expect(storage.get("reports/aa/orphan.pdf")).rejects.toThrow();
    // المشترك باقٍ صفاً وملفاً — مرجعه المؤسسي يمنع حذفه
    expect(await db.select().from(storedFiles).where(eq(storedFiles.id, sharedFile.id))).toHaveLength(1);
    await expect(storage.get("reports/bb/shared.pdf")).resolves.toBeTruthy();
  });
});

describe("§6 — لا حقن HTML في تقرير الصيانة", () => {
  it("النص الخبيث في حقول التقرير يُهرَّب ولا يُنفَّذ", async () => {
    const { db } = await import("@/db");
    const { floors, rooms, maintenanceIssues, documents } = await import("@/db/schema");
    const [floor] = await db.insert(floors).values({ key: "sec-g", nameAr: "الأرضي", level: 0 }).returning();
    const [room] = await db
      .insert(rooms)
      .values({ floorId: floor.id, geomKey: "sec-r", code: "KHS-RM-7701", nameAr: "غرفة", roomType: "فصل" })
      .returning();
    const [issue] = await db
      .insert(maintenanceIssues)
      .values({ code: "KHS-MNT-7701", title: "بلاغ", roomId: room.id, status: "معتمد", approvedBy: actorId, approvedAt: new Date() })
      .returning();

    // DEBUG
    const rawCheck = await pool.query("select count(*)::int c, (select count(*)::int from users) u from maintenance_issues");
    console.log("DEBUG rows:", rawCheck.rows[0], "issueId:", issue?.id, "actorId:", actorId);
    const { updateIssueReportFieldsAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("safetyImpact", '<img src=x onerror="alert(1)">');
    fd.set("operationalImpact", "</table><script>alert(2)</script>");
    fd.set("requestedAction", "\"><svg/onload=alert(3)>");
    await updateIssueReportFieldsAction(issue.id, null, fd);

    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    const letter = await generateMaintenanceLetter({ issueId: issue.id, issuedBy: actorId });
    const [doc] = await db.select().from(documents).where(eq(documents.id, letter.documentId));
    const html = doc.htmlSnapshot ?? "";

    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).not.toContain("onerror=\"alert(1)\"");
    expect(html).not.toContain("<svg/onload=");
    // والنص نفسه محفوظ مهرَّباً لا محذوفاً — لا يُعاد كتابة إدخال المستخدم
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("§6 — التكرار والاستدعاء المُعاد", () => {
  it("إعادة إرسال طلب الحذف بعد نجاحه لا تُتلف شيئاً وتعيد رسالة واضحة", async () => {
    const person = await makePerson("منسوب مكرر");
    const { deletePersonPermanently } = await import("@/lib/lifecycle-delete");
    const first = await deletePersonPermanently({ personId: person.id, actorId, reason: "حذف أول", typedName: person.fullName });
    expect(first.error).toBeUndefined();
    const replay = await deletePersonPermanently({ personId: person.id, actorId, reason: "إعادة إرسال", typedName: person.fullName });
    expect(replay.error).toBe("المنسوب غير موجود");

    // شاهد واحد فقط — الإعادة لا تكتب شاهداً ثانياً
    const { db } = await import("@/db");
    const { deletionTombstones } = await import("@/db/schema");
    expect(await db.select().from(deletionTombstones).where(eq(deletionTombstones.entityId, person.id))).toHaveLength(1);
  });
});

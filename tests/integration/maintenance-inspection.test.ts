import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4.1 §1.2 / §5.2 — «الصيانة ← إجراء فحص ← بلاغ منفصل لكل ملاحظة».
 *
 * الشرط الجوهري: **لا تجميع**. ثلاث ملاحظات قابلة للمعالجة تنتج ثلاثة بلاغات مستقلة، كل
 * واحد مرتبط بملاحظته وبفحصها وبموقعها ونصها. والازدواج يُمنع لكل بند على حدة.
 */

let pool: Pool;
let userId = "";
let roomId = "";
let templateId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: userId,
    username: "t",
    displayName: "المدير",
    personId: null,
    permissions: new Set(["inspections.read", "inspections.write", "maintenance.read", "maintenance.write", "reports.generate", "building.read"]),
    roleKeys: new Set<string>(),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: userId, permissions: new Set() })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ITEMS = [
  { key: "power", label: "لوحة الكهرباء", required: true },
  { key: "water", label: "تسريب المياه", required: true },
  { key: "door", label: "باب الطوارئ", required: true },
  { key: "board", label: "السبورة", required: false },
];

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
  const { users, floors, rooms, inspectionTemplates } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-mnt-insp", displayName: "المدير", passwordHash: "x" }).returning();
  userId = u.id;
  const [floor] = await db.insert(floors).values({ key: "mi-ground", nameAr: "الدور الأرضي", level: 0 }).returning();
  const [room] = await db
    .insert(rooms)
    .values({ floorId: floor.id, geomKey: "mi-r1", code: "KHS-RM-8801", nameAr: "فصل الفحص", roomType: "فصل دراسي" })
    .returning();
  roomId = room.id;
  const [tpl] = await db
    .insert(inspectionTemplates)
    .values({ nameAr: "قالب عام", roomType: null, items: ITEMS, status: "معتمد", version: 1 })
    .returning();
  templateId = tpl.id;
});

/** يسجّل فحصاً تفشل فيه البنود المذكورة */
async function runInspection(failing: string[]) {
  const { submitInspectionAction } = await import("@/app/(app)/building/actions");
  const fd = new FormData();
  fd.set("roomId", roomId);
  fd.set("templateId", templateId);
  for (const item of ITEMS) {
    fd.set(`item_${item.key}`, failing.includes(item.key) ? "not_ok" : "ok");
    if (failing.includes(item.key)) fd.set(`note_${item.key}`, `ملاحظة ${item.label}`);
  }
  return submitInspectionAction(null, fd);
}

describe("§5.2 — الفحص يُسجَّل ويعلن ملاحظاته فوراً", () => {
  it("يعيد الرسالة المقرَّرة وقائمة الملاحظات جاهزةً للمراجعة", async () => {
    const res = await runInspection(["power", "water", "door"]);
    expect(res?.error).toBeUndefined();
    expect(res?.success).toBe("تم تسجيل 3 ملاحظات تحتاج إلى صيانة");
    expect(res?.findingsCount).toBe(3);
    expect(res?.inspectionId).toBeTruthy();
    expect(res?.findings).toHaveLength(3);
    for (const f of res!.findings!) {
      expect(f.label).toBeTruthy();
      expect(f.severity).toBeTruthy();
      expect(f.duplicateIssue).toBeNull();
    }
  });

  it("الفحص السليم بالكامل يقول ذلك ولا يعرض تحويلاً", async () => {
    const res = await runInspection([]);
    expect(res?.success).toContain("كل البنود سليمة");
    expect(res?.findings).toBeUndefined();
  });
});

describe("§5.2 — بلاغ منفصل لكل ملاحظة", () => {
  it("تحويل الثلاث ملاحظات ينتج ثلاثة بلاغات مستقلة مرتبطة كلٌّ بملاحظته", async () => {
    const inspection = await runInspection(["power", "water", "door"]);
    const { createIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("inspectionId", inspection!.inspectionId!);
    const res = await createIssuesFromInspectionAction(null, fd);
    expect(res?.error).toBeUndefined();

    const { db } = await import("@/db");
    const { maintenanceIssues, inspectionFindings } = await import("@/db/schema");
    const issues = await db.select().from(maintenanceIssues);
    expect(issues).toHaveLength(3);
    // رموز فريدة — لا بلاغ مجمَّع ولا رمز مكرر
    expect(new Set(issues.map((i) => i.code)).size).toBe(3);

    const findings = await db.select().from(inspectionFindings).where(eq(inspectionFindings.inspectionId, inspection!.inspectionId!));
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.maintenanceIssueId).toBeTruthy();
      const issue = issues.find((i) => i.id === f.maintenanceIssueId)!;
      // ربط ثنائي الاتجاه + وراثة الموقع ونص الملاحظة
      expect(issue.inspectionFindingId).toBe(f.id);
      expect(issue.roomId).toBe(roomId);
      expect(issue.title).toContain(f.label);
      expect(issue.description).toBe(f.note);
      // حقول تقرير الصيانة مملوءة من الملاحظة نفسها لا مخترعة
      expect(issue.safetyImpact).toBeTruthy();
      expect(issue.requestedAction).toBe("الكشف والمعالجة وإفادتنا بالنتيجة");
      // التصنيف يبقى فارغاً حتى يختاره المدير — لا تخمين لنوع العطل
      expect(issue.category).toBeNull();
    }
    // كل بلاغ في حالة «مسودة» بسجل انتقال أول
    expect(issues.every((i) => i.status === "مسودة")).toBe(true);
  });

  it("«إنشاء البلاغات المحددة» ينشئ للمختار وحده", async () => {
    const inspection = await runInspection(["power", "water", "door"]);
    const selected = inspection!.findings!.slice(0, 2).map((f) => f.id);

    const { createSelectedIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("inspectionId", inspection!.inspectionId!);
    for (const id of selected) fd.append("findingId", id);
    const res = await createSelectedIssuesFromInspectionAction(null, fd);
    expect(res?.error).toBeUndefined();
    expect(res?.success).toContain("منفصلاً");

    const { db } = await import("@/db");
    const { maintenanceIssues, inspectionFindings } = await import("@/db/schema");
    expect(await db.select().from(maintenanceIssues)).toHaveLength(2);
    const withIssue = (await db.select().from(inspectionFindings)).filter((f) => f.maintenanceIssueId);
    expect(withIssue.map((f) => f.id).sort()).toEqual([...selected].sort());
  });

  it("اختيار فارغ أو معرّف من فحص آخر يُرفض — لا إنشاء من معرّف مُلفَّق", async () => {
    const first = await runInspection(["power"]);
    const second = await runInspection(["water"]);
    const { createSelectedIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");

    const empty = new FormData();
    empty.set("inspectionId", first!.inspectionId!);
    expect((await createSelectedIssuesFromInspectionAction(null, empty))?.error).toContain("اختر ملاحظة");

    // ملاحظة من الفحص الثاني مع معرّف الفحص الأول
    const crossed = new FormData();
    crossed.set("inspectionId", first!.inspectionId!);
    crossed.append("findingId", second!.findings![0].id);
    expect((await createSelectedIssuesFromInspectionAction(null, crossed))?.error).toContain("لا تنتمي لهذا الفحص");

    const { db } = await import("@/db");
    const { maintenanceIssues } = await import("@/db/schema");
    expect(await db.select().from(maintenanceIssues)).toHaveLength(0);
  });
});

describe("§5.2 — منع الازدواج", () => {
  it("فحص ثانٍ يفشل فيه البند نفسه يُعلَّم مكرراً ولا يُنشئ بلاغاً ثانياً", async () => {
    const first = await runInspection(["power"]);
    const { createIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("inspectionId", first!.inspectionId!);
    await createIssuesFromInspectionAction(null, fd);

    // فحص ثانٍ لنفس البند في نفس الغرفة
    const second = await runInspection(["power"]);
    expect(second!.findings).toHaveLength(1);
    const dup = second!.findings![0].duplicateIssue;
    expect(dup).toBeTruthy();
    expect(dup!.status).toBe("مسودة");

    const fd2 = new FormData();
    fd2.set("inspectionId", second!.inspectionId!);
    const res = await createIssuesFromInspectionAction(null, fd2);
    expect(res?.error).toContain("بلاغ مفتوح لنفس البند");

    const { db } = await import("@/db");
    const { maintenanceIssues } = await import("@/db/schema");
    expect(await db.select().from(maintenanceIssues)).toHaveLength(1);
  });

  it("البلاغ المغلق يسمح بإعادة الإبلاغ عن البند نفسه", async () => {
    const first = await runInspection(["power"]);
    const { createIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("inspectionId", first!.inspectionId!);
    await createIssuesFromInspectionAction(null, fd);

    const { db } = await import("@/db");
    const { maintenanceIssues } = await import("@/db/schema");
    await db.update(maintenanceIssues).set({ status: "مغلق" });

    const second = await runInspection(["power"]);
    expect(second!.findings![0].duplicateIssue).toBeNull();
    const fd2 = new FormData();
    fd2.set("inspectionId", second!.inspectionId!);
    expect((await createIssuesFromInspectionAction(null, fd2))?.error).toBeUndefined();
    expect(await db.select().from(maintenanceIssues)).toHaveLength(2);
  });
});

describe("§5.2 — تقرير الصيانة الرسمي", () => {
  it("يتضمن الحقول المطلوبة كاملةً وخانة التوقيع", async () => {
    const inspection = await runInspection(["power"]);
    const { createIssuesFromInspectionAction, transitionIssueAction, updateIssueReportFieldsAction } = await import(
      "@/app/(app)/building/actions"
    );
    const fd = new FormData();
    fd.set("inspectionId", inspection!.inspectionId!);
    await createIssuesFromInspectionAction(null, fd);

    const { db } = await import("@/db");
    const { maintenanceIssues, documents } = await import("@/db/schema");
    const [issue] = await db.select().from(maintenanceIssues);

    // بيانات التقرير قابلة للتحرير قبل الاعتماد وبعده
    const fields = new FormData();
    fields.set("category", "كهرباء");
    fields.set("safetyImpact", "خطر تماس كهربائي على الطلاب");
    fields.set("operationalImpact", "تعذّر استخدام الفصل");
    fields.set("requestedAction", "فصل التيار والإصلاح العاجل");
    expect((await updateIssueReportFieldsAction(issue.id, null, fields))?.error).toBeUndefined();

    // تصنيف خارج القائمة يُحفظ فارغاً لا مرفوضاً — الحقل اختياري
    const bad = new FormData();
    bad.set("category", "<script>alert(1)</script>");
    await updateIssueReportFieldsAction(issue.id, null, bad);
    const [afterBad] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, issue.id));
    expect(afterBad.category).toBeNull();

    // نعيد التصنيف الصحيح ثم نعتمد ونصدر
    await updateIssueReportFieldsAction(issue.id, null, fields);
    const approve = new FormData();
    approve.set("issueId", issue.id);
    approve.set("toStatus", "معتمد");
    expect((await transitionIssueAction(null, approve))?.error).toBeUndefined();

    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    const letter = await generateMaintenanceLetter({ issueId: issue.id, issuedBy: userId });
    expect(letter.docNumber).toBeTruthy();

    const [doc] = await db.select().from(documents).where(eq(documents.id, letter.documentId));
    const html = doc.htmlSnapshot ?? "";
    for (const required of [
      "رقم البلاغ المرجعي",
      "تاريخ البلاغ",
      "الموقع",
      "تصنيف الصيانة",
      "كهرباء",
      "وصف المشكلة",
      "الأولوية",
      "ملاحظة الفحص المصدر",
      "أثر السلامة",
      "خطر تماس كهربائي على الطلاب",
      "الأثر التشغيلي",
      "تعذّر استخدام الفصل",
      "الإجراء المطلوب",
      "فصل التيار والإصلاح العاجل",
      "الاعتماد والتوقيع",
      "التوقيع",
    ]) {
      expect({ required, present: html.includes(required) }).toEqual({ required, present: true });
    }
    // رقم الوثيقة ورمز التحقق في اللقطة المجمّدة
    expect(html).toContain(doc.docNumber);
    expect(html).toContain(doc.verificationCode);
  });

  it("البلاغ المسودة لا يُصدَر له خطاب", async () => {
    const inspection = await runInspection(["power"]);
    const { createIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("inspectionId", inspection!.inspectionId!);
    await createIssuesFromInspectionAction(null, fd);

    const { db } = await import("@/db");
    const { maintenanceIssues } = await import("@/db/schema");
    const [issue] = await db.select().from(maintenanceIssues);
    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    await expect(generateMaintenanceLetter({ issueId: issue.id, issuedBy: userId })).rejects.toThrow();
  });

  it("الفحص يبقى مرئياً من الملاحظة وبلاغها معاً — الربط ثنائي الاتجاه محفوظ", async () => {
    const inspection = await runInspection(["water"]);
    const { createIssuesFromInspectionAction } = await import("@/app/(app)/building/actions");
    const fd = new FormData();
    fd.set("inspectionId", inspection!.inspectionId!);
    await createIssuesFromInspectionAction(null, fd);

    const { db } = await import("@/db");
    const { maintenanceIssues, inspectionFindings, inspections } = await import("@/db/schema");
    const [issue] = await db.select().from(maintenanceIssues);
    const [finding] = await db
      .select()
      .from(inspectionFindings)
      .where(and(eq(inspectionFindings.id, issue.inspectionFindingId!), eq(inspectionFindings.roomId, roomId)));
    expect(finding.maintenanceIssueId).toBe(issue.id);
    const [ins] = await db.select().from(inspections).where(eq(inspections.id, finding.inspectionId));
    expect(ins.roomId).toBe(roomId);
    // لقطة القالب مجمّدة مع الفحص
    expect(ins.templateSnapshot).toBeTruthy();
    expect(ins.templateVersion).toBe(1);
  });
});

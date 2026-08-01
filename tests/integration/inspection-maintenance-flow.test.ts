import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.4 §14 — مسار الفحص → الصيانة:
 * التحويل المفرد والجماعي، منع الازدواجية للبند المفتوح نفسه، الربط ثنائي الاتجاه،
 * ومحتوى الخطاب الرسمي (المصدر والمبلِّغ واعتماد المدير والإجراء المطلوب المنفصل).
 */

let pool: Pool;
let userId = "";
let roomId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: userId,
    username: "t",
    displayName: "مسجل الفحوصات",
    personId: null,
    permissions: new Set(["inspections.write", "maintenance.read", "maintenance.write", "reports.generate", "building.read"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  requireUser: vi.fn(async () => ({ id: userId, permissions: new Set() })),
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
  const { users, floors, rooms } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-insp-flow", displayName: "مسجل الفحوصات", passwordHash: "x" }).returning();
  userId = u.id;
  const [floor] = await db.insert(floors).values({ key: "flow-ground", nameAr: "الدور الأرضي", level: 0 }).returning();
  const [room] = await db
    .insert(rooms)
    .values({ floorId: floor.id, geomKey: "flow-r1", code: "KHS-RM-9101", nameAr: "فصل التجربة", roomType: "فصل دراسي" })
    .returning();
  roomId = room.id;
});

afterAll(async () => {
  await pool.end();
});

async function seedInspectionWithFindings(items: { key: string; label: string; note?: string; severity?: string }[]) {
  const { db } = await import("@/db");
  const { inspections, inspectionFindings } = await import("@/db/schema");
  const [insp] = await db
    .insert(inspections)
    .values({ roomId, inspectionDate: new Date(), results: items.map((i) => ({ key: i.key, ok: false })), inspectorId: userId })
    .returning();
  const findings = [];
  for (const i of items) {
    const [f] = await db
      .insert(inspectionFindings)
      .values({
        inspectionId: insp.id,
        roomId,
        itemKey: i.key,
        label: i.label,
        note: i.note ?? null,
        severity: i.severity ?? "متوسط",
        critical: (i.severity ?? "") === "حرج",
      })
      .returning();
    findings.push(f);
  }
  return { inspection: insp, findings };
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("التحويل المفرد من ملاحظة (v2.4 §14)", () => {
  it("(أ) ينشئ بلاغاً بربط ثنائي الاتجاه وأولوية من الخطورة، ويرفض التكرار لنفس الملاحظة", async () => {
    const { db } = await import("@/db");
    const { inspectionFindings, maintenanceIssues, maintenanceStatusHistory } = await import("@/db/schema");
    const { createIssueFromFindingAction } = await import("@/app/(app)/building/actions");
    const { findings } = await seedInspectionWithFindings([{ key: "door", label: "الباب مخلوع", severity: "حرج", note: "خطر على الطلاب" }]);

    const res = await createIssueFromFindingAction(null, fd({ findingId: findings[0].id }));
    expect(res?.success).toContain("أُنشئ البلاغ");

    const [after] = await db.select().from(inspectionFindings).where(eq(inspectionFindings.id, findings[0].id));
    expect(after.maintenanceIssueId).toBeTruthy();
    const [issue] = await db.select().from(maintenanceIssues).where(eq(maintenanceIssues.id, after.maintenanceIssueId!));
    expect(issue.inspectionFindingId).toBe(findings[0].id);
    expect(issue.priority).toBe("عالية");
    expect(issue.status).toBe("مسودة");
    expect(issue.title).toContain("الباب مخلوع");
    const history = await db.select().from(maintenanceStatusHistory).where(eq(maintenanceStatusHistory.issueId, issue.id));
    expect(history).toHaveLength(1);

    const again = await createIssueFromFindingAction(null, fd({ findingId: findings[0].id }));
    expect(again?.error).toContain("مسبقاً");
  });

  it("(ب) الازدواجية: ملاحظة جديدة لنفس البند والغرفة تُمنع ما دام بلاغ البند مفتوحاً، وتُسمح بعد إغلاقه", async () => {
    const { db } = await import("@/db");
    const { inspectionFindings, maintenanceIssues } = await import("@/db/schema");
    const { createIssueFromFindingAction } = await import("@/app/(app)/building/actions");

    // فحص لاحق يكتشف نفس البند
    const { findings: laterFindings } = await seedInspectionWithFindings([{ key: "door", label: "الباب مخلوع" }]);
    const blocked = await createIssueFromFindingAction(null, fd({ findingId: laterFindings[0].id }));
    expect(blocked?.error).toContain("بلاغ مفتوح لنفس البند");

    // إغلاق البلاغ الأصلي يفتح الباب لبلاغ جديد
    const [openFinding] = await db
      .select()
      .from(inspectionFindings)
      .where(and(eq(inspectionFindings.itemKey, "door"), eq(inspectionFindings.roomId, roomId)))
      .limit(1);
    await db
      .update(maintenanceIssues)
      .set({ status: "مغلق", closedAt: new Date() })
      .where(eq(maintenanceIssues.id, openFinding.maintenanceIssueId!));
    const allowed = await createIssueFromFindingAction(null, fd({ findingId: laterFindings[0].id }));
    expect(allowed?.success).toContain("أُنشئ البلاغ");
  });
});

describe("التحويل الجماعي لفحص كامل (v2.4 §14أ)", () => {
  it("ينشئ بلاغات للملاحظات المفتوحة ويتجاوز المرتبط والمكرر بملخص صادق", async () => {
    const { db } = await import("@/db");
    const { inspectionFindings } = await import("@/db/schema");
    const { createIssuesFromInspectionAction, createIssueFromFindingAction } = await import("@/app/(app)/building/actions");

    const { inspection, findings } = await seedInspectionWithFindings([
      { key: "light", label: "الإضاءة معطلة", severity: "عالٍ" },
      { key: "window", label: "زجاج مكسور", severity: "حرج" },
      { key: "paint", label: "طلاء متقشر", severity: "منخفض" },
    ]);
    // واحدة مرتبطة مسبقاً
    await createIssueFromFindingAction(null, fd({ findingId: findings[0].id }));

    const res = await createIssuesFromInspectionAction(null, fd({ inspectionId: inspection.id }));
    expect(res?.success).toContain("أُنشئ 2 بلاغاً");
    expect(res?.success).toContain("1 ملاحظة مرتبطة ببلاغ مسبقاً");

    const rows = await db.select().from(inspectionFindings).where(eq(inspectionFindings.inspectionId, inspection.id));
    expect(rows.every((r) => r.maintenanceIssueId)).toBe(true);

    // إعادة التنفيذ: كل شيء مرتبط — لا إنشاء جديد
    const again = await createIssuesFromInspectionAction(null, fd({ inspectionId: inspection.id }));
    expect(again?.error).toContain("مرتبطة ببلاغ مسبقاً");
  });
});

describe("خطاب البلاغ الرسمي (v2.4 §14ج)", () => {
  it("يتضمن مصدر الفحص وأثر السلامة والمبلِّغ واعتماد المدير والإجراء المطلوب الثابت", async () => {
    const { db } = await import("@/db");
    const { maintenanceIssues, documents } = await import("@/db/schema");
    const { createIssueFromFindingAction } = await import("@/app/(app)/building/actions");
    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");

    const { findings } = await seedInspectionWithFindings([{ key: "ac", label: "المكيف لا يعمل", severity: "حرج", note: "حرارة مرتفعة" }]);
    await createIssueFromFindingAction(null, fd({ findingId: findings[0].id }));
    const [linked] = await db
      .select()
      .from(maintenanceIssues)
      .where(eq(maintenanceIssues.inspectionFindingId, findings[0].id));

    // خطاب المسودة مرفوض
    await expect(generateMaintenanceLetter({ issueId: linked.id, issuedBy: userId })).rejects.toThrow();

    // اعتماد ثم توليد
    await db
      .update(maintenanceIssues)
      .set({ status: "معتمد", approvedBy: userId, approvedAt: new Date(), actionTaken: "تم تغيير الضاغط" })
      .where(eq(maintenanceIssues.id, linked.id));
    const res = await generateMaintenanceLetter({ issueId: linked.id, issuedBy: userId });
    const [doc] = await db.select().from(documents).where(eq(documents.id, res.documentId));

    expect(doc.htmlSnapshot).toContain("مصدر البلاغ");
    expect(doc.htmlSnapshot).toContain("المكيف لا يعمل");
    expect(doc.htmlSnapshot).toContain("حرج — يمس سلامة مستخدمي المبنى");
    expect(doc.htmlSnapshot).toContain("المبلِّغ");
    expect(doc.htmlSnapshot).toContain("مسجل الفحوصات");
    expect(doc.htmlSnapshot).toContain("اعتماد المدير");
    // «الإجراء المطلوب» ثابت لا يُستبدل بالإجراء المتخذ (كانا حقلاً واحداً خطأً)
    expect(doc.htmlSnapshot).toContain("الكشف والمعالجة وإفادتنا بالنتيجة");
    expect(doc.pdfFileId).toBeTruthy();
  }, 60_000);
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Phase 4 — إرفاق المستندات الممسوحة: تحقق الكيان الهدف، الحفظ كشاهد حساس، والقائمة.
 * (لا نستدعي buildScanPdf هنا لأنه يشغّل متصفح Playwright — نمرّر PDF بديلاً.)
 */

let pool: Pool;
let userId = "";
let roomId = "";
let floorId = "";

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
  const [u] = await db.insert(users).values({ username: "t-scan", displayName: "اختبار", passwordHash: "x" }).returning();
  userId = u.id;
  await db.insert(siteZones).values({ key: "boys", nameAr: "مجمع البنين", zoneType: "managed" });
  const [f] = await db.insert(floors).values({ key: "ground", nameAr: "الأرضي", level: 0, zoneKey: "boys", sortOrder: 1 }).returning();
  floorId = f.id;
  const [r] = await db.insert(rooms).values({ code: "KHS-RM-0001", geomKey: "r1", nameAr: "غرفة", roomType: "فصل", floorId: f.id }).returning();
  roomId = r.id;
});

// أصغر PDF صالح (رأس %PDF كافٍ لاجتياز فحص الحجم/الامتداد)
const fakePdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

describe("مسح المستندات — التحقق والإرفاق", () => {
  it("validateTarget يقبل الكيانات الموجودة ويرفض غير الموجود، و«building» بلا معرّف", async () => {
    const { validateTarget } = await import("@/lib/building/document-scan");
    expect(await validateTarget("building", "any")).toBe(true);
    expect(await validateTarget("room", roomId)).toBe(true);
    expect(await validateTarget("floor", floorId)).toBe(true);
    expect(await validateTarget("room", "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("attachScannedDocument يحفظ PDF حساساً وينشئ شاهداً (مسح مستند) ويربطه ويدقّق", async () => {
    const { db } = await import("@/db");
    const { evidenceItems, evidenceLinks, storedFiles, auditLog } = await import("@/db/schema");
    const { attachScannedDocument, listScannedDocuments } = await import("@/lib/building/document-scan");

    const res = await attachScannedDocument({
      pdf: fakePdf(),
      title: "شهادة صيانة المصعد",
      category: "شهادة",
      targetType: "room",
      entityId: roomId,
      sensitive: true,
      actorId: userId,
    });
    expect(res.evidenceId).toBeTruthy();
    expect(res.fileId).toBeTruthy();

    const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, res.fileId));
    expect(file.sensitive).toBe(true);
    expect(file.mime).toBe("application/pdf");

    const [ev] = await db.select().from(evidenceItems).where(eq(evidenceItems.id, res.evidenceId));
    expect(ev.kind).toBe("file");
    expect(ev.source).toBe("مسح مستند");
    expect(ev.evidenceType).toBe("شهادة");

    const links = await db.select().from(evidenceLinks).where(eq(evidenceLinks.evidenceId, res.evidenceId));
    expect(links[0].entityType).toBe("room");
    expect(links[0].entityId).toBe(roomId);

    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "document.scanned"));
    expect(audits.length).toBe(1);

    const list = await listScannedDocuments();
    expect(list.some((d) => d.evidenceId === res.evidenceId && d.title === "شهادة صيانة المصعد")).toBe(true);
  });
});

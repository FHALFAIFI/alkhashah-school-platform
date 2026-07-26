import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

let pool: Pool;
let testUserId = "";

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => ({
    id: testUserId,
    username: "t",
    displayName: "اختبار",
    personId: null,
    permissions: new Set(["evidence.write", "evidence.read", "plan.read"]),
    csrfToken: "x",
    sessionId: "x",
  })),
  getCurrentUser: vi.fn(async () => null),
  AuthError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-evp", displayName: "اختبار الشواهد", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

async function seedProgram() {
  const { db } = await import("@/db");
  const { planYears, programs } = await import("@/db/schema");
  const s = Math.floor(Math.random() * 1e9);
  const [year] = await db.insert(planYears).values({ key: `evp-yr-${s}`, nameAr: `سنة ${s}` }).returning();
  const [p] = await db.insert(programs).values({ planYearId: year.id, seq: 1, domain: "مجال", name: `برنامج ${s}`, status: "معتمد" }).returning();
  return p;
}

function textEvidenceForm(programId: string, title: string): FormData {
  const fd = new FormData();
  fd.set("entityType", "program");
  fd.set("entityId", programId);
  fd.set("title", title);
  fd.set("role", "تنفيذ");
  fd.set("kind", "text");
  fd.set("textContent", `نص ${title}`);
  return fd;
}

describe("شواهد البرنامج: الحفظ والعدّ الفعلي (D-025)", () => {
  it("createEvidenceAction يحفظ شاهداً نصياً للبرنامج ويعيد نجاحاً، والاستعلام يعكسه فوراً", async () => {
    const { createEvidenceAction } = await import("@/app/(app)/evidence/actions");
    const { evidenceForEntity } = await import("@/lib/evidence");
    const { programEvidenceSummary } = await import("@/lib/plan/program-service");
    const { evidenceCountPhrase } = await import("@/lib/plan/evidence-summary");
    const p = await seedProgram();

    // صفر: العبارة الفعلية
    expect((await evidenceForEntity("program", p.id)).length).toBe(0);
    expect(evidenceCountPhrase((await programEvidenceSummary(p.id)).count)).toBe("لم يتم رفع أي شاهد حتى الآن");

    // واحد
    const r1 = await createEvidenceAction(null, textEvidenceForm(p.id, "شاهد أول"));
    expect(r1?.error).toBeUndefined();
    expect(r1?.success).toBeTruthy();
    const after1 = await programEvidenceSummary(p.id);
    expect(after1.count).toBe(1);
    expect(after1.latestAt).not.toBeNull();
    // latestAt يجب أن يكون Date فعلياً — إن كان نصاً فإن toLocaleDateString في الصفحة تنهار
    expect(after1.latestAt).toBeInstanceOf(Date);
    expect(evidenceCountPhrase(after1.count)).toBe("تم رفع شاهد واحد");
    expect((await evidenceForEntity("program", p.id)).length).toBe(1);

    // اثنان
    await createEvidenceAction(null, textEvidenceForm(p.id, "شاهد ثانٍ"));
    expect((await programEvidenceSummary(p.id)).count).toBe(2);
    expect(evidenceCountPhrase(2)).toBe("تم رفع شاهدان");

    // ثلاثة
    await createEvidenceAction(null, textEvidenceForm(p.id, "شاهد ثالث"));
    const after3 = await programEvidenceSummary(p.id);
    expect(after3.count).toBe(3);
    expect(evidenceCountPhrase(after3.count)).toBe("تم رفع 3 شواهد");
  });
});

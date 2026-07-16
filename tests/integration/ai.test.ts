import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * C6–C13: مساعد المدير الذكي — حواجز الأمان، الصلاحيات، المعاينة والتأكيد،
 * منع التكرار، التدقيق، وعمل التطبيق مع تعطيل الذكاء الاصطناعي.
 */

let pool: Pool;
let testUserId = "";

const fullPerms = ["ai.use", "ai.manage", "tasks.read", "tasks.write", "plan.read", "people.read", "evidence.read", "committees.read", "building.read", "assets.read", "inspections.read", "maintenance.read", "maintenance.write", "documents.read", "performance.read"];

const makeUser = (perms: string[]) => ({
  id: testUserId,
  username: "t-ai",
  displayName: "اختبار",
  personId: null,
  permissions: new Set(perms),
  csrfToken: "csrf-test-token",
  sessionId: "x",
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-ai", displayName: "اختبار", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

describe("حواجز أمان سجل الأدوات (C11)", () => {
  it("لا توجد أدوات اعتماد أو إقفال أو توقيع أو تقييم أو استيراد أو حذف أو إرسال أو صلاحيات أو SQL", async () => {
    const { AI_TOOLS } = await import("@/lib/ai/tools");
    const names = AI_TOOLS.map((t) => t.name);
    // القائمة المسموحة حصراً — أي أداة جديدة يجب مراجعتها هنا عمداً
    expect(new Set(names)).toEqual(
      new Set([
        "search_records", "overdue_programs", "overdue_tasks", "missing_evidence",
        "upcoming_performance_sessions", "rooms_needing_inspection", "open_maintenance_issues",
        "dashboard_summary", "save_draft", "create_task", "create_maintenance_issue", "create_email_draft",
      ]),
    );
    const forbiddenPatterns = /approve|lock|sign|stamp|rate|rating|score|weight|commit|rollback|import|delete|remove|send_email|send_final|user|role|permission|sql|query_raw/i;
    for (const name of names) {
      expect(name, `اسم أداة محظور: ${name}`).not.toMatch(forbiddenPatterns);
    }
  });

  it("كل أداة كتابية تبني معاينة مفصلة قبل التنفيذ (C9)", async () => {
    const { AI_TOOLS } = await import("@/lib/ai/tools");
    for (const tool of AI_TOOLS.filter((t) => !t.readOnly)) {
      expect(typeof (tool as { buildPreview: unknown }).buildPreview).toBe("function");
    }
  });
});

describe("صلاحيات أدوات القراءة (C8)", () => {
  it("أداة القراءة ترفض مستخدماً بلا صلاحية وتعمل لمن يملكها", async () => {
    const { getTool } = await import("@/lib/ai/tools");
    const tool = getTool("overdue_tasks")!;
    expect(tool.readOnly).toBe(true);

    const noPerms = makeUser(["ai.use"]);
    await expect((tool as { execute: (u: unknown, a: unknown) => Promise<unknown> }).execute(noPerms, {})).rejects.toThrow(/صلاحية/);

    const withPerms = makeUser(fullPerms);
    const result = (await (tool as { execute: (u: unknown, a: unknown) => Promise<{ summary: string }> }).execute(withPerms, {}));
    expect(result.summary).toContain("المهام المتأخرة");
  });

  it("البحث في كيان يتطلب صلاحية ذلك الكيان تحديداً", async () => {
    const { getTool } = await import("@/lib/ai/tools");
    const tool = getTool("search_records")! as { execute: (u: unknown, a: unknown) => Promise<unknown> };
    const onlyTasks = makeUser(["ai.use", "tasks.read"]);
    await expect(tool.execute(onlyTasks, { entity: "people", query: "أحمد" })).rejects.toThrow(/صلاحية/);
    await expect(tool.execute(onlyTasks, { entity: "tasks", query: "متابعة" })).resolves.toBeTruthy();
  });
});

describe("المقترحات: معاينة → تأكيد → تنفيذ مرة واحدة (C9, C10, C12)", () => {
  async function createTaskProposal(perms: string[] = fullPerms) {
    const { db } = await import("@/db");
    const { aiActionProposals } = await import("@/db/schema");
    const { getTool } = await import("@/lib/ai/tools");
    const user = makeUser(perms);
    const tool = getTool("create_task")! as { buildPreview: (u: unknown, a: unknown) => Promise<{ label: string; value: string }[]> };
    const args = { title: "مهمة اختبار المساعد", priority: "متوسطة" };
    const preview = await tool.buildPreview(user, args);
    const [proposal] = await db
      .insert(aiActionProposals)
      .values({ userId: user.id, toolName: "create_task", args, preview, idempotencyKey: crypto.randomUUID() })
      .returning();
    return { proposal, user, preview };
  }

  it("المعاينة مفصلة بنداً بنداً وتشمل العنوان والأولوية", async () => {
    const { preview } = await createTaskProposal();
    expect(preview.some((p) => p.value.includes("مهمة اختبار المساعد"))).toBe(true);
    expect(preview.some((p) => p.value.includes("متوسطة"))).toBe(true);
  });

  it("التأكيد ينفذ مرة واحدة فقط — التأكيد المكرر لا ينشئ سجلاً مكرراً (C10)", async () => {
    const { db } = await import("@/db");
    const { actionTasks } = await import("@/db/schema");
    const { confirmProposal } = await import("@/lib/ai/orchestrator");
    const { proposal, user } = await createTaskProposal();

    const first = await confirmProposal(user, proposal.id);
    expect(first.ok).toBe(true);

    const second = await confirmProposal(user, proposal.id);
    expect(second.ok).toBe(false);
    expect(second.message).toContain("لن يكرر");

    const created = await db.select().from(actionTasks).where(eq(actionTasks.title, "مهمة اختبار المساعد"));
    expect(created.length).toBe(1);
    // تنظيف
    await db.delete(actionTasks).where(eq(actionTasks.title, "مهمة اختبار المساعد"));
  });

  it("إعادة فحص الصلاحية لحظة التنفيذ: فقدان الصلاحية بعد الاقتراح يمنع التنفيذ (C8)", async () => {
    const { confirmProposal } = await import("@/lib/ai/orchestrator");
    const { proposal } = await createTaskProposal();
    const demoted = makeUser(["ai.use"]); // بلا tasks.write لحظة التنفيذ
    const result = await confirmProposal(demoted, proposal.id);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("صلاحية");
  });

  it("الإلغاء يمنع أي تنفيذ لاحق", async () => {
    const { confirmProposal, cancelProposal } = await import("@/lib/ai/orchestrator");
    const { proposal, user } = await createTaskProposal();
    const cancelled = await cancelProposal(user, proposal.id);
    expect(cancelled.ok).toBe(true);
    const confirmAfter = await confirmProposal(user, proposal.id);
    expect(confirmAfter.ok).toBe(false);
  });

  it("كل تأكيد وتنفيذ مسجل في سجل التدقيق (C12)", async () => {
    const { db } = await import("@/db");
    const { auditLog, actionTasks } = await import("@/db/schema");
    const { confirmProposal } = await import("@/lib/ai/orchestrator");
    const { proposal, user } = await createTaskProposal();
    await confirmProposal(user, proposal.id);
    const entries = await db.select().from(auditLog);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("ai.action_confirmed");
    expect(actions).toContain("ai.action_executed");
    await db.delete(actionTasks).where(eq(actionTasks.title, "مهمة اختبار المساعد"));
  });
});

describe("التطبيق يعمل مع تعطيل الذكاء الاصطناعي (C13)", () => {
  it("getActiveProvider يرمي خطأ التعطيل الواضح عندما يكون معطلاً", async () => {
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    await db.delete(settings).where(eq(settings.key, "ai.config"));
    const prevEnv = process.env.AI_ENABLED;
    delete process.env.AI_ENABLED;
    const { getActiveProvider, AiDisabledError } = await import("@/lib/ai/provider");
    await expect(getActiveProvider()).rejects.toThrow(AiDisabledError);
    if (prevEnv !== undefined) process.env.AI_ENABLED = prevEnv;
  });

  it("الإعدادات الافتراضية معطلة والموافقة الخارجية معطلة", async () => {
    const { aiDefaults } = await import("@/lib/ai/settings");
    const prevEnabled = process.env.AI_ENABLED;
    const prevProvider = process.env.AI_PROVIDER;
    delete process.env.AI_ENABLED;
    delete process.env.AI_PROVIDER;
    const d = aiDefaults();
    expect(d.enabled).toBe(false);
    expect(d.allowExternal).toBe(false);
    expect(d.provider).toBe("ollama");
    if (prevEnabled !== undefined) process.env.AI_ENABLED = prevEnabled;
    if (prevProvider !== undefined) process.env.AI_PROVIDER = prevProvider;
  });

  it("المزود الخارجي يرفض العمل دون موافقة صريحة مسجلة", async () => {
    const { buildProvider } = await import("@/lib/ai/provider");
    const { aiDefaults } = await import("@/lib/ai/settings");
    const config = { ...aiDefaults(), enabled: true, provider: "claude" as const, allowExternal: false };
    expect(() => buildProvider(config)).toThrow(/موافقة صريحة/);
  });
});

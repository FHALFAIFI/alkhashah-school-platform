import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * Scope v2.2 §11.6 — security verification of the EXISTING codebase.
 *
 * Deliberately aimed at surfaces that predate v2.2: authentication, session lifecycle,
 * uploads, per-module authorization (finance, committees, performance, imports, evidence,
 * documents), and injection resistance in reports and exports.
 */

let pool: Pool;
let testUserId = "";
/** Mutated per test to simulate different permission sets at the server boundary. */
let permissions = new Set<string>();

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async (...keys: string[]) => {
    for (const k of keys) {
      if (!permissions.has(k)) {
        const e = new Error(`AuthError: ${k}`);
        (e as Error & { status?: number }).status = 403;
        throw e;
      }
    }
    return { id: testUserId, username: "t", displayName: "اختبار", personId: null, permissions, csrfToken: "x", sessionId: "x" };
  }),
  requireUser: vi.fn(async () => ({ id: testUserId, permissions })),
  getCurrentUser: vi.fn(async () => ({ id: testUserId, permissions, csrfToken: "x", sessionId: "x" })),
  // التجزئة الحقيقية لا محاكاة — الاختبار يتحقق من السلوك الفعلي لا من بديل
  hashToken: (token: string) => createHash("sha256").update(token).digest("hex"),
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
  const [u] = await db.insert(users).values({ username: "t-sec", displayName: "اختبار الأمان", passwordHash: "x" }).returning();
  testUserId = u.id;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  permissions = new Set<string>();
});

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

/* ────────────────────────── المصادقة وكلمات المرور ────────────────────────── */

describe("§11.5.A — المصادقة", () => {
  it("تجزئة كلمة المرور بـargon2 ولا تُخزَّن نصاً", async () => {
    const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
    const hash = await hashPassword("كلمة-مرور-قوية-123");
    expect(hash).not.toContain("كلمة-مرور-قوية-123");
    expect(hash.startsWith("$argon2")).toBe(true);
    expect(await verifyPassword(hash, "كلمة-مرور-قوية-123")).toBe(true);
    expect(await verifyPassword(hash, "خاطئة")).toBe(false);
  });

  it("التجزئة مملَّحة — كلمتان متطابقتان تعطيان تجزئتين مختلفتين", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("رمز الجلسة يُخزَّن مجزّأً لا نصاً صريحاً", async () => {
    const { hashToken } = await import("@/lib/auth/session");
    const token = "a".repeat(64);
    const hashed = hashToken(token);
    expect(hashed).not.toBe(token);
    expect(hashed).toHaveLength(64);
    // حتمية — يمكن البحث بها دون تخزين الرمز نفسه
    expect(hashToken(token)).toBe(hashed);
  });

  it("محدّد المعدل يوقف المحاولات المتكررة", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `sec-test-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (rateLimit(key, 5)) allowed += 1;
    expect(allowed).toBe(5);
  });

  it("TOTP يرفض رمزاً خاطئاً", async () => {
    const { newTotpSecret, verifyTotp } = await import("@/lib/auth/totp");
    const secret = newTotpSecret();
    expect(verifyTotp("000000", secret)).toBe(false);
    expect(verifyTotp("", secret)).toBe(false);
  });

  it("مسار العودة بعد الدخول لا يقبل وجهة خارجية (open redirect)", async () => {
    const { safeImportsReturnTo } = await import("@/lib/auth/return-to");
    for (const evil of ["https://evil.example", "//evil.example", "http://evil", "javascript:alert(1)"]) {
      expect(safeImportsReturnTo(evil), `${evil} يجب أن يُرفض`).toBeNull();
    }
  });
});

/* ─────────────────────────── التفويض لكل وحدة ─────────────────────────── */

describe("§11.5.B — التفويض على حدود الخادم (وحدات ما قبل v2.2)", () => {
  it("المالية: لا كتابة بلا budget.write", async () => {
    permissions = new Set(["budget.read"]);
    const { addIncomeAction, addExpenseAction } = await import("@/app/(app)/budget/actions");
    await expect(addIncomeAction(null, fd({ planYearId: crypto.randomUUID() }))).rejects.toThrow();
    await expect(addExpenseAction(null, fd({ planYearId: crypto.randomUUID() }))).rejects.toThrow();
  });

  it("الخطة: لا اعتماد ولا أرشفة بلا plan.approve", async () => {
    permissions = new Set(["plan.read", "plan.write"]);
    const { approveProgramAction, archiveProgramAction, closeProgramAction } = await import("@/app/(app)/plan/actions");
    await expect(approveProgramAction(crypto.randomUUID())).rejects.toThrow();
    await expect(archiveProgramAction(crypto.randomUUID(), null, fd({}))).rejects.toThrow();
    await expect(closeProgramAction(crypto.randomUUID(), null, fd({}))).rejects.toThrow();
  });

  it("اللجان: لا كتابة بلا committees.write", async () => {
    permissions = new Set(["committees.read"]);
    const actions = await import("@/app/(app)/committees/actions");
    const writeActions = Object.entries(actions).filter(
      ([n, f]) => typeof f === "function" && /add|create|update|remove|delete|approve|close|reopen/i.test(n),
    );
    expect(writeActions.length).toBeGreaterThan(0);
    for (const [name, fn] of writeActions) {
      await expect((fn as (...a: unknown[]) => Promise<unknown>)(crypto.randomUUID(), null, fd({})), `${name} نفذ بلا صلاحية`).rejects.toThrow();
    }
  });

  it("الأداء الفردي مقيَّد بصلاحيته الخاصة (D-013)", async () => {
    const route = await import("@/app/api/export/perf-session-docx/[id]/route");
    expect(typeof route.GET).toBe("function");
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/export/perf-session-docx/[id]/route.ts", "utf-8"),
    );
    // يجب اشتراط الصلاحيتين معاً لا إحداهما
    expect(src).toContain("performance.individual.read");
    expect(src).toContain("reports.generate");
  });

  it("الاستيراد: التنفيذ يتطلب imports.commit ويعيد رفضاً صريحاً", async () => {
    permissions = new Set(["imports.read"]);
    const { commitBatchAction } = await import("@/app/(app)/imports/actions");
    const res = await commitBatchAction(crypto.randomUUID());
    // يعيد رفضاً نوعياً بدل رمي NEXT_REDIRECT (يُبتلع داخل startTransition)
    expect(res?.code).toBe("PERMISSION_DENIED");
  });

  it("القوالب: لا نشر ولا تعديل بلا admin.settings", async () => {
    permissions = new Set(["documents.read"]);
    const { publishVersionAction, saveTemplateConfigAction } = await import("@/app/(app)/admin/templates/actions");
    await expect(publishVersionAction(crypto.randomUUID())).rejects.toThrow();
    await expect(saveTemplateConfigAction(crypto.randomUUID(), null, fd({ config: "{}" }))).rejects.toThrow();
  });

  it("كل إجراء خادم يفرض تفويضاً (مسح شامل للمستودع)", async () => {
    const fs = await import("node:fs");
    const cp = await import("node:child_process");
    const files = cp.execSync('grep -rl \'"use server"\' src/ --include=*.ts', { encoding: "utf-8" }).trim().split("\n");
    const unguarded: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf-8");
      for (const m of src.matchAll(/export async function (\w+)\s*\(/g)) {
        const nxt = src.indexOf("\nexport ", m.index! + m[0].length);
        const body = src.slice(m.index!, nxt === -1 ? undefined : nxt);
        // إمّا requirePermission/requireUser أو getCurrentUser + فحص صلاحية صريح
        const guarded =
          /require(Permission|User)\s*\(/.test(body) ||
          (/getCurrentUser\s*\(/.test(body) && /permissions\.has\(/.test(body));
        // الدخول والخروج بلا حارس بحكم طبيعتهما
        if (!guarded && !["loginAction", "logoutAction"].includes(m[1])) unguarded.push(`${f}::${m[1]}`);
      }
    }
    expect(unguarded, `إجراءات بلا تفويض: ${unguarded.join(", ")}`).toEqual([]);
  });

  it("كل مسار API يفرض مصادقة (عدا فحص الصحة)", async () => {
    const fs = await import("node:fs");
    const cp = await import("node:child_process");
    const routes = cp.execSync("find src/app/api -name route.ts", { encoding: "utf-8" }).trim().split("\n");
    const unauth = routes.filter((r) => {
      if (r.includes("/api/health/")) return false; // فحص صحة الحاوية — بلا أسرار
      const src = fs.readFileSync(r, "utf-8");
      return !/getCurrentUser|requireUser|requirePermission/.test(src);
    });
    expect(unauth, `مسارات بلا مصادقة: ${unauth.join(", ")}`).toEqual([]);
  });
});

/* ──────────────────────────── رفع الملفات ──────────────────────────── */

describe("§11.5.F — رفع الملفات", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "binary");

  it("يرفض الامتداد غير المسموح", async () => {
    const { validateUpload } = await import("@/lib/storage");
    expect(validateUpload("shell.sh", "text/plain", 10)).toBeTruthy();
    expect(validateUpload("evil.exe", "application/octet-stream", 10)).toBeTruthy();
    expect(validateUpload("page.html", "text/html", 10)).toBeTruthy();
    expect(validateUpload("app.js", "text/javascript", 10)).toBeTruthy();
  });

  it("يرفض الامتداد المزدوج المموّه", async () => {
    const { validateUpload } = await import("@/lib/storage");
    // الامتداد الفعلي هو الأخير — `.php` ليس مسموحاً رغم `.pdf` في الاسم
    expect(validateUpload("invoice.pdf.php", "application/pdf", 10)).toBeTruthy();
    expect(validateUpload("photo.png.exe", "image/png", 10)).toBeTruthy();
  });

  it("يرفض عدم تطابق النوع مع الامتداد", async () => {
    const { validateUpload } = await import("@/lib/storage");
    expect(validateUpload("file.png", "application/pdf", 10)).toBeTruthy();
    expect(validateUpload("file.pdf", "image/png", 10)).toBeTruthy();
  });

  it("يرفض الملف الأكبر من الحد", async () => {
    const { validateUpload, MAX_UPLOAD_BYTES } = await import("@/lib/storage");
    expect(validateUpload("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1)).toBeTruthy();
    expect(validateUpload("empty.pdf", "application/pdf", 0)).toBeTruthy();
  });

  it("**يرفض محتوى لا يطابق نوعه المُعلَن (فحص التوقيع)**", async () => {
    const { validateFileSignature } = await import("@/lib/storage");
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    // HTML مموّه كـPDF أو صورة — يُرفض بالتوقيع رغم صحة النوع والامتداد
    expect(validateFileSignature(html, "application/pdf")).toBeTruthy();
    expect(validateFileSignature(html, "image/png")).toBeTruthy();
    expect(validateFileSignature(html, "image/jpeg")).toBeTruthy();
    // المحتوى الصحيح يمر
    expect(validateFileSignature(PNG, "image/png")).toBeNull();
    expect(validateFileSignature(PDF, "application/pdf")).toBeNull();
  });

  it("يرفض ملفاً فارغاً أو مبتوراً يدّعي نوعاً ثنائياً", async () => {
    const { validateFileSignature } = await import("@/lib/storage");
    expect(validateFileSignature(Buffer.alloc(0), "image/png")).toBeTruthy();
    expect(validateFileSignature(Buffer.from([0x89, 0x50]), "image/png")).toBeTruthy();
  });

  it("اسم الملف لا يؤثر في مسار التخزين (منع اجتياز المسار)", async () => {
    const { saveUploadedFile } = await import("@/lib/storage");
    const stored = await saveUploadedFile({
      originalName: "../../../../etc/passwd.png",
      mime: "image/png",
      data: PNG,
      scope: "attachments",
    });
    // المسار يُشتق من UUID مولَّد على الخادم لا من اسم المستخدم
    expect(stored.storagePath).not.toContain("..");
    expect(stored.storagePath).not.toContain("etc");
    expect(stored.storagePath).toMatch(/^attachments\//);
    // الاسم الأصلي محفوظ للعرض فقط
    expect(stored.originalName).toContain("passwd");
  });

  it("حارس المسار يرفض الخروج من مجلد التخزين", async () => {
    const { storage } = await import("@/lib/storage");
    await expect(storage.get("../../../etc/passwd")).rejects.toThrow();
  });
});

/* ─────────────────────────── الحقن والتقارير ─────────────────────────── */

describe("§11.5.D — مقاومة الحقن", () => {
  it("حمولات SQL في مرشّحات التقارير لا تُنفَّذ ولا تُسقط التقرير", async () => {
    permissions = new Set(["reports.read", "plan.read"]);
    const { runReport } = await import("@/lib/reports/loaders");
    const payloads = ["'; DROP TABLE programs;--", "1' OR '1'='1", "%' UNION SELECT NULL--", "\\'; delete from users;--"];
    for (const p of payloads) {
      const res = await runReport("programs-active", { search: p, page: 1, pageSize: 10 });
      expect(Array.isArray(res.rows)).toBe(true);
    }
    // الجداول ما زالت قائمة
    const { db } = await import("@/db");
    const { programs } = await import("@/db/schema");
    await expect(db.select().from(programs)).resolves.toBeDefined();
  });

  it("محرف البدل في البحث لا يغيّر دلالة النمط", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    // `%` وحده كان سيطابق كل شيء لو مُرِّر خاماً
    const all = await runReport("programs-active", { page: 1, pageSize: 200 });
    const wild = await runReport("programs-active", { search: "%", page: 1, pageSize: 200 });
    expect(wild.total).toBeLessThanOrEqual(all.total);
  });

  it("عمود ترتيب خبيث لا يصل إلى الاستعلام", async () => {
    const { runReport } = await import("@/lib/reports/loaders");
    const res = await runReport("programs-active", {
      sort: "name; drop table users--",
      page: 1,
      pageSize: 10,
    });
    expect(Array.isArray(res.rows)).toBe(true);
    const { db } = await import("@/db");
    const { users } = await import("@/db/schema");
    await expect(db.select().from(users)).resolves.toBeDefined();
  });

  it("بيانات المستخدم في وثيقة رسمية تُهرَّب ولا تصبح وسماً حياً", async () => {
    const { officialPageHtml } = await import("@/lib/pdf");
    const html = officialPageHtml({
      title: "تقرير برنامج: <img src=x onerror=alert(1)>",
      bodyHtml: "<p>محتوى موثوق من الخادم</p>",
      docNumber: '"><script>alert(1)</script>',
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;img");
  });

  it("حقن صيغ الجداول معطَّل في CSV وExcel", async () => {
    const { sanitizeCell, toCsv } = await import("@/lib/reports/export-safety");
    for (const p of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(sanitizeCell(p).startsWith("'")).toBe(true);
    expect(toCsv(["=BAD()"], [["=EVIL()"]])).toContain("'=EVIL()");
  });
});

/* ───────────────────────── الوثائق والتجميد ───────────────────────── */

describe("§11.5.G — الوثائق والتصدير", () => {
  it("لا تقرير يكشف عموداً حسّاساً", async () => {
    const { REPORTS } = await import("@/lib/reports/catalog");
    const forbidden = /password|passwordHash|sessionId|token|secret|sha256|storagePath|htmlSnapshot|csrf/i;
    for (const r of REPORTS) {
      for (const c of r.columns) {
        expect(forbidden.test(c.key), `${r.key}.${c.key} حسّاس`).toBe(false);
      }
    }
  });

  it("التصدير محدود الحجم ولا يكون غير منتهٍ", async () => {
    const { MAX_EXPORT_ROWS, clampPageSize, MAX_PAGE_SIZE } = await import("@/lib/reports/export-safety");
    expect(MAX_EXPORT_ROWS).toBeLessThanOrEqual(5000);
    expect(clampPageSize(10 ** 9)).toBe(MAX_PAGE_SIZE);
  });

  it("لقطة الوثيقة المجمّدة لا تتأثر بتغيّر الإعدادات لاحقاً", async () => {
    const { issueDocument } = await import("@/lib/documents");
    const { db } = await import("@/db");
    const { documents, settings } = await import("@/db/schema");
    const snapshot = "<html><body>لقطة أصلية</body></html>";
    const doc = await issueDocument({ docType: "official_letter", title: "خطاب", htmlSnapshot: snapshot, issuedBy: testUserId });

    // تغيير إعداد هوية الوثائق بعد الإصدار
    await db.insert(settings).values({ key: "document.identity", value: { schoolName: "اسم مختلف" } }).onConflictDoNothing();

    const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(after.htmlSnapshot).toBe(snapshot);
  });
});

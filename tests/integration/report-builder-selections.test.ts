import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ensureTestDb, truncateAll, TEST_DB_URL } from "../helpers/test-db";

/**
 * v2.6 §A — بلوكر §2: اختيارات المنشئ تنجو من الحفظ والتعديل والنسخ والاعتماد.
 *
 * التقرير المحفوظ لا يملك منشئاً ثانياً مصغَّراً: اختياراته هي اختيارات `/reports/builder`
 * نفسها (الأعمدة وترتيبها، الترتيب واتجاهه، التجميع، نمط العرض، المرشّحات) وتمرّ بالمحلّل
 * المُقيَّد بالقوائم البيضاء ذاته. هذا الملف يثبت أنها تصل إلى اللقطة المجمّدة سليمة.
 */

let pool: Pool;
let userId = "";
let seq = 1;

const FULL = new Set(["reports.read", "reports.builder", "reports.generate", "documents.issue", "plan.read"]);
const viewer = () => ({ id: userId, permissions: FULL });

/** الاختيارات التي يبنيها المنشئ في نص الاستعلام */
const BUILDER_QUERY =
  "col=name&col=domain&col=owner&sort=name&dir=desc&group=domain&mode=grouped&search=برنامج&status=معتمد";

async function createFromBuilder(title: string) {
  const { createInstance } = await import("@/lib/reports/instances/service");
  const { parseReportFilters } = await import("@/lib/reports/filters");
  const { reportByKey, isSortableColumn } = await import("@/lib/reports/catalog");
  const def = reportByKey("programs-by-domain")!;
  const filters = parseReportFilters(new URLSearchParams(BUILDER_QUERY), {
    allowedSort: (k) => isSortableColumn("programs-by-domain", k),
    allowedColumns: def.columns.map((c) => c.key),
  });
  const created = await createInstance(
    {
      title,
      typeKey: "single",
      filters,
      options: { reportKey: "programs-by-domain", outputFormats: ["pdf", "xlsx"], templateKey: "analytical" },
    },
    viewer(),
  );
  expect(created.error).toBeUndefined();
  return created.instanceId!;
}

async function readBack(id: string) {
  const { getInstance, instanceFilters } = await import("@/lib/reports/instances/service");
  const { parseInstanceOptions } = await import("@/lib/reports/instances/options");
  const row = await getInstance(id, viewer());
  return { row: row!, filters: instanceFilters(row!), options: parseInstanceOptions(row!.options) };
}

function expectSelections(filters: Record<string, unknown>, options: Record<string, unknown>) {
  expect(filters.columns).toEqual(["name", "domain", "owner"]);
  expect(filters.sort).toBe("name");
  expect(filters.dir).toBe("desc");
  expect(filters.group).toBe("domain");
  expect(filters.mode).toBe("grouped");
  expect(filters.search).toBe("برنامج");
  expect(filters.statuses).toEqual(["معتمد"]);
  expect(options.outputFormats).toEqual(["pdf", "xlsx"]);
  expect(options.templateKey).toBe("analytical");
}

beforeAll(async () => {
  await ensureTestDb();
  pool = new Pool({ connectionString: TEST_DB_URL, max: 2 });
  await truncateAll(pool);
  const { db } = await import("@/db");
  const { users, planYears, programs } = await import("@/db/schema");
  const [u] = await db.insert(users).values({ username: "t-builder", displayName: "منشئ", passwordHash: "x" }).returning();
  userId = u.id;
  const [y] = await db.insert(planYears).values({ key: "bld-yr", nameAr: "سنة المنشئ", status: "نشطة" }).returning();
  for (const [i, domain] of ["التعليم والتعلم", "البيئة المدرسية"].entries()) {
    await db.insert(programs).values({
      planYearId: y.id,
      seq: i + 1,
      domain,
      name: `برنامج اختيارات ${i + 1}`,
      ownerPosition: "منسّق",
      status: "معتمد",
    });
  }
});

afterAll(async () => {
  await pool.end();
});

describe("اختيارات المنشئ تُحفظ وتبقى", () => {
  it("الحفظ يُبقي الأعمدة وترتيبها والترتيب والتجميع والنمط والصيغ", async () => {
    const id = await createFromBuilder(`تقرير اختيارات ${seq++}`);
    const { filters, options } = await readBack(id);
    expectSelections(filters as unknown as Record<string, unknown>, options as unknown as Record<string, unknown>);
  });

  it("التعديل يحفظ اختيارات جديدة كاملةً", async () => {
    const { updateInstance } = await import("@/lib/reports/instances/service");
    const { parseReportFilters } = await import("@/lib/reports/filters");
    const { reportByKey, isSortableColumn } = await import("@/lib/reports/catalog");
    const def = reportByKey("programs-by-domain")!;
    const id = await createFromBuilder(`تقرير للتعديل ${seq++}`);
    const updated = await updateInstance(
      id,
      {
        title: "بعد التعديل",
        typeKey: "single",
        filters: parseReportFilters(new URLSearchParams("col=name&sort=domain&dir=asc&mode=detailed"), {
          allowedSort: (k) => isSortableColumn("programs-by-domain", k),
          allowedColumns: def.columns.map((c) => c.key),
        }),
        options: { reportKey: "programs-by-domain", outputFormats: ["docx"] },
      },
      viewer(),
    );
    expect(updated.error).toBeUndefined();
    const { filters, options } = await readBack(id);
    expect(filters.columns).toEqual(["name"]);
    expect(filters.dir).toBe("asc");
    expect(options.outputFormats).toEqual(["docx"]);
  });

  it("النسخ ينقل الاختيارات حرفياً إلى المسودة الجديدة", async () => {
    const { copyInstance } = await import("@/lib/reports/instances/service");
    const id = await createFromBuilder(`تقرير للنسخ ${seq++}`);
    const copy = await copyInstance(id, viewer());
    expect(copy.error).toBeUndefined();
    const { filters, options } = await readBack(copy.instanceId!);
    expectSelections(filters as unknown as Record<string, unknown>, options as unknown as Record<string, unknown>);
  });

  it("الاعتماد يجمّد الاختيارات في اللقطة: الأعمدة المختارة وحدها وبترتيبها", async () => {
    const { finalizeInstance, getInstance } = await import("@/lib/reports/instances/service");
    const id = await createFromBuilder(`تقرير للاعتماد ${seq++}`);
    const fin = await finalizeInstance(id, viewer());
    expect(fin.error).toBeUndefined();

    const row = await getInstance(id, viewer());
    const snapshot = row!.snapshot as { sections: { columns: { key: string }[]; filterLines: [string, string][] }[]; templateKey: string };
    expect(snapshot.sections[0].columns.map((c) => c.key)).toEqual(["name", "domain", "owner"]);
    expect(snapshot.templateKey).toBe("analytical");
    // المرشّحات الفعّالة مذكورة في اللقطة — فالتقرير يشرح نطاقه بنفسه
    const lines = snapshot.sections[0].filterLines.flat().join(" ");
    expect(lines).toContain("برنامج");
  });

  it("النسخة الجديدة من تقرير معتمد ترث اختياراته", async () => {
    const { finalizeInstance, newVersion } = await import("@/lib/reports/instances/service");
    const id = await createFromBuilder(`تقرير للنسخة ${seq++}`);
    await finalizeInstance(id, viewer());
    const version = await newVersion(id, viewer());
    expect(version.error).toBeUndefined();
    const { filters, options } = await readBack(version.instanceId!);
    expectSelections(filters as unknown as Record<string, unknown>, options as unknown as Record<string, unknown>);
  });

  it("عمود أو ترتيب غير معلَن في التقرير يسقط ولا يُخزَّن", async () => {
    const { createInstance } = await import("@/lib/reports/instances/service");
    const { parseReportFilters } = await import("@/lib/reports/filters");
    const { reportByKey, isSortableColumn } = await import("@/lib/reports/catalog");
    const def = reportByKey("programs-by-domain")!;
    const filters = parseReportFilters(
      new URLSearchParams("col=name&col=secret_column&sort=pg_sleep(10)&group=__proto__"),
      { allowedSort: (k) => isSortableColumn("programs-by-domain", k), allowedColumns: def.columns.map((c) => c.key) },
    );
    const created = await createInstance(
      { title: "تقرير ملفَّق", typeKey: "single", filters, options: { reportKey: "programs-by-domain" } },
      viewer(),
    );
    const { filters: stored } = await readBack(created.instanceId!);
    expect(stored.columns).toEqual(["name"]);
    expect(stored.sort).toBeUndefined();
    expect(stored.group).toBeUndefined();
  });

  it("الصيغ المختارة وحدها تُولَّد — لا ثلاثتها دائماً", async () => {
    const { finalizeInstance } = await import("@/lib/reports/instances/service");
    const { requestGeneration, runJob } = await import("@/lib/reports/instances/jobs");
    const { db } = await import("@/db");
    const { reportOutputs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const id = await createFromBuilder(`تقرير الصيغ ${seq++}`);
    await finalizeInstance(id, viewer());
    // المحفوظ: pdf + xlsx (لا docx)
    const job = await requestGeneration(id, ["pdf", "xlsx"], viewer());
    await runJob(job.jobId!);
    const outputs = await db.select().from(reportOutputs).where(eq(reportOutputs.instanceId, id));
    const formats = outputs.map((o) => o.format).sort();
    expect(formats).toContain("pdf");
    expect(formats).toContain("xlsx");
    expect(formats).toContain("zip");
    expect(formats).not.toContain("docx");
  }, 120_000);
});

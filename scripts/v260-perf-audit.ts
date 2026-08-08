/**
 * v2.6 §J — قياس الأداء بأهداف صريحة، على القاعدة الاصطناعية (`madrasa_ci_test`).
 *
 * الأهداف المعلنة في النطاق: صفحة تقرير عادية ≈ ثانيتان؛ تحديث المعاينة ≈ ثلاث ثوانٍ؛
 * والتوليد الكبير في الخلفية لا يجمّد الاستخدام (يُثبت بنيوياً في D-059 — هنا نقيس زمنه
 * فقط). يقيس هذا السكربت الوسيط من خمس عينات بعد إحماء، على حجمين: الحجم التمثيلي
 * (60 برنامجاً — قاعدة العينات) وحجم إجهاد فوق سقف التصدير (5100 برنامج) حيث يجب أن
 * يُقتطع التقرير عند حدّه **ويُصرَّح بالاقتطاع** لا أن يتمدد بلا حد.
 *
 * التشغيل: `NODE_OPTIONS=--conditions=react-server npx tsx scripts/v260-perf-audit.ts`
 * (يشترط تشغيل `scripts/v260-ci-artifacts.ts` قبله ليبني القاعدة).
 */

import { performance } from "node:perf_hooks";
import { Client } from "pg";

const ADMIN_URL = process.env.CI_ADMIN_DB_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa";
const DB_URL = ADMIN_URL.replace(/\/[^/]+$/, "/madrasa_ci_test");

process.env.MADRASA_ENV = "test";
process.env.DATABASE_URL = DB_URL;
process.env.STORAGE_DIR = process.env.STORAGE_DIR ?? ".ci-artifacts-storage";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "ci-perf-secret";

const PREVIEW_TARGET_MS = 3000;
const PAGE_TARGET_MS = 2000;

async function median(label: string, target: number | null, fn: () => Promise<unknown>): Promise<number> {
  await fn(); // إحماء
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const med = samples[2];
  const verdict = target === null ? "" : med <= target ? " ✓ ضمن الهدف" : ` ✗ فوق الهدف (${target}ms)`;
  console.log(`${label}: median ${med.toFixed(0)}ms (min ${samples[0].toFixed(0)}, max ${samples[4].toFixed(0)})${verdict}`);
  if (target !== null && med > target) failures.push(`${label}: ${med.toFixed(0)}ms > ${target}ms`);
  return med;
}

const failures: string[] = [];

async function main() {
  const probe = new Client({ connectionString: DB_URL });
  await probe.connect();
  const { rows } = await probe.query("SELECT count(*)::int AS n FROM programs");
  if (rows[0].n < 50) throw new Error("شغّل scripts/v260-ci-artifacts.ts أولاً — القاعدة الاصطناعية غير مبذورة");
  await probe.end();

  const { db } = await import("../src/db");
  const { users, planYears, programs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const [user] = await db.select().from(users).limit(1);
  const viewer = {
    id: user.id,
    permissions: new Set([
      "reports.read", "reports.builder", "reports.generate", "documents.issue",
      "plan.read", "evidence.read", "budget.read", "committees.read", "maintenance.read", "performance.read",
    ]),
  };

  const { buildSnapshot } = await import("../src/lib/reports/instances/snapshot");
  const { searchInstances } = await import("../src/lib/reports/instances/service");
  const { instanceHtml } = await import("../src/lib/reports/instances/render");
  const { buildOutputBuffer } = await import("../src/lib/reports/instances/outputs");
  const { readSnapshot } = await import("../src/lib/reports/instances/options");
  const { runReportForExport } = await import("../src/lib/reports/loaders");
  const { reportInstances } = await import("../src/db/schema");

  console.log("── الحجم التمثيلي (60 برنامجاً) ──");

  const single = { typeKey: "single", title: "قياس", storedFilters: {}, storedOptions: { reportKey: "programs-by-domain" }, periodFrom: null, periodTo: null, viewer };
  await median("تحديث معاينة تقرير مفرد (buildSnapshot)", PREVIEW_TARGET_MS, () => buildSnapshot(single));
  await median("تحديث معاينة التقرير الدوري متعدد الأقسام", PREVIEW_TARGET_MS, () =>
    buildSnapshot({ ...single, typeKey: "periodic", storedOptions: {} }),
  );
  await median("بحث الأرشيف", PAGE_TARGET_MS, () => searchInstances({ search: "عينة" }, viewer));

  const [finalRow] = await db.select().from(reportInstances).where(eq(reportInstances.status, "نهائي")).limit(1);
  const frozen = readSnapshot(finalRow.snapshot)!;
  await median("عرض لقطة معتمدة (قراءة + تصيير HTML)", PAGE_TARGET_MS, () => instanceHtml(frozen, { reportNumber: finalRow.reportNumber }));

  const docxMs = await median("توليد Word من اللقطة", null, () => buildOutputBuffer(frozen, "docx", { reportNumber: finalRow.reportNumber }));
  const xlsxMs = await median("توليد Excel من اللقطة", null, () => buildOutputBuffer(frozen, "xlsx", { reportNumber: finalRow.reportNumber }));
  const t0 = performance.now();
  await buildOutputBuffer(frozen, "pdf", { reportNumber: finalRow.reportNumber });
  const pdfMs = performance.now() - t0;
  console.log(`توليد PDF من اللقطة (عينة واحدة — يطلق Chromium): ${pdfMs.toFixed(0)}ms — يجري في الخلفية (D-059) فلا هدف صفحة عليه`);

  console.log("\n── حجم الإجهاد (5100 برنامج — فوق سقف التصدير 5000) ──");
  const [yr] = await db.select().from(planYears).limit(1);
  const bulk = [];
  for (let i = 0; i < 5040; i++) {
    bulk.push({ planYearId: yr.id, seq: 1000 + i, domain: "مجال الإجهاد", name: `برنامج إجهاد ${i}`, status: "معتمد" as const });
  }
  for (let i = 0; i < bulk.length; i += 500) await db.insert(programs).values(bulk.slice(i, i + 500));

  const stress = await runReportForExport("programs-by-domain", {});
  if (!stress.truncated) failures.push("سقف التصدير لم يُفعَّل عند 5100 صف");
  console.log(`صفوف التقرير عند الإجهاد: ${stress.rows.length} — مقتطع: ${stress.truncated ? "نعم (مُصرَّح به)" : "لا!"}`);
  await median("تحديث معاينة عند 5100 برنامج (يُقتطع عند 5000)", PREVIEW_TARGET_MS, () =>
    buildSnapshot({ ...single, storedFilters: {} }),
  );

  console.log(`\nمرجع التوليد: docx ${docxMs.toFixed(0)}ms · xlsx ${xlsxMs.toFixed(0)}ms · pdf ${pdfMs.toFixed(0)}ms`);
  if (failures.length) {
    console.error(`\n✗ ${failures.length} قياس فوق الهدف:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("\n✓ كل القياسات ضمن أهداف §J");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

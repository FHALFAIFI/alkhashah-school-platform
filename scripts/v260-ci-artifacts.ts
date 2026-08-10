/**
 * v2.6 CI — توليد عيّنات المخرجات من بيانات اصطناعية (Phase 10).
 *
 * يبني قاعدة معزولة (`madrasa_ci_test`)، يهاجرها، يبذر بيانات عربية **مختلقة بالكامل**
 * (لا سطر واحد من الملفات المرجعية)، ثم ينشئ تقارير محفوظة تغطي: النوع المفرد بجدول
 * طويل، النوع الدوري متعدد الأقسام، تقريراً برسم بياني، والقوالب الأساسية الخمسة —
 * ويولّد PDF وWord وExcel وZIP ومعاينة الطباعة ولقطات شاشة، ويكتبها في
 * `storage-ci-artifacts/` مع بيان MANIFEST.
 *
 * يعمل محلياً أيضاً: `NODE_OPTIONS=--conditions=react-server npx tsx scripts/v260-ci-artifacts.ts`
 * (يشترط قاعدة التطوير على 5544).
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ADMIN_URL = process.env.CI_ADMIN_DB_URL ?? "postgresql://madrasa:madrasa_dev@localhost:5544/madrasa";
const DB_NAME = "madrasa_ci_test";
const DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${DB_NAME}`);
const OUT_DIR = path.resolve("storage-ci-artifacts");

process.env.MADRASA_ENV = "test";
process.env.DATABASE_URL = DB_URL;
process.env.STORAGE_DIR = path.resolve(".ci-artifacts-storage");
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "ci-artifacts-secret";

async function ensureDb() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();
  execSync("npx tsx src/db/migrate.ts", { stdio: "inherit", env: { ...process.env } });
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  await ensureDb();

  const { db } = await import("../src/db");
  const {
    users,
    planYears,
    programs,
    programFollowups,
    committees,
    committeeMembers,
    people,
    financialItems,
    budgetIncome,
    budgetExpenses,
    evidenceItems,
    evidenceLinks,
  } = await import("../src/db/schema");

  /* ── بذرة اصطناعية عربية — أسماء مختلقة بالكامل ── */
  const [user] = await db.insert(users).values({ username: "ci-user", displayName: "مولّد العينات", passwordHash: "x" }).returning();
  const [year] = await db.insert(planYears).values({ key: "ci-yr", nameAr: "سنة اصطناعية 1448هـ", status: "نشطة" }).returning();

  const domains = ["التعليم والتعلم", "البيئة المدرسية", "الشراكة المجتمعية", "القيادة المدرسية"];
  const owners = ["منسّق تجريبي أول", "منسّقة تجريبية ثانية", "وكيل تجريبي ثالث"];
  // جدول طويل: 60 برنامجاً بنصوص عربية وإنجليزية مختلطة وتواريخ هجرية (§L)
  for (let i = 1; i <= 60; i++) {
    const [p] = await db
      .insert(programs)
      .values({
        planYearId: year.id,
        seq: i,
        domain: domains[i % domains.length],
        name: i % 7 === 0 ? `برنامج STEM التجريبي رقم ${i} — Digital Skills` : `برنامج اصطناعي طويل الاسم لاختبار الالتفاف رقم ${i}`,
        ownerPosition: owners[i % owners.length],
        status: "معتمد",
        progress: (i * 13) % 101,
        executionStatus: ["لم يبدأ", "قيد التنفيذ", "مكتمل"][i % 3],
        hijriStart: "1448/01/15",
        hijriEnd: "1448/06/20",
      })
      .returning();
    if (i <= 10) {
      await db.insert(programFollowups).values({
        programId: p.id,
        weekKey: "2026-W32",
        note: `ملاحظة أسبوعية اصطناعية للبرنامج ${i}`,
        executionStatus: "قيد التنفيذ",
        completedWork: "أُنجز جزء تمثيلي من الأعمال",
        obstacles: i % 2 ? "لا عوائق" : "عائق اصطناعي بسيط",
        createdBy: user.id,
      });
    }
  }

  const [person] = await db
    .insert(people)
    .values({ fullName: "معلم تجريبي أول", category: "معلم", jobTitle: "معلم", employmentStatus: "على رأس العمل" })
    .returning();
  for (const [i, name] of ["اللجنة الاصطناعية الأولى", "لجنة العينات الثانية"].entries()) {
    const [c] = await db
      .insert(committees)
      .values({ planYearId: year.id, nameAr: name, kind: i ? "لجنة" : "مجلس", status: "معتمدة" })
      .returning();
    await db.insert(committeeMembers).values({ committeeId: c.id, personId: person.id, role: "رئيساً" });
  }

  const [item1] = await db.insert(financialItems).values({ nameAr: "بند المستلزمات الاصطناعي", allocatedAmount: "5000", createdBy: user.id }).returning();
  const [item2] = await db.insert(financialItems).values({ nameAr: "بند الأنشطة الاصطناعي", allocatedAmount: "3000", createdBy: user.id }).returning();
  await db.insert(budgetIncome).values({ planYearId: year.id, source: "إيراد اصطناعي", amount: "8000", financialItemId: item1.id, status: "مستلم", createdBy: user.id });
  await db.insert(budgetExpenses).values({ planYearId: year.id, amount: "1234.56", financialItemId: item1.id, supplier: "مورّد تجريبي", createdBy: user.id });
  await db.insert(budgetExpenses).values({ planYearId: year.id, amount: "999.99", financialItemId: item2.id, supplier: "Test Supplier Ltd", createdBy: user.id });

  // شواهد بأنواع متعددة — تغذّي تقرير الرسم البياني وقائمة المرفقات
  const { saveGeneratedFile } = await import("../src/lib/storage");
  const pdfBytes = Buffer.from("%PDF-1.4\nمحتوى شاهد اصطناعي\n%%EOF");
  const evidenceFile = await saveGeneratedFile({ originalName: "شاهد اصطناعي.pdf", mime: "application/pdf", data: pdfBytes, uploadedBy: user.id });
  // ثلاثة أنواع (ملف/رابط/نص) — ليخرج الرسم البياني بثلاثة أعمدة لا عمود واحد
  for (const [i, kind] of (["file", "file", "file", "link", "link", "text"] as const).entries()) {
    await db.insert(evidenceItems).values({
      title: `شاهد اصطناعي ${i + 1}`,
      kind,
      fileId: kind === "file" ? evidenceFile.id : null,
      url: kind === "link" ? "https://example.invalid/synthetic" : null,
      textContent: kind === "text" ? "نص شاهد اصطناعي" : null,
      createdBy: user.id,
    });
  }

  // Synthetic identity for the Word/PDF design gate: placeholder logos rendered
  // locally by chromium (clearly labeled as synthetic — never the real official
  // assets) + a synthetic principal name, so the three-zone header, the embedded
  // ImageRun logos and the approval area are all exercised in the samples.
  const { chromium: chromiumForLogos } = await import("playwright");
  const logoBrowser = await chromiumForLogos.launch();
  async function syntheticLogo(label: string, bg: string): Promise<Buffer> {
    const page = await logoBrowser.newPage({ viewport: { width: 180, height: 180 } });
    await page.setContent(
      `<div style="width:176px;height:176px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;font:700 20px sans-serif;">${label}</div>`,
    );
    const shot = await page.screenshot({ type: "png" });
    await page.close();
    return Buffer.from(shot);
  }
  const ministryLogoPng = await syntheticLogo("شعار<br>اصطناعي 1", "#1f5244");
  const schoolLogoPng = await syntheticLogo("شعار<br>اصطناعي 2", "#348066");
  await logoBrowser.close();
  const { saveUploadedFile } = await import("../src/lib/storage");
  const ministryLogoFile = await saveUploadedFile({
    originalName: "شعار-اصطناعي-1.png",
    mime: "image/png",
    data: ministryLogoPng,
    scope: "branding",
    uploadedBy: user.id,
  });
  const schoolLogoFile = await saveUploadedFile({
    originalName: "شعار-اصطناعي-2.png",
    mime: "image/png",
    data: schoolLogoPng,
    scope: "branding",
    uploadedBy: user.id,
  });
  const { saveDocumentIdentity } = await import("../src/lib/document-identity");
  await saveDocumentIdentity(
    {
      principalName: "مدير تجريبي اصطناعي",
      ministryLogoFileId: ministryLogoFile.id,
      schoolLogoFileId: schoolLogoFile.id,
    },
    user.id,
  );

  const viewer = {
    id: user.id,
    permissions: new Set([
      "reports.read",
      "reports.builder",
      "reports.generate",
      "documents.issue",
      "plan.read",
      "evidence.read",
      "budget.read",
      "committees.read",
      "maintenance.read",
      "performance.read",
    ]),
  };

  const { createInstance, finalizeInstance, getInstance, updateInstance } = await import("../src/lib/reports/instances/service");
  const { buildOutputBuffer, outputFileName } = await import("../src/lib/reports/instances/outputs");
  const { instanceHtml } = await import("../src/lib/reports/instances/render");
  const { readSnapshot } = await import("../src/lib/reports/instances/options");
  const { BASE_TEMPLATES } = await import("../src/lib/reports/instances/base-templates");
  const { assembleZip, verifyZip, zipEntryName } = await import("../src/lib/reports/instances/export-zip");

  type Sample = { title: string; typeKey: string; options: Record<string, unknown>; filters?: Record<string, unknown> };
  const samples: Sample[] = [
    // القوالب الخمسة على الجدول الطويل (60 صفاً، 13 عموداً → أفقي)
    ...BASE_TEMPLATES.map((t) => ({
      title: `عينة قالب ${t.labelAr}`,
      typeKey: "single",
      options: { reportKey: "programs-by-domain", templateKey: t.key },
    })),
    { title: "عينة التقرير الدوري متعدد الأقسام", typeKey: "periodic", options: {} },
    { title: "عينة الملخص التنفيذي", typeKey: "executive", options: {} },
    { title: "عينة الرسم البياني — الشواهد حسب النوع", typeKey: "single", options: { reportKey: "evidence-by-type" } },
    { title: "عينة تقرير فارغ بمرشّح لا يطابق", typeKey: "single", options: { reportKey: "programs-active" } },
  ];

  const manifest: Record<string, unknown>[] = [];
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();

  for (const sample of samples) {
    const created = await createInstance(
      { title: sample.title, typeKey: sample.typeKey, options: sample.options },
      viewer,
    );
    if (created.error) throw new Error(`إنشاء «${sample.title}»: ${created.error}`);
    const id = created.instanceId!;
    if (sample.title.includes("فارغ")) {
      // مرشّح بحث لا يطابق شيئاً — يثبت تقرير «لا بيانات» في كل صيغة
      const row0 = await getInstance(id, viewer);
      await updateInstance(
        id,
        {
          title: row0!.title,
          typeKey: row0!.typeKey,
          options: { ...sample.options, showEmpty: true },
          filters: { search: "لا-وجود-لهذا-النص" },
        },
        viewer,
      );
    }
    const fin = await finalizeInstance(id, viewer);
    if (fin.error) throw new Error(`اعتماد «${sample.title}»: ${fin.error}`);

    const row = await getInstance(id, viewer);
    const doc = readSnapshot(row!.snapshot)!;
    const dir = path.join(OUT_DIR, sample.title.replaceAll(" ", "-").slice(0, 60));
    mkdirSync(dir, { recursive: true });

    const buffers: Record<string, Buffer> = {};
    for (const format of ["pdf", "docx", "xlsx"] as const) {
      const buffer = await buildOutputBuffer(doc, format, { reportNumber: row!.reportNumber });
      buffers[format] = buffer;
      writeFileSync(path.join(dir, outputFileName(doc, format)), buffer);
    }
    const taken = new Set<string>();
    const zipParts = (["pdf", "docx", "xlsx"] as const).map((f) => ({
      name: zipEntryName(outputFileName(doc, f), taken),
      data: buffers[f],
    }));
    const zip = assembleZip(zipParts);
    if (!verifyZip(zip, zipParts.map((p) => p.name))) throw new Error(`حزمة «${sample.title}» فشل فحص سلامتها`);
    writeFileSync(path.join(dir, outputFileName(doc, "zip")), zip);

    const html = await instanceHtml(doc, { reportNumber: row!.reportNumber });
    writeFileSync(path.join(dir, "print-preview.html"), html);

    // لقطة شاشة للمعاينة المطبوعة — للفحص البصري البشري في CI
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(dir, "preview.png"), fullPage: true });
    await page.close();

    // فحوص سلامة أساسية على التواقيع
    if (!buffers.pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(`PDF «${sample.title}» بلا توقيع صالح`);
    if (buffers.docx[0] !== 0x50 || buffers.xlsx[0] !== 0x50) throw new Error(`OOXML «${sample.title}» بلا توقيع PK`);

    manifest.push({
      title: sample.title,
      typeKey: sample.typeKey,
      reportNumber: row!.reportNumber,
      sections: doc.stats.sectionCount,
      rows: doc.stats.totalRows,
      pdfBytes: buffers.pdf.length,
      docxBytes: buffers.docx.length,
      xlsxBytes: buffers.xlsx.length,
      zipBytes: zip.length,
    });
    console.log(`✓ ${sample.title} — رقم ${row!.reportNumber}, صفوف ${doc.stats.totalRows}`);
  }

  await browser.close();
  writeFileSync(path.join(OUT_DIR, "MANIFEST.json"), JSON.stringify({ generatedFor: "v2.6 CI", synthetic: true, samples: manifest }, null, 2));
  console.log(`\nكل العينات ولِّدت في ${OUT_DIR} — بيانات اصطناعية بالكامل.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

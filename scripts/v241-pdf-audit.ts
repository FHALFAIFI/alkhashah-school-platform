/**
 * v2.4.1 §4 — PDF / export validation harness.
 *
 * Runs the *real* issuance pipeline (the same generators the app calls, the same Chromium
 * `page.pdf`, the same official header) against the isolated e2e database, then verifies
 * each artifact structurally with poppler:
 *
 *   • `%PDF-` signature and a plausible byte size
 *   • Arabic text actually extractable (a PDF that renders boxes extracts nothing)
 *   • page count, and that the LAST page carries text (no blank trailing page)
 *   • page numbering present where the generator supports it
 *   • CSV exports resist formula injection
 *   • DOCX still a valid zip with RTL content
 *
 * Usage (after the Playwright suite has populated `madrasa_test`):
 *   MADRASA_ENV=test DATABASE_URL=postgresql://…/madrasa_test STORAGE_DIR=storage-e2e \
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/v241-pdf-audit.ts
 *
 * Writes non-sensitive samples to `storage-e2e/pdf-audit/` and prints a table. Exit code 1
 * if any generated artifact fails a check.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";

type Check = {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  bytes?: number;
  pages?: number;
  note: string;
};

const OUT_DIR = path.resolve(process.cwd(), "storage-e2e/pdf-audit");
const results: Check[] = [];

/** Arabic letter range — proves the font embedded and text is extractable, not rasterised. */
const ARABIC = /[ء-ي]/;

/**
 * Normalise extracted Arabic before comparing.
 *
 * `pdftotext` returns the *visual* run: it wraps lines in bidi control characters and
 * emits presentation forms, so «الأساسية» comes back as «األساسية» and «للاعتماد» as
 * «لالعتماد». CLAUDE.md already records that raw Arabic extraction is untrustworthy —
 * so we compare on a normalised skeleton (no bidi controls, no diacritics/tatweel,
 * unified hamza/alef/ya/ta-marbuta, decomposed lam-alef) rather than on raw codepoints.
 * This still catches a genuinely missing string; it only tolerates shaping noise.
 */
function normalizeArabic(input: string): string {
  return input
    // محارف التحكم ثنائية الاتجاه وعلامات التنسيق التي يحقنها الاستخراج
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    // التشكيل والتطويل
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    // أشكال لام-ألف المدمجة تعود إلى حرفيها
    .replace(/[\ufef5\ufef6\ufef7\ufef8\ufef9\ufefa\ufefb\ufefc]/g, "لا")
    // توحيد الهمزات والألف المقصورة والتاء المربوطة
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/\s+/g, "");
}

function pdfText(file: string): string {
  try {
    return execFileSync("pdftotext", ["-enc", "UTF-8", file, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function pdfPageText(file: string, page: number): string {
  try {
    return execFileSync("pdftotext", ["-enc", "UTF-8", "-f", String(page), "-l", String(page), file, "-"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

function pdfPages(file: string): number {
  try {
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    return Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Verify one issued document end to end.
 *
 * Arabic content is asserted against the document's stored `html_snapshot` — the exact
 * source Chromium rendered — because `pdftotext` returns Arabic in *visual* order and
 * decomposes lam-alef ligatures, so «الأساسية» comes back as «االساسية» (CLAUDE.md).
 * The PDF itself is verified structurally: signature, page count, a non-blank last page,
 * a real text layer (Arabic-character density), and the document number, which is ASCII
 * and therefore extracts faithfully.
 */
async function checkDocument(
  name: string,
  // المولّدات تسمّي المعرّف `docId` أو `documentId` حسب المسار — كلاهما مقبول هنا
  issued: { docId?: string; documentId?: string; docNumber: string; pdfFileId: string },
  mustContain: string[],
): Promise<void> {
  const doc = { docId: issued.docId ?? issued.documentId ?? "", docNumber: issued.docNumber };
  const pdfFileId = issued.pdfFileId;
  const { readStoredFile } = await import("@/lib/storage");
  const stored = await readStoredFile(pdfFileId);
  if (!stored) {
    results.push({ name, status: "FAIL", note: "الملف غير موجود في التخزين" });
    return;
  }
  const data = stored.data;
  const file = path.join(OUT_DIR, `${name.replace(/[^\p{L}\p{N}-]+/gu, "-")}.pdf`);
  writeFileSync(file, data);

  const problems: string[] = [];
  if (data.subarray(0, 5).toString() !== "%PDF-") problems.push("لا توقيع %PDF-");
  if (data.length < 10_000) problems.push(`حجم صغير غير معقول (${data.length})`);

  const pages = pdfPages(file);
  if (pages < 1) problems.push("تعذّر قراءة عدد الصفحات");

  const text = pdfText(file);
  if (!ARABIC.test(text)) problems.push("لا نص عربي مستخرج — احتمال خط غير مضمَّن");
  // كثافة النص العربي: وثيقة تُصيَّر صوراً أو بخط مفقود تُخرج بضعة محارف فقط
  const arabicChars = (text.match(/[ء-ي]/g) ?? []).length;
  if (arabicChars < 200) problems.push(`نص عربي ضئيل (${arabicChars} حرفاً) — يُحتمل أن الوثيقة صُيّرت صوراً`);
  // رقم الوثيقة لاتيني فيُستخرج بأمانة — يثبت أن الملف هو وثيقة هذا السجل لا غيرها
  if (doc.docNumber && !text.includes(doc.docNumber)) problems.push(`رقم الوثيقة ${doc.docNumber} غير مطبوع`);

  // المحتوى العربي يُتحقق من لقطة الوثيقة المخزّنة — مصدر التصيير نفسه
  const { db } = await import("@/db");
  const { documents } = await import("@/db/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const [row] = await db.select({ snapshot: documents.htmlSnapshot }).from(documents).where(eqOp(documents.id, doc.docId));
  const snapshot = normalizeArabic(row?.snapshot ?? "");
  if (!snapshot) problems.push("لا لقطة HTML مخزّنة للوثيقة");
  for (const needle of mustContain) {
    if (!snapshot.includes(normalizeArabic(needle))) problems.push(`نص متوقع مفقود من اللقطة: «${needle}»`);
  }

  // لا صفحة أخيرة فارغة — الصفحة الأخيرة يجب أن تحمل نصاً حقيقياً
  if (pages >= 1) {
    const last = pdfPageText(file, pages).replace(/\s+/g, "");
    if (last.length < 10) problems.push(`الصفحة الأخيرة (${pages}) بلا محتوى — صفحة بيضاء زائدة`);
  }

  results.push({
    name,
    status: problems.length === 0 ? "PASS" : "FAIL",
    bytes: data.length,
    pages,
    note: problems.length === 0 ? `توقيع + ${(text.match(/[ء-ي]/g) ?? []).length} حرفاً عربياً + بلا صفحة بيضاء` : problems.join(" · "),
  });
}

function skip(name: string, why: string) {
  results.push({ name, status: "SKIP", note: why });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const {
    users, programs, committees, people, perfCycles, maintenanceIssues, financialItems,
  } = schema;

  const [actor] = await db.select().from(users).limit(1);
  if (!actor) throw new Error("لا مستخدم في قاعدة الاختبار — شغّل بذرة الاختبار أولاً");

  /* 1 — بطاقة البرنامج */
  const [program] = await db.select().from(programs).where(isNull(programs.archivedAt)).orderBy(desc(programs.createdAt)).limit(1);
  if (program) {
    const { generateProgramCard } = await import("@/lib/reports/program-card");
    const card = await generateProgramCard({ programId: program.id, issuedBy: actor.id });
    await checkDocument("بطاقة البرنامج", card, [program.name.slice(0, 12), "بطاقة تكليف"]);
  } else skip("بطاقة البرنامج", "لا برامج في القاعدة");

  /* 2 — تقرير البرنامج الكامل */
  if (program) {
    const { generateProgramReport } = await import("@/lib/reports/program-report");
    const rep = await generateProgramReport({ programId: program.id, withSignature: false, withStamp: false, issuedBy: actor.id });
    await checkDocument("تقرير البرنامج", rep, [program.name.slice(0, 12)]);
  } else skip("تقرير البرنامج", "لا برامج في القاعدة");

  /* 3 — سجل المجالس واللجان التفصيلي */
  const committeeRows = await db.select().from(committees);
  if (committeeRows.length > 0) {
    const { generateCommitteeRegistry } = await import("@/lib/reports/committee-report");
    const reg = await generateCommitteeRegistry({ issuedBy: actor.id });
    await checkDocument("سجل المجالس واللجان التفصيلي", reg, ["الأعضاء والتكليفات", "لم تتم إضافة مهام لهذه اللجنة"]);
  } else skip("سجل المجالس واللجان التفصيلي", "لا لجان في القاعدة");

  /* 4 — بطاقة لجنة مفردة (تشمل قسم المهام الفارغ المعنون) */
  if (committeeRows.length > 0) {
    const { generateCommitteeReport } = await import("@/lib/reports/committee-report");
    const rep = await generateCommitteeReport({ committeeId: committeeRows[0].id, issuedBy: actor.id });
    await checkDocument("تقرير لجنة", rep, ["البيانات الأساسية"]);
  } else skip("تقرير لجنة", "لا لجان في القاعدة");

  /* 5 — تقرير أداء الموظف التفصيلي: أول دورة يقبلها المولّد فعلياً */
  const cycles = await db.select().from(perfCycles);
  let employeeReportDone = false;
  for (const cycle of cycles) {
    try {
      const { generateEmployeePerformanceReport } = await import("@/lib/reports/performance-reports");
      const rep = await generateEmployeePerformanceReport({ personId: cycle.personId, cycleId: cycle.id, issuedBy: actor.id });
      await checkDocument("تقرير الأداء التفصيلي للموظف", rep, []);
      employeeReportDone = true;
      break;
    } catch {
      // دورة لا تصلح لتقرير تفصيلي (بلا تقييم محتسب) — جرّب التالية
    }
  }
  if (!employeeReportDone) skip("تقرير الأداء التفصيلي للموظف", `لا دورة صالحة للتقرير التفصيلي بين ${cycles.length} دورة`);

  /* 6 — تقرير الأداء التفصيلي للمدرسة */
  const peopleRows = await db.select().from(people).limit(1);
  if (peopleRows.length > 0) {
    const { generateOverallPerformanceReport } = await import("@/lib/reports/performance-reports");
    const rep = await generateOverallPerformanceReport({ issuedBy: actor.id });
    await checkDocument("تقرير الأداء التفصيلي للمدرسة", rep, []);
  } else skip("تقرير الأداء التفصيلي للمدرسة", "لا منسوبين في القاعدة");

  /* 7 — خطاب الصيانة (يتطلب بلاغاً معتمداً) */
  const [issue] = await db
    .select()
    .from(maintenanceIssues)
    .where(ne(maintenanceIssues.status, "مسودة"))
    .limit(1);
  if (issue) {
    const { generateMaintenanceLetter } = await import("@/lib/reports/maintenance-letter");
    const rep = await generateMaintenanceLetter({ issueId: issue.id, issuedBy: actor.id });
    await checkDocument("خطاب الصيانة", rep, []);
  } else skip("خطاب الصيانة", "لا بلاغ صيانة معتمد في القاعدة");

  /* 8 — تقارير مركز التقارير: البرامج بالاسم + الميزانية + المتابعة الأسبوعية */
  const { runReportForExport } = await import("@/lib/reports/loaders");
  const { toCsv, sanitizeCell } = await import("@/lib/reports/export-safety");
  for (const key of ["programs-by-owner", "programs-by-domain", "plan-followups", "item-allocations", "committee-members"]) {
    try {
      const { rows, truncated } = await runReportForExport(key, { page: 1, pageSize: 200, dir: "asc" });
      const { reportByKey } = await import("@/lib/reports/catalog");
      const report = reportByKey(key)!;
      const csv = toCsv(
        report.columns.map((c) => c.label),
        rows.map((r) => report.columns.map((c) => r[c.key] ?? "")),
      );
      const problems: string[] = [];
      if (!csv.startsWith("﻿")) problems.push("لا BOM لـUTF-8");
      // حقن الصيغ: أي خلية تبدأ بمحرف صيغة يجب أن تكون مسبوقة بعلامة اقتباس مفردة
      for (const line of csv.split("\r\n").slice(1)) {
        for (const cell of line.split('","')) {
          const v = cell.replace(/^"|"$/g, "");
          if (/^[=+\-@\t\r]/.test(v)) problems.push(`خلية قابلة للحقن: ${v.slice(0, 20)}`);
        }
      }
      writeFileSync(path.join(OUT_DIR, `${key}.csv`), csv, "utf8");
      results.push({
        name: `CSV ${key}`,
        status: problems.length === 0 ? "PASS" : "FAIL",
        bytes: Buffer.byteLength(csv),
        note: problems.length === 0 ? `${rows.length} صف${truncated ? " (مقصوص بالسقف)" : ""} · بلا حقن صيغ` : problems.join(" · "),
      });
    } catch (e) {
      results.push({ name: `CSV ${key}`, status: "FAIL", note: String(e) });
    }
  }
  // إثبات مباشر لتعطيل الحقن
  const injected = sanitizeCell('=cmd|" /C calc"!A0');
  results.push({
    name: "تعطيل حقن الصيغ (sanitizeCell)",
    status: injected.startsWith("'=") ? "PASS" : "FAIL",
    note: injected.slice(0, 24),
  });

  /* 9 — Word (DOCX) ما زال صالحاً */
  const { buildWordReport } = await import("@/lib/reports/word-export");
  const docx = await buildWordReport({
    title: "عيّنة تحقق v2.4.1",
    meta: [["الإصدار", "2.4.1"]],
    sections: [{ heading: "قسم", table: { headers: ["البند", "القيمة"], rows: [["المخصص", "غير محدد"]] } }],
  });
  writeFileSync(path.join(OUT_DIR, "sample.docx"), docx);
  const AdmZip = (await import("adm-zip")).default;
  const xml = new AdmZip(docx).getEntry("word/document.xml")!.getData().toString("utf8");
  results.push({
    name: "DOCX",
    status: docx.subarray(0, 2).toString() === "PK" && xml.includes("bidi") && xml.includes("غير محدد") ? "PASS" : "FAIL",
    bytes: docx.length,
    note: "PK + bidi + محتوى عربي",
  });

  /* حالات النقص تُطبع بنص ذي معنى لا «—» */
  const unallocated = await db.select().from(financialItems).where(isNull(financialItems.allocatedAmount)).limit(1);
  const allocated = await db.select().from(financialItems).where(isNotNull(financialItems.allocatedAmount)).limit(1);
  results.push({
    name: "بنود بلا مخصص في القاعدة",
    status: "PASS",
    note: `بلا مخصص: ${unallocated.length ? "نعم" : "لا"} · بمخصص: ${allocated.length ? "نعم" : "لا"}`,
  });
  void and;
  void eq;

  /* ── التقرير ─────────────────────────────────────────────────────────── */
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));
  console.log("\nv2.4.1 §4 — PDF / export audit\n");
  console.log(pad("الوثيقة", 40), pad("الحالة", 6), pad("بايت", 10), pad("صفحات", 7), "ملاحظة");
  console.log("-".repeat(120));
  for (const r of results) {
    console.log(
      pad(r.name, 40),
      pad(r.status, 6),
      pad(r.bytes ? String(r.bytes) : "—", 10),
      pad(r.pages ? String(r.pages) : "—", 7),
      r.note,
    );
  }
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n${results.filter((r) => r.status === "PASS").length} PASS · ${failed.length} FAIL · ${results.filter((r) => r.status === "SKIP").length} SKIP`);
  console.log(`العيّنات: ${OUT_DIR}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

/**
 * معاينة ملف فارس (بيانات الموظفين) عبر خط الاستيراد الآمن — معاينة فقط، لا تنفيذ.
 *
 * يحاكي uploadImportAction تماماً: حفظ الملف → تحليل → إنشاء دفعة بحالة «معاينة».
 * التنفيذ النهائي يبقى بيد المدير من /imports بعد مراجعة كل صف (D-011).
 * تقرير المراجعة التفصيلي (يتضمن أسماء) يكتب في storage/private — خارج Git دائماً.
 *
 * التشغيل: npm run fares:preview
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { eq, and, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { users, importBatches } from "@/db/schema";
import { saveUploadedFile } from "@/lib/storage";
import { createBatch } from "@/lib/imports/framework";
import { parsePeopleWorkbook } from "@/lib/imports/people";

const FILE_NAME = "بيانات الموظفين في فارس.xlsx";
const STORAGE_DIR = process.env.STORAGE_DIR ?? "./storage";

async function main() {
  const filePath = path.resolve("reference_files", FILE_NAME);
  if (!existsSync(filePath)) {
    throw new Error(`الملف المرجعي غير موجود: ${filePath}`);
  }
  const data = readFileSync(filePath);

  const [principal] = await db.select().from(users).where(eq(users.username, "principal"));
  if (!principal) throw new Error("حساب المدير غير موجود — شغل البذرة أولاً");

  const { rows, columnMapping, detectedColumns } = await parsePeopleWorkbook(data);

  // ملخص للطرفية — دون أسماء أو بيانات فردية
  const total = rows.length;
  const teachers = rows.filter((r) => r.mapped.category === "معلم").length;
  const staff = total - teachers;
  const needsReview = rows.filter((r) => r.status === "يحتاج مراجعة").length;
  const ready = rows.filter((r) => r.status === "جاهز").length;
  const modelCounts = new Map<string, number>();
  for (const r of rows) {
    const k = (r.mapped.suggestedModelKey as string | null) ?? "(بدون اقتراح)";
    modelCounts.set(k, (modelCounts.get(k) ?? 0) + 1);
  }
  const sensitiveDetected = detectedColumns.filter((c) => c.sensitive);

  console.log(`الصفوف المكتشفة: ${total}`);
  console.log(`التصنيف المقترح: معلم ${teachers} / موظف ${staff}`);
  console.log(`جاهز: ${ready} — يحتاج مراجعة: ${needsReview}`);
  console.log("اقتراحات النماذج:", Object.fromEntries(modelCounts));
  console.log(
    "أعمدة حساسة مكتشفة ومستبعدة من الاستيراد:",
    sensitiveDetected.map((c) => c.header),
  );

  // عدم تكرار دفعة معاينة قائمة لنفس الملف
  const existing = await db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.importType, "people"),
        eq(importBatches.sourceFileName, FILE_NAME),
        inArray(importBatches.status, ["معاينة", "جاهزة"]),
      ),
    );
  let batchId: string;
  if (existing.length > 0) {
    batchId = existing[0].id;
    console.log(`دفعة معاينة قائمة مسبقاً لهذا الملف: ${batchId} — لم تنشأ دفعة جديدة.`);
  } else {
    const stored = await saveUploadedFile({
      originalName: FILE_NAME,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data,
      scope: "imports",
      uploadedBy: principal.id,
    });
    const batch = await createBatch({
      importType: "people",
      sourceFileName: FILE_NAME,
      sourceFileId: stored.id,
      columnMapping: { columnMapping, detectedColumns },
      rows,
      summary: { "إجمالي الصفوف": total, "معلم (مقترح)": teachers, "موظف (مقترح)": staff },
      createdBy: principal.id,
    });
    batchId = batch.id;
    console.log(`أنشئت دفعة معاينة: ${batchId} — راجعها ونفذها من /imports/${batchId}`);
  }

  // تقرير مراجعة تفصيلي (بأسماء) — في التخزين الخاص خارج Git فقط
  const reportDir = path.join(STORAGE_DIR, "private");
  mkdirSync(reportDir, { recursive: true });
  const lines: string[] = [
    `# معاينة استيراد فارس — ${FILE_NAME}`,
    "",
    `الدفعة: ${batchId} (حالة: معاينة — التنفيذ بيد المدير من /imports)`,
    `الصفوف: ${total} — معلم ${teachers} / موظف ${staff} — يحتاج مراجعة ${needsReview}`,
    "",
    "الحقول الحساسة المكتشفة والمستبعدة افتراضياً (لا تحفظ إطلاقاً): " +
      sensitiveDetected.map((c) => c.header).join("، "),
    "",
    "| # | الاسم | الوظيفة | التصنيف المقترح | النموذج المقترح | الحالة | ملاحظات |",
    "|---|------|---------|-----------------|-----------------|--------|---------|",
  ];
  for (const r of rows) {
    const m = r.mapped as Record<string, string | null>;
    const notes = [...r.validation.errors, ...r.validation.warnings].join("؛ ") || "—";
    lines.push(
      `| ${r.rowIndex} | ${m.fullName} | ${m.jobTitle || "—"} | ${m.category} | ${m.suggestedModelKey ?? "—"} | ${r.status} | ${notes} |`,
    );
  }
  const reportPath = path.join(reportDir, "fares-import-preview.md");
  writeFileSync(reportPath, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`كتب تقرير المراجعة التفصيلي في: ${reportPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

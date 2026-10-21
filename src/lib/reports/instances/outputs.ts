import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { reportInstances, reportOutputs, storedFiles } from "@/db/schema";
import { readStoredFile, saveGeneratedFile } from "@/lib/storage";
import { htmlToPdf } from "@/lib/pdf";
import { safeFileName } from "../export-safety";
import { instanceHtml } from "./render";
import { instanceDocx } from "./export-docx";
import { instanceXlsx } from "./export-xlsx";
import { assembleZip, verifyZip, zipEntryName, type ZipPart } from "./export-zip";
import { instanceFileBase, readSnapshot, type SnapshotDoc } from "./options";
import { INSTANCE_DRAFT } from "./types";

/**
 * توليد مخرجات التقرير وحفظها (v2.6 §B/§G — D-060).
 *
 * القاعدة: **المسودة تُبنى وتُبثّ ولا تُحفظ** (كمُصدِّر مركز التقارير)، والتقرير
 * المعتمد تُحفظ مخرجاته صفاً لكل (تقرير، صيغة) في `report_outputs` — والإعادة لا تكرّر:
 * الصيغة المحفوظة فعلاً تُتخطى، فالمهمة المعادة بعد انقطاع تكمل الناقص فقط (§I).
 *
 * ZIP وحدها تُجمَّع من الأجزاء المحفوظة وتُستبدل عند وصول النسخة الموقّعة — القادح في
 * القاعدة يسمح بذلك لها حصراً (الهجرة 0035).
 */

export const OUTPUT_FORMATS = ["pdf", "docx", "xlsx"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

const MIME: Record<OutputFormat | "zip", string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

/** بناء صيغة واحدة من وثيقة اللقطة — المصدر الواحد لكل المسارات (D-060) */
export async function buildOutputBuffer(
  doc: SnapshotDoc,
  format: OutputFormat,
  opts: { reportNumber?: string | null },
): Promise<Buffer> {
  if (format === "pdf") {
    const html = await instanceHtml(doc, {
      reportNumber: opts.reportNumber ?? null,
      draftBanner: !opts.reportNumber,
    });
    return htmlToPdf(html, { pageNumbers: true, preferCssPageSize: true });
  }
  if (format === "docx") return instanceDocx(doc, { reportNumber: opts.reportNumber ?? null });
  return instanceXlsx(doc, { reportNumber: opts.reportNumber ?? null });
}

/** اسم ملف المخرج (§G): «الاسم الكامل للتقرير - تاريخ إنشاء التقرير» */
export function outputFileName(doc: SnapshotDoc, format: string): string {
  return safeFileName(instanceFileBase(doc.title, doc.generatedAtIso), format);
}

type InstanceRow = typeof reportInstances.$inferSelect;

/**
 * توليد صيغة محفوظة لتقرير معتمد — **متكرّر التنفيذ بأمان**: الصف الموجود يُعاد كما هو
 * ولا يولَّد ثانية، فلا ملف مكرر ولا صف مكرر مهما أُعيدت المهمة (§I).
 */
export async function ensureStoredOutput(
  row: InstanceRow,
  format: OutputFormat,
  actorId: string,
): Promise<{ fileId: string; created: boolean }> {
  if (row.status === INSTANCE_DRAFT) throw new Error("مخرجات المسودة لا تُحفظ — تُبنى عند طلبها");
  const doc = readSnapshot(row.snapshot);
  if (!doc) throw new Error("لقطة التقرير غير قابلة للقراءة");

  const [existing] = await db
    .select()
    .from(reportOutputs)
    .where(and(eq(reportOutputs.instanceId, row.id), eq(reportOutputs.format, format)));
  if (existing) return { fileId: existing.fileId, created: false };

  const buffer = await buildOutputBuffer(doc, format, { reportNumber: row.reportNumber });
  const file = await saveGeneratedFile({
    originalName: outputFileName(doc, format),
    mime: MIME[format],
    data: buffer,
    sensitive: row.sensitive,
    uploadedBy: actorId,
  });
  await db
    .insert(reportOutputs)
    .values({ instanceId: row.id, format, fileId: file.id, checksum: file.sha256, size: file.size })
    .onConflictDoNothing();
  // سباق نادر: صفّ آخر سبقنا بين الفحص والإدراج — الصف الفائز هو الحقيقة
  const [final] = await db
    .select()
    .from(reportOutputs)
    .where(and(eq(reportOutputs.instanceId, row.id), eq(reportOutputs.format, format)));
  return { fileId: final?.fileId ?? file.id, created: final?.fileId === file.id };
}

/**
 * تجميع حزمة ZIP من الأجزاء المحفوظة (§G — D-060): المخرجات الثلاث + النسخة الموقّعة +
 * الشواهد المرفقة المجمّدة في اللقطة. تُستبدل الحزمة القائمة (المسموح الوحيد بعد
 * الاعتماد) — وهو ما يجعل وصول النسخة الموقّعة يدخل الحزمة تلقائياً.
 *
 * يقرأ الصفّ من القاعدة **لحظة التجميع** لا من معامل مرَّر (بلوكر §6): مرجع النسخة
 * الموقّعة قد يتبدل بين جدولة المهمة وتنفيذها، والحزمة يجب أن تحمل الحالة الراهنة حتماً.
 */
export async function rebuildZip(instanceId: string, actorId: string): Promise<{ fileId: string }> {
  const [row] = await db.select().from(reportInstances).where(eq(reportInstances.id, instanceId));
  if (!row) throw new Error("التقرير غير موجود");
  if (row.status === INSTANCE_DRAFT) throw new Error("حزمة المسودة لا تُحفظ");
  const doc = readSnapshot(row.snapshot);
  if (!doc) throw new Error("لقطة التقرير غير قابلة للقراءة");

  const parts: ZipPart[] = [];
  const taken = new Set<string>();

  const outputs = await db.select().from(reportOutputs).where(eq(reportOutputs.instanceId, row.id));
  for (const output of outputs.filter((o) => o.format !== "zip")) {
    const stored = await readStoredFile(output.fileId);
    if (!stored) continue;
    parts.push({ name: zipEntryName(outputFileName(doc, output.format), taken), data: stored.data });
  }

  if (row.signedCopyFileId) {
    const signed = await readStoredFile(row.signedCopyFileId);
    if (signed) {
      parts.push({ name: zipEntryName(`النسخة الموقعة - ${signed.file.originalName}`, taken), data: signed.data });
    }
  }

  for (const attachment of doc.attachments) {
    const stored = await readStoredFile(attachment.fileId);
    if (!stored) continue;
    parts.push({ name: zipEntryName(`مرفق - ${stored.file.originalName}`, taken), data: stored.data });
  }

  if (parts.length === 0) throw new Error("لا مخرجات محفوظة تُجمَّع بعد — ولّد الصيغ أولاً");

  const zip = assembleZip(parts);
  // فحص السلامة قبل الحفظ (§G): تُقرأ الحزمة وتُستخرج مدخلاتها فعلاً قبل أن تُخزَّن
  if (!verifyZip(zip, parts.map((p) => p.name))) throw new Error("فشل فحص سلامة الحزمة قبل حفظها");

  const file = await saveGeneratedFile({
    originalName: outputFileName(doc, "zip"),
    mime: MIME.zip,
    data: zip,
    sensitive: row.sensitive,
    uploadedBy: actorId,
  });

  const [existing] = await db
    .select()
    .from(reportOutputs)
    .where(and(eq(reportOutputs.instanceId, row.id), eq(reportOutputs.format, "zip")));
  if (existing) {
    await db
      .update(reportOutputs)
      .set({ fileId: file.id, checksum: file.sha256, size: file.size, createdAt: new Date() })
      .where(eq(reportOutputs.id, existing.id));
  } else {
    await db
      .insert(reportOutputs)
      .values({ instanceId: row.id, format: "zip", fileId: file.id, checksum: file.sha256, size: file.size });
  }
  return { fileId: file.id };
}

/**
 * قراءة مخرج محفوظ للبثّ — التجزئة تُحسب من **البايتات الفعلية على القرص** لحظة القراءة
 * وتُقارن بالمسجلة وقت التوليد (بلوكر §8): عبثٌ بالملف المخزَّن — أو تلفه — يُرفض بنتيجة
 * «معطوب» صريحة، لا بصمت ولا بمقارنة سجلَّين في القاعدة كلاهما قابل للانحراف عن القرص.
 */
export type OutputRead =
  | { output: typeof reportOutputs.$inferSelect; file: NonNullable<Awaited<ReturnType<typeof readStoredFile>>>["file"]; data: Buffer }
  | { corrupt: true }
  | null;

export async function readOutput(instanceId: string, format: string): Promise<OutputRead> {
  const [output] = await db
    .select()
    .from(reportOutputs)
    .where(and(eq(reportOutputs.instanceId, instanceId), eq(reportOutputs.format, format)));
  if (!output) return null;
  const stored = await readStoredFile(output.fileId);
  if (!stored) return null;
  const actualDigest = createHash("sha256").update(stored.data).digest("hex");
  const expected = output.checksum ?? stored.file.sha256;
  if (expected && actualDigest !== expected) return { corrupt: true };
  return { output, file: stored.file, data: stored.data };
}

/** الملف الموقّع المرفوع — للبث والعرض، بفحص البايتات الفعلية نفسه (§8) */
export async function readSignedCopy(row: InstanceRow): Promise<{ file: NonNullable<Awaited<ReturnType<typeof readStoredFile>>>["file"]; data: Buffer } | { corrupt: true } | null> {
  if (!row.signedCopyFileId) return null;
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, row.signedCopyFileId));
  if (!file) return null;
  const stored = await readStoredFile(file.id);
  if (!stored) return null;
  const actualDigest = createHash("sha256").update(stored.data).digest("hex");
  if (file.sha256 && actualDigest !== file.sha256) return { corrupt: true };
  return stored;
}

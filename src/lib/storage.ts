import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db";
import { storedFiles } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * تجريد التخزين — الإصدار الأول محلي خاص خارج المجلد العام،
 * والواجهة جاهزة لمزود متوافق مع S3 لاحقاً (DECISIONS D-004).
 */
export interface StorageProvider {
  put(relPath: string, data: Buffer): Promise<void>;
  get(relPath: string): Promise<Buffer>;
  delete(relPath: string): Promise<void>;
}

const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR ?? "./storage");

function safeResolve(relPath: string): string {
  const resolved = path.resolve(STORAGE_DIR, relPath);
  if (!resolved.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error("مسار غير آمن");
  }
  return resolved;
}

class LocalStorageProvider implements StorageProvider {
  async put(relPath: string, data: Buffer): Promise<void> {
    const abs = safeResolve(relPath);
    // Fully async I/O: the old `mkdirSync` blocked the event loop on every upload.
    // safeResolve (path-traversal guard) runs first and unchanged; the 0o600 mode and
    // server-generated path are preserved.
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data, { mode: 0o600 });
  }
  async get(relPath: string): Promise<Buffer> {
    return readFile(safeResolve(relPath));
  }
  async delete(relPath: string): Promise<void> {
    await unlink(safeResolve(relPath));
  }
}

export const storage: StorageProvider = new LocalStorageProvider();

/** أنواع الملفات المسموحة للرفع */
const ALLOWED: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/msword": [".doc"],
  "application/vnd.ms-excel": [".xls"],
  "text/plain": [".txt"],
};

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * تواقيع الملفات (magic bytes) لكل نوع مدعوم — الطبقة الثالثة بعد الامتداد ونوع MIME.
 *
 * نوع MIME يأتي من المتصفّح فيتحكّم فيه المُرسِل بالكامل، والامتداد نص في اسم الملف.
 * التوقيع هو الشيء الوحيد الذي يصف المحتوى الفعلي، ولذلك يشترطه §11.5.F صراحةً:
 * «لا يُوثق بالصور وملفات PDF اعتماداً على نوع المتصفّح وحده».
 *
 * `null` يعني «لا توقيع ثابت لهذا النوع» (النص العادي) فيُقبل بلا فحص توقيع — وهو محتوى
 * خامل يُقدَّم دائماً كمرفق للتنزيل لا كصفحة.
 */
const FILE_SIGNATURES: Record<string, { offset: number; bytes: number[] }[] | null> = {
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // RIFF....WEBP — المقطعان يُفحصان معاً
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }], // %PDF-
  // docx/xlsx حاويات ZIP
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  // doc/xls حاويات OLE2 القديمة
  "application/msword": [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  "application/vnd.ms-excel": [{ offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  "text/plain": null,
};

/**
 * هل يطابق محتوى الملف الفعلي النوع المُعلَن؟ يمنع رفع محتوى مخالف تحت نوع مسموح
 * (مثل HTML باسم `.pdf` ونوع `application/pdf`).
 */
export function validateFileSignature(data: Buffer, mime: string): string | null {
  const signatures = FILE_SIGNATURES[mime];
  if (signatures === null) return null; // نوع بلا توقيع ثابت
  if (!signatures) return "نوع الملف غير مدعوم";
  const matches = signatures.every((sig) => {
    if (data.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((b, i) => data[sig.offset + i] === b);
  });
  return matches ? null : "محتوى الملف لا يطابق نوعه المُعلَن";
}

/**
 * خطأ تحقق من الرفع — رسالته عربية ومقصودة للعرض على المستخدم.
 *
 * تمييزه بنوع خاص يسمح لمستدعي الرفع بعرض رسالته مباشرةً، مع تعميم أي خطأ آخر (خطأ نظام
 * ملفات أو قاعدة بيانات) خلف رسالة عامة — فلا يتسرّب مسار داخلي ولا نص خطأ إنجليزي إلى
 * الواجهة (§11.5 «لا تُكشف المسارات ولا تفاصيل التنفيذ»).
 */
export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function validateUpload(originalName: string, mime: string, size: number): string | null {
  if (size <= 0 || size > MAX_UPLOAD_BYTES) return "حجم الملف يتجاوز الحد المسموح (20 م.ب)";
  const exts = ALLOWED[mime];
  const ext = path.extname(originalName).toLowerCase();
  if (!exts || !exts.includes(ext)) return "نوع الملف غير مدعوم";
  return null;
}

export async function saveUploadedFile(opts: {
  originalName: string;
  mime: string;
  data: Buffer;
  scope?: string;
  sensitive?: boolean;
  uploadedBy?: string;
}) {
  const err = validateUpload(opts.originalName, opts.mime, opts.data.length);
  if (err) throw new UploadValidationError(err);
  // فحص التوقيع يحتاج المحتوى نفسه، فيجري هنا لا في `validateUpload` (التي تفحص
  // الاسم والنوع والحجم قبل قراءة الملف).
  const sigErr = validateFileSignature(opts.data, opts.mime);
  if (sigErr) throw new UploadValidationError(sigErr);
  const ext = path.extname(opts.originalName).toLowerCase();
  const id = randomUUID();
  const scope = opts.scope ?? "attachments";
  const relPath = path.join(scope, id.slice(0, 2), `${id}${ext}`);
  await storage.put(relPath, opts.data);
  const [file] = await db
    .insert(storedFiles)
    .values({
      originalName: opts.originalName,
      mime: opts.mime,
      size: opts.data.length,
      sha256: createHash("sha256").update(opts.data).digest("hex"),
      storagePath: relPath,
      scope,
      sensitive: opts.sensitive ?? false,
      uploadedBy: opts.uploadedBy,
    })
    .returning();
  return file;
}

export async function readStoredFile(fileId: string) {
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, fileId));
  if (!file) return null;
  const data = await storage.get(file.storagePath);
  return { file, data };
}

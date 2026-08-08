import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db";
import { storedFiles, userRoles, roles, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  PRINCIPAL_ROLE_KEY,
  FILE_ACCEPTED,
  FILE_PENDING,
  ACCEPT_MODE_AUTO,
  ACCEPT_MODE_MANUAL,
} from "@/lib/auth/roles";

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

/**
 * هل هذا المستخدم مديرَ مدرسة؟ يُقرأ من جدول الأدوار في القاعدة مباشرةً —
 * قرار القبول لا يعتمد أبداً على قيمة من المتصفح ولا على تذكُّر المستدعي (D-032).
 */
async function isPrincipalUser(userId: string): Promise<boolean> {
  const rows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return rows.some((r) => r.key === PRINCIPAL_ROLE_KEY);
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

  // القبول (D-032): رفع المدير يُقبل فوراً — لا اعتماد ثانٍ من الشخص نفسه؛
  // رفع أي دور آخر يبقى «قيد الاعتماد» حتى يعتمده المدير. فحوص أمان الملف أعلاه
  // تسري في الحالتين قبل هذه النقطة.
  // نطاق "reports" مستثنى: ملفاته وثائق يولّدها النظام عند الإصدار لا مرفوعات مستخدم،
  // ولها آلية الإصدار والتجميد الخاصة بها (documents.issued).
  const applyAcceptance = scope !== "reports";
  const byPrincipal =
    applyAcceptance && opts.uploadedBy ? await isPrincipalUser(opts.uploadedBy) : false;
  const acceptance = !applyAcceptance
    ? {}
    : byPrincipal
      ? {
          acceptanceStatus: FILE_ACCEPTED,
          acceptanceMode: ACCEPT_MODE_AUTO,
          acceptedBy: opts.uploadedBy,
          acceptedAt: new Date(),
        }
      : { acceptanceStatus: FILE_PENDING };

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
      ...acceptance,
    })
    .returning();
  if (applyAcceptance) {
    // سجل التدقيق المركزي لطريقة القبول — إدراج مباشر (لا يستورد lib/audit كي لا
    // تنشأ دورة استيراد؛ الجدول نفسه والحقول نفسها)
    await db.insert(auditLog).values({
      actorId: opts.uploadedBy ?? null,
      action: byPrincipal ? "file.auto_accepted" : "file.pending_acceptance",
      entityType: "stored_file",
      entityId: file.id,
      summary: byPrincipal
        ? `${ACCEPT_MODE_AUTO} — ${opts.originalName}`
        : `ملف بانتظار اعتماد المدير — ${opts.originalName}`,
    });
  }
  return file;
}

/**
 * مخرجات النظام المولَّدة (v2.6 §B/§G) — مسار حفظ مستقل عن رفع المستخدمين.
 *
 * لماذا لا يمر بـ`saveUploadedFile`: قائمة الرفع المسموحة قائمة **مرفوعات مستخدم**، ولا
 * تشمل ZIP عمداً — فتح ZIP للرفع العام يوسّع سطح الهجوم بلا حاجة. أما هنا فالمحتوى
 * ولّده النظام نفسه (PDF/Word/Excel/ZIP لتقرير محفوظ)، فالقائمة مغلقة على هذه الأربع،
 * والحجم يسقفه حد أوسع (حزمة بمرفقاتها تتجاوز حد رفع الملف الواحد)، ولا اعتماد D-032 —
 * كنطاق "reports" في المسار الأصلي تماماً.
 */
const GENERATED_ALLOWED: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/zip": ".zip",
};

export const MAX_GENERATED_BYTES = 100 * 1024 * 1024;

export async function saveGeneratedFile(opts: {
  originalName: string;
  mime: string;
  data: Buffer;
  sensitive?: boolean;
  uploadedBy?: string;
}) {
  const ext = GENERATED_ALLOWED[opts.mime];
  if (!ext) throw new UploadValidationError("نوع المخرج المولَّد غير مدعوم");
  if (opts.data.length <= 0 || opts.data.length > MAX_GENERATED_BYTES) {
    throw new UploadValidationError("حجم المخرج المولَّد يتجاوز الحد المسموح");
  }
  // ZIP يشارك docx/xlsx توقيع PK — والأربعة كلها ذات توقيع معروف يُفحص
  const sigErr =
    opts.mime === "application/zip"
      ? opts.data[0] === 0x50 && opts.data[1] === 0x4b
        ? null
        : "محتوى الملف لا يطابق نوعه المُعلَن"
      : validateFileSignature(opts.data, opts.mime);
  if (sigErr) throw new UploadValidationError(sigErr);

  const id = randomUUID();
  const relPath = path.join("reports", id.slice(0, 2), `${id}${ext}`);
  await storage.put(relPath, opts.data);
  const [file] = await db
    .insert(storedFiles)
    .values({
      originalName: opts.originalName,
      mime: opts.mime,
      size: opts.data.length,
      sha256: createHash("sha256").update(opts.data).digest("hex"),
      storagePath: relPath,
      scope: "reports",
      sensitive: opts.sensitive ?? false,
      uploadedBy: opts.uploadedBy,
    })
    .returning();
  return file;
}

/**
 * اعتماد المدير اليدوي لملف «قيد الاعتماد» (D-032).
 * التحقق من كون المعتمِد مديراً يجري هنا على الخادم من جدول الأدوار —
 * واجهة الاستدعاء مسؤولة عن المصادقة فقط.
 */
export async function acceptStoredFile(opts: {
  fileId: string;
  actorId: string;
}): Promise<{ error?: string; success?: string }> {
  if (!(await isPrincipalUser(opts.actorId))) {
    return { error: "اعتماد الملفات صلاحية مدير المدرسة حصراً" };
  }
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, opts.fileId));
  if (!file) return { error: "الملف غير موجود" };
  if (file.acceptanceStatus !== FILE_PENDING) return { error: "الملف ليس بانتظار الاعتماد" };
  await db
    .update(storedFiles)
    .set({
      acceptanceStatus: FILE_ACCEPTED,
      acceptanceMode: ACCEPT_MODE_MANUAL,
      acceptedBy: opts.actorId,
      acceptedAt: new Date(),
    })
    .where(eq(storedFiles.id, opts.fileId));
  await db.insert(auditLog).values({
    actorId: opts.actorId,
    action: "file.manually_accepted",
    entityType: "stored_file",
    entityId: file.id,
    summary: `${ACCEPT_MODE_MANUAL} — ${file.originalName}`,
  });
  return { success: "اعتُمد الملف" };
}

export async function readStoredFile(fileId: string) {
  const [file] = await db.select().from(storedFiles).where(eq(storedFiles.id, fileId));
  if (!file) return null;
  const data = await storage.get(file.storagePath);
  return { file, data };
}

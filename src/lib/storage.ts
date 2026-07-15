import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
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
    mkdirSync(path.dirname(abs), { recursive: true });
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
  if (err) throw new Error(err);
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

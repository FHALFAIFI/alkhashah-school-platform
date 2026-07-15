import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * تحويل الصفحة الأولى من PDF إلى PNG عبر أدوات النظام:
 * macOS: sips — Ubuntu: pdftoppm (حزمة poppler-utils، موثقة في دليل النشر).
 * يعيد null عند تعذر التحويل بدلاً من الفشل.
 */
export async function pdfFirstPageToPng(pdfData: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "madrasa-pdf-"));
  const pdfPath = path.join(dir, "in.pdf");
  const outPath = path.join(dir, "out.png");
  try {
    await writeFile(pdfPath, pdfData);
    if (process.platform === "darwin") {
      await execFileAsync("sips", ["-s", "format", "png", pdfPath, "--out", outPath], { timeout: 30_000 });
      return await readFile(outPath);
    }
    // pdftoppm يكتب out.png مباشرة مع -singlefile
    await execFileAsync(
      "pdftoppm",
      ["-png", "-f", "1", "-singlefile", "-r", "120", pdfPath, path.join(dir, "out")],
      { timeout: 30_000 },
    );
    return await readFile(outPath);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import "server-only";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { readStoredFile } from "@/lib/storage";

/**
 * عرض مضمون الشاهد داخل التقارير — لا أسماء ملفات فقط:
 * صور مضمنة، الصفحة الأولى من PDF، نص Word، معاينة محدودة لأول ورقة Excel،
 * النص الكامل للملاحظات، والروابط بوصفها دون جلب محتوى خارجي.
 */

export const TRUNCATION_NOTE = "تم اختصار عرض الشاهد داخل التقرير، ويمكن الرجوع إلى الملف الأصلي.";

const MAX_TEXT_CHARS = 2500;

export type RenderedEvidence = {
  title: string;
  role: string | null;
  html: string;
  truncated: boolean;
};

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function renderPdfFirstPage(data: Buffer): Promise<string | null> {
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    const doc = await getDocument({ data: new Uint8Array(data), disableFontFace: false }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise;
    const png = canvas.toBuffer("image/png");
    await doc.destroy();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

function extractDocxText(data: Buffer): string {
  try {
    const zip = new AdmZip(data);
    const entry = zip.getEntry("word/document.xml");
    if (!entry) return "";
    const xml = entry.getData().toString("utf8");
    return xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  } catch {
    return "";
  }
}

async function renderXlsxPreview(data: Buffer): Promise<string> {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return "";
    const maxRows = 15;
    const maxCols = 8;
    let html = "<table>";
    let rowCount = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= maxRows) return;
      rowCount++;
      html += "<tr>";
      for (let c = 1; c <= Math.min(row.cellCount, maxCols); c++) {
        const v = row.getCell(c).text ?? "";
        html += `<td>${esc(String(v)).slice(0, 120)}</td>`;
      }
      html += "</tr>";
    });
    html += "</table>";
    return html;
  } catch {
    return "";
  }
}

export async function renderEvidenceContent(item: {
  title: string;
  kind: string;
  role: string | null;
  fileId: string | null;
  url: string | null;
  textContent: string | null;
  description: string | null;
}): Promise<RenderedEvidence> {
  let html = "";
  let truncated = false;

  if (item.kind === "text" && item.textContent) {
    const text = item.textContent;
    truncated = text.length > MAX_TEXT_CHARS;
    html = `<p>${esc(truncated ? text.slice(0, MAX_TEXT_CHARS) + "…" : text).replaceAll("\n", "<br>")}</p>`;
  } else if (item.kind === "link" && item.url) {
    html = `<p>رابط: <span dir="ltr">${esc(item.url)}</span></p>${item.description ? `<p>${esc(item.description)}</p>` : ""}`;
  } else if (item.kind === "file" && item.fileId) {
    const result = await readStoredFile(item.fileId);
    if (!result) {
      html = `<p class="truncation-note">تعذر الوصول إلى ملف الشاهد.</p>`;
    } else {
      const { file, data } = result;
      if (file.mime.startsWith("image/")) {
        html = `<img class="evidence-img" src="data:${file.mime};base64,${data.toString("base64")}" alt="${esc(item.title)}">`;
      } else if (file.mime === "application/pdf") {
        const img = await renderPdfFirstPage(data);
        if (img) {
          html = `<img class="evidence-img" src="${img}" alt="${esc(item.title)} — الصفحة الأولى">`;
          truncated = true; // نعرض الصفحة الأولى فقط
        } else {
          html = `<p class="truncation-note">ملف PDF — تعذر عرض الصفحة الأولى، يمكن الرجوع إلى الملف الأصلي.</p>`;
        }
      } else if (file.mime.includes("wordprocessingml")) {
        const text = extractDocxText(data);
        truncated = text.length > MAX_TEXT_CHARS;
        html = text
          ? `<p>${esc(truncated ? text.slice(0, MAX_TEXT_CHARS) + "…" : text).replaceAll("\n", "<br>")}</p>`
          : `<p class="truncation-note">تعذر استخراج نص المستند.</p>`;
      } else if (file.mime.includes("spreadsheetml")) {
        html = await renderXlsxPreview(data);
        truncated = true; // معاينة محدودة دائماً
        if (!html) html = `<p class="truncation-note">تعذرت معاينة الجدول.</p>`;
      } else if (file.mime === "text/plain") {
        const text = data.toString("utf8");
        truncated = text.length > MAX_TEXT_CHARS;
        html = `<p>${esc(truncated ? text.slice(0, MAX_TEXT_CHARS) + "…" : text).replaceAll("\n", "<br>")}</p>`;
      } else {
        html = `<p class="truncation-note">نوع ملف غير قابل للمعاينة داخل التقرير — يمكن الرجوع إلى الملف الأصلي (${esc(file.originalName)}).</p>`;
      }
    }
  }

  if (item.description && item.kind !== "link") {
    html += `<p class="meta">${esc(item.description)}</p>`;
  }
  if (truncated) {
    html += `<p class="truncation-note">${TRUNCATION_NOTE}</p>`;
  }

  return { title: item.title, role: item.role, html, truncated };
}

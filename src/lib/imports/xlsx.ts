import "server-only";
import ExcelJS from "exceljs";
import AdmZip from "adm-zip";

const SPREADSHEET_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * بعض المولدات (أدوات ‎.NET/OpenXML — ومنها منتج المصنفات الرسمية للخطة) تكتب XML
 * الداخلي ببادئة نطاق أسماء (<x:workbook>) لا تفهمها exceljs. يعاد هنا تطبيع الأجزاء
 * المبدوءة على نطاق spreadsheetml الرئيسي إلى الصيغة الافتراضية دون مساس بالمحتوى.
 */
export function normalizeWorkbookNamespaces(data: Buffer): Buffer {
  const zip = new AdmZip(data);
  let changed = false;
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.endsWith(".xml")) continue;
    const xml = entry.getData().toString("utf8");
    // البادئة المعلنة على عنصر الجذر والمربوطة بنطاق spreadsheetml الرئيسي
    const m = xml.match(/<([A-Za-z][\w.-]*):[A-Za-z][\w.-]*[^>]*?xmlns:\1="([^"]+)"/);
    if (!m || m[2] !== SPREADSHEET_MAIN_NS) continue;
    const p = m[1];
    const stripped = xml
      .replaceAll(`<${p}:`, "<")
      .replaceAll(`</${p}:`, "</")
      .replace(`xmlns:${p}="${SPREADSHEET_MAIN_NS}"`, `xmlns="${SPREADSHEET_MAIN_NS}"`)
      // المولد نفسه يكرر نطاقات الدمج فترفضها exceljs — الدمج شكلي ولا يمس القيم المقروءة
      .replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/g, "")
      .replace(/<mergeCells[^>]*\/>/g, "");
    zip.updateFile(entry.entryName, Buffer.from(stripped, "utf8"));
    changed = true;
  }
  if (!changed) throw new Error("لا أجزاء مبدوءة البادئة في المصنف");
  return zip.toBuffer();
}

/** قراءة مصنف Excel من ذاكرة مؤقتة إلى مصفوفات نصية لكل ورقة */
export async function readWorkbook(data: Buffer): Promise<Map<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    // محاولة ثانية بعد تطبيع بادئات نطاق الأسماء — وإلا رسالة عربية واضحة
    let normalized: Buffer;
    try {
      normalized = normalizeWorkbookNamespaces(data);
    } catch {
      throw new Error("تعذر فتح الملف — تأكد أنه مصنف Excel ‏(.xlsx) سليم غير تالف");
    }
    try {
      await wb.xlsx.load(normalized as unknown as ArrayBuffer);
    } catch {
      throw new Error("تعذر فتح المصنف رغم إعادة تطبيع بنيته — أرسل الملف للمطور لفحصه");
    }
  }
  const sheets = new Map<string, unknown[][]>();
  wb.eachSheet((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values: unknown[] = [];
      // row.values is 1-based sparse array
      const raw = row.values as unknown[];
      for (let i = 1; i < Math.max(raw.length, 2); i++) {
        let v = raw[i];
        if (v && typeof v === "object") {
          const obj = v as { richText?: { text: string }[]; text?: string; result?: unknown; formula?: string; hyperlink?: string };
          if (obj.richText) v = obj.richText.map((t) => t.text).join("");
          else if (obj.text !== undefined) v = obj.text;
          else if (obj.result !== undefined) v = obj.result;
          else if (v instanceof Date) v = v;
        }
        values.push(v ?? null);
      }
      rows.push(values);
    });
    sheets.set(ws.name, rows);
  });
  return sheets;
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

export function cellNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // نص بلا أرقام (كصف إجمالي «إجمالي الميزانية…») يجب أن يكون null لا صفراً،
  // وإلا تسرّب صفوف العناوين/الإجماليات كسجلات ذات قيمة 0.
  const stripped = String(v).replace(/[^\d.-]/g, "");
  if (stripped === "" || stripped === "-" || stripped === "." || stripped === "-.") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/** إيجاد صف الرؤوس: أول صف يحوي أكثر من 3 قيم قصيرة مميزة */
export function findHeaderRow(rows: unknown[][], maxScan = 8): number {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const uniq = new Set(rows[i]?.filter((c) => c !== null && cellText(c) !== ""));
    if (uniq.size > 3) return i;
  }
  return -1;
}

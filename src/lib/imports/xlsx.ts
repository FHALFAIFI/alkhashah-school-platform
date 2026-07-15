import "server-only";
import ExcelJS from "exceljs";

/** قراءة مصنف Excel من ذاكرة مؤقتة إلى مصفوفات نصية لكل ورقة */
export async function readWorkbook(data: Buffer): Promise<Map<string, unknown[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
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
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
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

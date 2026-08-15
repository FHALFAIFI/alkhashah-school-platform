import "server-only";
import ExcelJS from "exceljs";
import type { SnapshotDoc, SnapshotSection } from "./options";
import { cellText } from "./render";
import { sanitizeCell } from "../export-safety";

/**
 * تصدير التقرير المحفوظ إلى Excel (v2.6 §G) — البيانات الخام بجانب الوثيقة المنسقة.
 *
 * الضمانات:
 *  - ورقة «الملخص» أولاً: هوية التقرير وقائمة الأقسام وكل مرشّحاتها — وصف صريح لما
 *    بُني عليه الملف، ثم ورقة بيانات خالصة لكل قسم تبدأ من الصف الأول (لا أسطر تمهيدية
 *    تكسر الاستيراد — نمط مسار التصدير في v2.5.0 نفسه).
 *  - كل الأوراق `rightToLeft`.
 *  - الأرقام تُكتب أرقاماً فتبقى قابلة للحساب؛ النصوص تمرّ بمعطِّل حقن الصيغ؛
 *    التواريخ وحدها تمرّ بـ`cellText` فتخرج مزدوجة التقويم (D-033).
 *  - عمود المال رقمي بتنسيق «‎#,##0.00‎».
 *  - القسم المقتطع يُختم بصف ملاحظة لا يُقتطع صامتاً.
 */

/**
 * اسم ورقة Excel صالح وفريد: تُحذف المحارف الممنوعة `[]:*?/\`، ويُحدّ الطول بـ31
 * محرفاً (حد Excel الصارم)، ولا يخرج فارغاً، ويُفرَّد بلاحقة « (2)» عند التكرار.
 * الدالة تضيف الاسم المختار إلى `taken` فيتراكم الحجز عبر الاستدعاءات.
 */
export function safeSheetName(name: string, taken: Set<string>): string {
  const cleaned = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let base = (cleaned || "قسم").slice(0, 31).trim();
  if (!base) base = "قسم";
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length).trimEnd()}${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

const MONEY_FORMAT = "#,##0.00";

function addSectionSheet(wb: ExcelJS.Workbook, section: SnapshotSection, taken: Set<string>): void {
  const ws = wb.addWorksheet(safeSheetName(section.label, taken), { views: [{ rightToLeft: true }] });
  ws.columns = section.columns.map((c) => ({
    header: sanitizeCell(c.label),
    key: c.key,
    width: c.type === "date" ? 26 : 18,
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of section.rows) {
    const values = section.columns.map((c) => {
      const v = r[c.key];
      // التاريخ وحده نصّ مزدوج التقويم؛ الرقم يبقى رقماً قابلاً للحساب؛ النص يُعطَّل حقنه
      if (c.type === "date" && typeof v === "string" && v !== "") return sanitizeCell(cellText(v, "date"));
      if (typeof v === "number") return v;
      return sanitizeCell(v);
    });
    const row = ws.addRow(values);
    section.columns.forEach((c, i) => {
      if (c.type === "money" && typeof values[i] === "number") row.getCell(i + 1).numFmt = MONEY_FORMAT;
    });
  }
  // ضمانة البيانات الخام: الاقتطاع يُعلَن في ذيل الورقة لا يُسكت عنه (§G)
  if (section.truncated) ws.addRow(["اقتُطع القسم عند حده الأقصى"]);
}

export async function instanceXlsx(doc: SnapshotDoc, opts: { reportNumber?: string | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const taken = new Set<string>(["الملخص"]);

  const summary = wb.addWorksheet("الملخص", { views: [{ rightToLeft: true }] });
  summary.getColumn(1).width = 32;
  summary.getColumn(2).width = 70;
  // عمود التسميات كله عريض — يقرأ الملخص كبطاقة هوية
  summary.getColumn(1).font = { bold: true };
  const add = (label: string, value: string | number) =>
    summary.addRow([sanitizeCell(label), typeof value === "number" ? value : sanitizeCell(value)]);

  add("عنوان التقرير", doc.title);
  add("نوع التقرير", doc.typeLabel);
  add("رقم التقرير", opts.reportNumber ?? "مسودة");
  if (doc.periodText) add("الفترة", doc.periodText);
  add("تاريخ التوليد", doc.generatedAtText);
  add("طابع التوليد (ISO)", doc.generatedAtIso);
  summary.addRow([]);

  // قائمة الأقسام بعدد صفوفها، وتحت كل قسم كل مرشّحاته سطراً سطراً — وصف صريح
  // للمرشّحات المستعملة لا يُترك للاستنتاج من أوراق البيانات
  add("الأقسام وعدد الصفوف", doc.sections.length);
  for (const section of doc.sections) {
    add(section.label, section.total);
    for (const [k, v] of section.filterLines) add(`مرشّح «${section.label}»`, `${k}: ${v}`);
    if (section.truncated) add(`ملاحظة «${section.label}»`, "اقتُطع القسم عند حده الأقصى");
  }

  for (const section of doc.sections) addSectionSheet(wb, section, taken);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

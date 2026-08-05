/**
 * سلامة التصدير (v2.2 §D10/§10) — وحدة خالصة تُختبر وحدوياً.
 *
 * تحمي ملفات CSV/Excel من حقن الصيغ، وأسماء الملفات من محارف المسار، وتحدّ من حجم
 * التصدير حتى لا يُستنزف الخادم بتصدير غير محدود.
 */

/**
 * محارف بدء الصيغة في Excel/Sheets/Numbers. الخلية التي تبدأ بأحدها قد تُنفَّذ كصيغة
 * عند فتح الملف (`=cmd|…`, `+…`, `-…`, `@…`) — وهذا مسار هجوم حقيقي حين تُبنى الخلية
 * من نص أدخله مستخدم.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@"];
/** محارف تحكم تُستعمل أيضاً لبدء صيغة في بعض البرامج (tab / carriage return) */
const CONTROL_TRIGGERS = ["\t", "\r"];

/**
 * تعطيل حقن الصيغ في خلية: تُسبق القيمة الخطرة بعلامة اقتباس مفردة فتُعامل نصاً.
 * النص الأصلي يبقى مقروءاً للمستخدم ولا تُحذف منه معلومة.
 */
export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.length === 0) return s;
  const first = s[0];
  if (FORMULA_TRIGGERS.includes(first) || CONTROL_TRIGGERS.includes(first)) return `'${s}`;
  return s;
}

/** تهيئة صف كامل للتصدير */
export function sanitizeRow(values: unknown[]): string[] {
  return values.map(sanitizeCell);
}

/**
 * بناء CSV آمن: تعطيل الصيغ، تهريب علامات الاقتباس، وBOM لـUTF-8 حتى يفتح Excel
 * العربية بترميز صحيح.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    headers.map((h) => escape(sanitizeCell(h))).join(","),
    ...rows.map((r) => sanitizeRow(r).map(escape).join(",")),
  ];
  return `﻿${lines.join("\r\n")}`;
}

/**
 * اسم ملف آمن: بلا فواصل مسار ولا `..` ولا محارف تحكم، ومحدود الطول.
 * يُبقي العربية والأرقام والشرطات.
 */
export function safeFileName(name: string, extension: string): string {
  const cleaned = name
    // فواصل المسار تُستبدل ولا تُحذف حتى لا يلتحم مقطعان في اسم مضلِّل
    .replace(/[/\\]/g, "-")
    // `..` يمنع الخروج من المجلد عند أي استعمال لاحق للاسم
    .replace(/\.{2,}/g, "-")
    // محارف التحكم (سطر جديد، NUL، …) تُحذف: تُستعمل لتزوير ترويسة التنزيل
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // محارف ممنوعة في أسماء ملفات ويندوز
    .replace(/["*:<>?|]/g, "")
    // شرطات متتالية تُدمج، وتُقلَّم من الطرفين: اسم مكوَّن من فواصل فقط ليس اسماً
    .replace(/-{2,}/g, "-")
    .replace(/^[-\s.]+|[-\s.]+$/g, "")
    .trim()
    .slice(0, 80);
  const base = cleaned.length > 0 ? cleaned : "تقرير";
  return `${base}.${extension}`;
}

/** الحد الأقصى لعدد الصفوف في تصدير واحد — يمنع التصدير غير المحدود */
export const MAX_EXPORT_ROWS = 5000;

/**
 * العتبة التي يُعد التقرير بعدها «كبيراً» فيُحذَّر المستخدم قبل التوليد (v2.5.0 §15).
 *
 * ليست حداً ولا منعاً: التقرير يُولَّد كاملاً. الغرض أن يعرف المدير قبل الضغط أن ملف
 * PDF بمئات الصفحات سيستغرق وقتاً، وأن التصدير يقف عند `MAX_EXPORT_ROWS`.
 */
export const LARGE_REPORT_ROWS = 500;

/** الحد الأقصى لحجم صفحة العرض — يمنع طلب صفحة ضخمة عبر معامل URL */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/** حصر حجم الصفحة ضمن المدى المسموح (قيمة مشوّهة تسقط إلى الافتراضي) */
export function clampPageSize(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

/** رقم صفحة موجب (قيمة مشوّهة تسقط إلى 1) */
export function clampPage(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

import {
  DOC_TYPE_LABELS,
  mergeWithDefaults,
  type TemplateConfig,
  type TemplateDocType,
} from "./schema";
import { columnsFor, resolveColumns, resolveSections, sectionDef } from "./structure";

/**
 * مقارنة نسختي قالب (v2.2 §E5) — **قراءة فقط، لا تعديل ولا استعادة**.
 *
 * وحدة خالصة: تأخذ إعدادين وتعيد قائمة فروق موصوفة بالعربية. لا تلمس قاعدة البيانات،
 * ولا تُنتج أي إجراء — النسخ المنشورة والصادرة تبقى غير قابلة للتغيير كما هي.
 *
 * القيم تُعرض نصاً عادياً في جدول (تُهرَّب عند العرض في React تلقائياً) — لا HTML مبني هنا.
 */

export type DiffGroupKey = "text" | "identity" | "style" | "page" | "signature" | "sections" | "columns";

export type DiffRow = {
  group: DiffGroupKey;
  /** اسم الخاصية بالعربية */
  label: string;
  /** القيمة في النسخة الأقدم */
  before: string;
  /** القيمة في النسخة الأحدث */
  after: string;
};

export const DIFF_GROUP_LABELS: Record<DiffGroupKey, string> = {
  text: "النصوص والعناوين",
  identity: "الجهة والمدرسة",
  style: "الألوان والخطوط",
  page: "إعدادات الصفحة",
  signature: "التوقيع والاعتماد",
  sections: "الأقسام",
  columns: "أعمدة الجدول",
};

const EMPTY = "—";

const TEXT_LABELS: Record<string, string> = {
  titleAr: "العنوان",
  subtitleAr: "العنوان الفرعي",
  introText: "نص المقدمة",
  closingText: "نص الخاتمة",
  fixedText: "النص الثابت",
  headerText: "نص الترويسة",
  footerText: "نص التذييل",
  notes: "الملاحظات",
  watermarkText: "نص العلامة المائية",
};

const IDENTITY_LABELS: Record<string, string> = {
  schoolName: "اسم المدرسة",
  ministryText: "نص الوزارة",
  departmentText: "إدارة التعليم",
  logoFileId: "الشعار",
};

/** خصائص المظهر (ألوان وخطوط) — تُعرض في مجموعة مستقلة عن إعدادات الصفحة */
const STYLE_LABELS: Record<string, string> = {
  primaryColor: "اللون الأساسي",
  textColor: "لون النص",
  fontFamily: "الخط",
  baseFontSize: "حجم الخط",
  titleFontSize: "حجم العنوان",
  lineHeight: "تباعد الأسطر",
  tableHeaderBackground: "خلفية رأس الجدول",
  alternatingRows: "تلوين الصفوف بالتناوب",
};

const PAGE_LABELS: Record<string, string> = {
  textAlign: "المحاذاة",
  pageOrientation: "اتجاه الصفحة",
  marginTop: "هامش أعلى (مم)",
  marginBottom: "هامش أسفل (مم)",
  marginInlineStart: "هامش البداية (مم)",
  marginInlineEnd: "هامش النهاية (مم)",
  borderStyle: "نمط الإطار",
  showPageNumbers: "ترقيم الصفحات",
  showPrintDate: "تاريخ الطباعة",
  docNumberPosition: "موضع رقم الوثيقة",
};

const SIGNATURE_LABELS: Record<string, string> = {
  signatureLabel: "تسمية التوقيع",
  approvalLabel: "تسمية الاعتماد",
  showSignature: "إظهار التوقيع",
  showStamp: "إظهار الاعتماد",
};

const ENUM_LABELS: Record<string, string> = {
  right: "يمين",
  center: "وسط",
  left: "يسار",
  justify: "ضبط",
  portrait: "طولي",
  landscape: "عرضي",
  solid: "متصل",
  dashed: "متقطع",
  none: "بلا إطار",
  "header-start": "الترويسة — البداية",
  "header-end": "الترويسة — النهاية",
  "footer-start": "التذييل — البداية",
  "footer-end": "التذييل — النهاية",
  hidden: "مخفي",
};

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  const text = String(value);
  return ENUM_LABELS[text] ?? text;
}

function compareGroup(
  group: DiffGroupKey,
  labels: Record<string, string>,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const b = display(before?.[key]);
    const a = display(after?.[key]);
    if (b !== a) rows.push({ group, label, before: b, after: a });
  }
  return rows;
}

/**
 * فروق الأقسام: الظهور والترتيب والعنوان.
 * الترتيب يُقارن بالموضع الفعلي بعد الدمج مع السجل المغلق — لا برقم `order` الخام،
 * فالقسم الذي لم يتحرّك لا يظهر كتغيير لمجرد اختلاف ترقيم داخلي.
 */
function compareSections(before: TemplateConfig, after: TemplateConfig): DiffRow[] {
  const b = resolveSections(before.sections);
  const a = resolveSections(after.sections);
  const rows: DiffRow[] = [];
  const bIndex = new Map(b.map((s, i) => [s.key, i]));
  const aIndex = new Map(a.map((s, i) => [s.key, i]));
  const bByKey = new Map(b.map((s) => [s.key, s]));
  const aByKey = new Map(a.map((s) => [s.key, s]));

  for (const key of new Set([...bIndex.keys(), ...aIndex.keys()])) {
    const name = sectionDef(key)?.label ?? key;
    const bs = bByKey.get(key);
    const as = aByKey.get(key);
    if (bs && as && bs.visible !== as.visible) {
      rows.push({ group: "sections", label: `${name} — الظهور`, before: bs.visible ? "ظاهر" : "مخفي", after: as.visible ? "ظاهر" : "مخفي" });
    }
    if (bs && as && (bs.label ?? "") !== (as.label ?? "")) {
      rows.push({ group: "sections", label: `${name} — العنوان`, before: display(bs.label), after: display(as.label) });
    }
    const bi = bIndex.get(key);
    const ai = aIndex.get(key);
    if (bi !== undefined && ai !== undefined && bi !== ai) {
      rows.push({ group: "sections", label: `${name} — الترتيب`, before: String(bi + 1), after: String(ai + 1) });
    }
  }
  return rows;
}

/** فروق الأعمدة: التسمية والظهور والترتيب والعرض */
function compareColumns(docType: TemplateDocType, before: TemplateConfig, after: TemplateConfig): DiffRow[] {
  if (columnsFor(docType).length === 0) return [];
  const b = resolveColumns(docType, before.columns);
  const a = resolveColumns(docType, after.columns);
  const rows: DiffRow[] = [];
  const bIndex = new Map(b.map((c, i) => [c.key, i]));
  const aIndex = new Map(a.map((c, i) => [c.key, i]));
  const bByKey = new Map(b.map((c) => [c.key, c]));
  const aByKey = new Map(a.map((c) => [c.key, c]));

  for (const def of columnsFor(docType)) {
    const bc = bByKey.get(def.key);
    const ac = aByKey.get(def.key);
    if (!bc || !ac) continue;
    if (bc.label !== ac.label) {
      rows.push({ group: "columns", label: `${def.label} — التسمية`, before: display(bc.label), after: display(ac.label) });
    }
    if (bc.visible !== ac.visible) {
      rows.push({ group: "columns", label: `${def.label} — الظهور`, before: bc.visible ? "ظاهر" : "مخفي", after: ac.visible ? "ظاهر" : "مخفي" });
    }
    if (bc.width !== ac.width) {
      rows.push({
        group: "columns",
        label: `${def.label} — العرض`,
        before: bc.width === null ? "تلقائي" : `${bc.width}٪`,
        after: ac.width === null ? "تلقائي" : `${ac.width}٪`,
      });
    }
    const bi = bIndex.get(def.key);
    const ai = aIndex.get(def.key);
    if (bi !== undefined && ai !== undefined && bi !== ai) {
      rows.push({ group: "columns", label: `${def.label} — الترتيب`, before: String(bi + 1), after: String(ai + 1) });
    }
  }
  return rows;
}

/**
 * مقارنة إعدادَي قالب — تعيد كل الفروق مجمَّعة، وقائمة فارغة إن تطابقا.
 * تُقارن القيم **بعد الدمج مع الافتراضي**، فالفرق المعروض هو ما سيظهر في الوثيقة فعلاً
 * لا ما كُتب في الحقل.
 */
export function diffTemplateConfigs(
  docType: TemplateDocType,
  beforeConfig: TemplateConfig,
  afterConfig: TemplateConfig,
): DiffRow[] {
  const before = mergeWithDefaults(beforeConfig);
  const after = mergeWithDefaults(afterConfig);
  return [
    ...compareGroup("text", TEXT_LABELS, before.text, after.text),
    ...compareGroup("identity", IDENTITY_LABELS, before.identity, after.identity),
    ...compareGroup("style", STYLE_LABELS, before.style, after.style),
    ...compareGroup("page", PAGE_LABELS, before.style, after.style),
    ...compareGroup("signature", SIGNATURE_LABELS, before.signature, after.signature),
    ...compareSections(beforeConfig, afterConfig),
    ...compareColumns(docType, beforeConfig, afterConfig),
  ];
}

/** فروق مجمَّعة بترتيب ثابت للعرض */
export function groupDiff(rows: DiffRow[]): { key: DiffGroupKey; label: string; rows: DiffRow[] }[] {
  const order: DiffGroupKey[] = ["text", "identity", "style", "page", "signature", "sections", "columns"];
  return order
    .map((key) => ({ key, label: DIFF_GROUP_LABELS[key], rows: rows.filter((r) => r.group === key) }))
    .filter((g) => g.rows.length > 0);
}

/** عنوان مقروء لنسخة في قائمة المقارنة */
export function versionLabel(v: { versionNumber: number; status: string }, docType: TemplateDocType): string {
  return `${DOC_TYPE_LABELS[docType]} — نسخة ${v.versionNumber} (${v.status})`;
}

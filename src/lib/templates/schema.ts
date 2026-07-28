import { z } from "zod";

/**
 * نموذج إعداد القوالب (v2.2 §E2/§E6) — **نموذج إعداد مُقيَّد بقائمة بيضاء، لا لغة قوالب.**
 *
 * القرار المعماري الأهم في المرحلة E: المدير لا يكتب HTML ولا CSS ولا أي صيغة تنفيذية
 * إطلاقاً. يختار قيماً من مجموعات مغلقة (خط، محاذاة، اتجاه صفحة، لون من لوحة معرَّفة) ويكتب
 * نصوصاً عربية عادية. المحرّك هو من يبني HTML من هذه القيم.
 *
 * لماذا: أي نموذج يقبل HTML أو CSS حراً من المستخدم يفتح باب حقن النصوص البرمجية وحقن
 * قوالب الخادم وتحميل موارد خارجية. القائمة البيضاء تجعل ذلك مستحيلاً بالبناء لا بالترشيح:
 * ما ليس في القائمة لا يوجد له تمثيل أصلاً.
 *
 * وحدة خالصة (Zod فقط) — تُختبر وحدوياً وتُستعمل على الخادم والعميل.
 */

/* ─────────────────────────── القوائم المغلقة ─────────────────────────── */

/** أنواع الوثائق والتقارير التي تُدار قوالبها (§E7) */
export const TEMPLATE_DOC_TYPES = [
  "program_report",
  "program_closure",
  "financial_report",
  "income_expense_report",
  "committee_assignment",
  "committee_minutes",
  "council_minutes",
  "employee_performance_report",
  "final_evaluation_report",
  "evidence_report",
  "building_report",
  "risk_report",
  "external_evaluation_report",
  "official_letter",
] as const;
export type TemplateDocType = (typeof TEMPLATE_DOC_TYPES)[number];

/** التسمية العربية لكل نوع — تُعرض في «إدارة القوالب» */
export const DOC_TYPE_LABELS: Record<TemplateDocType, string> = {
  program_report: "تقرير برنامج",
  program_closure: "وثيقة إقفال برنامج",
  financial_report: "تقرير مالي",
  income_expense_report: "تقرير الإيرادات والمصروفات",
  committee_assignment: "نموذج توزيع مهام لجنة",
  committee_minutes: "محضر اجتماع لجنة",
  council_minutes: "محضر اجتماع مجلس",
  employee_performance_report: "تقرير أداء موظف",
  final_evaluation_report: "تقرير التقييم النهائي",
  evidence_report: "تقرير الشواهد",
  building_report: "تقرير المبنى والمرافق",
  risk_report: "تقرير المخاطر",
  external_evaluation_report: "تقرير التقييم الخارجي",
  official_letter: "خطاب رسمي عام",
};

/** لوحة الألوان المسموحة — لا يُقبل أي نص لون حر (يمنع حقن CSS) */
export const TEMPLATE_COLORS = [
  "#1f5244", "#348066", "#1a1a1a", "#555555", "#8a6d00",
  "#7a1f1f", "#1f3f7a", "#4a4a4a", "#000000",
] as const;

/** عائلات الخطوط المتاحة محلياً — لا خطوط بعيدة ولا @import */
export const TEMPLATE_FONTS = ["IBM Plex Sans Arabic", "Noto Naskh Arabic", "Amiri"] as const;

export const TEXT_ALIGNMENTS = ["right", "center", "left", "justify"] as const;
export const PAGE_ORIENTATIONS = ["portrait", "landscape"] as const;
export const BORDER_STYLES = ["solid", "dashed", "none"] as const;
export const DOC_NUMBER_POSITIONS = ["header-start", "header-end", "footer-start", "footer-end", "hidden"] as const;

/** حدود عددية — تمنع قيماً تُفسد الصفحة أو تُستعمل لاستنزاف المُصيِّر */
const FONT_SIZE = z.number().int().min(8).max(24);
const MARGIN_MM = z.number().int().min(0).max(50);
const LINE_HEIGHT = z.number().min(1).max(3);
const COLUMN_WIDTH = z.number().int().min(5).max(100);

/* ─────────────────────────── مخطط الإعداد ─────────────────────────── */

/**
 * النصوص القابلة للتحرير (§E2). كلها اختيارية (القاعدة العامة §8) ومحدودة الطول.
 * تُهرَّب كاملةً عند التصيير — لا يُسمح بوسم HTML داخلها.
 */
const textBlockSchema = z.object({
  titleAr: z.string().max(200).optional(),
  subtitleAr: z.string().max(300).optional(),
  introText: z.string().max(3000).optional(),
  closingText: z.string().max(3000).optional(),
  fixedText: z.string().max(3000).optional(),
  headerText: z.string().max(500).optional(),
  footerText: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  watermarkText: z.string().max(80).optional(),
});

/** هوية المدرسة والجهة على مستوى القالب */
const identitySchema = z.object({
  schoolName: z.string().max(200).optional(),
  ministryText: z.string().max(300).optional(),
  departmentText: z.string().max(300).optional(),
  officeText: z.string().max(300).optional(),
  /** معرّف ملف مخزَّن داخلياً — ليس عنواناً خارجياً (يمنع تحميل مورد بعيد) */
  logoFileId: z.string().uuid().nullable().optional(),
});

/** الأنماط — كلها من قوائم مغلقة أو أعداد محدودة المدى */
const styleSchema = z.object({
  primaryColor: z.enum(TEMPLATE_COLORS).optional(),
  textColor: z.enum(TEMPLATE_COLORS).optional(),
  fontFamily: z.enum(TEMPLATE_FONTS).optional(),
  baseFontSize: FONT_SIZE.optional(),
  titleFontSize: FONT_SIZE.optional(),
  textAlign: z.enum(TEXT_ALIGNMENTS).optional(),
  lineHeight: LINE_HEIGHT.optional(),
  pageOrientation: z.enum(PAGE_ORIENTATIONS).optional(),
  marginTop: MARGIN_MM.optional(),
  marginBottom: MARGIN_MM.optional(),
  marginInlineStart: MARGIN_MM.optional(),
  marginInlineEnd: MARGIN_MM.optional(),
  borderStyle: z.enum(BORDER_STYLES).optional(),
  tableHeaderBackground: z.enum(TEMPLATE_COLORS).optional(),
  alternatingRows: z.boolean().optional(),
  showPageNumbers: z.boolean().optional(),
  showPrintDate: z.boolean().optional(),
  docNumberPosition: z.enum(DOC_NUMBER_POSITIONS).optional(),
});

/** عمود جدول: التسمية والترتيب والظهور والعرض */
const columnSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().max(120).optional(),
  visible: z.boolean().optional(),
  width: COLUMN_WIDTH.optional(),
  order: z.number().int().min(0).max(200).optional(),
});

/** قسم في الوثيقة: الترتيب والظهور */
const sectionSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().max(120).optional(),
  visible: z.boolean().optional(),
  order: z.number().int().min(0).max(100).optional(),
});

/** تسميات التوقيع والاعتماد */
const signatureSchema = z.object({
  signatureLabel: z.string().max(120).optional(),
  approvalLabel: z.string().max(120).optional(),
  showSignature: z.boolean().optional(),
  showStamp: z.boolean().optional(),
});

/**
 * إعداد قالب كامل. `strict()` مقصود: أي مفتاح غير معروف يُرفض بدل أن يُتجاهل صامتاً —
 * فلا يمرّ إعداد مستورد يحمل حقولاً غريبة (§E6).
 */
export const templateConfigSchema = z
  .object({
    text: textBlockSchema.strict().optional(),
    identity: identitySchema.strict().optional(),
    style: styleSchema.strict().optional(),
    columns: z.array(columnSchema.strict()).max(60).optional(),
    sections: z.array(sectionSchema.strict()).max(40).optional(),
    signature: signatureSchema.strict().optional(),
  })
  .strict();

export type TemplateConfig = z.infer<typeof templateConfigSchema>;

/** الإعداد الافتراضي — يطابق مظهر الوثائق الحالي فلا يتغيّر شكل المُصدَر بلا قرار */
export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  style: {
    primaryColor: "#1f5244",
    textColor: "#1a1a1a",
    fontFamily: "IBM Plex Sans Arabic",
    baseFontSize: 12,
    titleFontSize: 16,
    textAlign: "right",
    lineHeight: 1.7,
    pageOrientation: "portrait",
    marginTop: 15,
    marginBottom: 15,
    marginInlineStart: 12,
    marginInlineEnd: 12,
    borderStyle: "solid",
    tableHeaderBackground: "#1a1a1a",
    alternatingRows: false,
    showPageNumbers: false,
    showPrintDate: true,
    docNumberPosition: "header-end",
  },
  signature: {
    signatureLabel: "مدير المجمع",
    approvalLabel: "المعتمد",
    showSignature: false,
    showStamp: false,
  },
};

/**
 * التحقق من إعداد قالب مستورد أو مُدخَل (§E6).
 *
 * يرفض: المفاتيح غير المعروفة، القيم خارج القوائم المغلقة، الأعداد خارج المدى، والنصوص
 * التي تحوي وسم HTML أو مخطط `javascript:` أو معالج حدث. الرسائل عربية.
 */
export function parseTemplateConfig(input: unknown): { ok: true; config: TemplateConfig } | { ok: false; error: string } {
  const parsed = templateConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    return { ok: false, error: `إعداد القالب غير صالح${path ? ` عند «${path}»` : ""} — ${arabicIssue(issue.code)}` };
  }
  const unsafe = findUnsafeText(parsed.data);
  if (unsafe) return { ok: false, error: `نص غير آمن في «${unsafe}» — لا يُسمح بوسوم HTML أو نصوص برمجية داخل القالب` };
  return { ok: true, config: parsed.data };
}

function arabicIssue(code: string): string {
  switch (code) {
    case "unrecognized_keys":
      return "يحتوي حقلاً غير معروف";
    case "invalid_value":
    case "invalid_enum_value":
      return "قيمة خارج القائمة المسموحة";
    case "too_big":
      return "قيمة أكبر من الحد المسموح";
    case "too_small":
      return "قيمة أصغر من الحد المسموح";
    case "invalid_type":
      return "نوع القيمة غير صحيح";
    default:
      return "قيمة غير مقبولة";
  }
}

/**
 * فحص كل النصوص الحرة بحثاً عن وسم HTML أو محتوى تنفيذي.
 *
 * هذا حارس **إضافي** عند حدود الإدخال؛ التصيير يُهرِّب كل شيء على أي حال. وجود الحارسين
 * معاً يعني أن نصاً خبيثاً يُرفض عند الحفظ ولا يُصيَّر حياً حتى لو مرّ بطريقة ما.
 */
function findUnsafeText(config: TemplateConfig): string | null {
  const DANGEROUS = /<[^>]*>|javascript:|data:text\/html|on\w+\s*=|expression\s*\(|@import|<!--/i;
  const check = (label: string, value: unknown): string | null => {
    if (typeof value !== "string") return null;
    return DANGEROUS.test(value) ? label : null;
  };
  for (const [k, v] of Object.entries(config.text ?? {})) {
    const hit = check(k, v);
    if (hit) return hit;
  }
  for (const [k, v] of Object.entries(config.identity ?? {})) {
    const hit = check(k, v);
    if (hit) return hit;
  }
  for (const [k, v] of Object.entries(config.signature ?? {})) {
    const hit = check(k, v);
    if (hit) return hit;
  }
  for (const c of config.columns ?? []) {
    const hit = check(`columns.${c.key}`, c.label);
    if (hit) return hit;
  }
  for (const s of config.sections ?? []) {
    const hit = check(`sections.${s.key}`, s.label);
    if (hit) return hit;
  }
  return null;
}

/** دمج إعداد فوق الافتراضي — الحقل غير المُدخَل يرث القيمة الافتراضية */
export function mergeWithDefaults(config: TemplateConfig): TemplateConfig {
  return {
    text: { ...(DEFAULT_TEMPLATE_CONFIG.text ?? {}), ...(config.text ?? {}) },
    identity: { ...(DEFAULT_TEMPLATE_CONFIG.identity ?? {}), ...(config.identity ?? {}) },
    style: { ...(DEFAULT_TEMPLATE_CONFIG.style ?? {}), ...(config.style ?? {}) },
    signature: { ...(DEFAULT_TEMPLATE_CONFIG.signature ?? {}), ...(config.signature ?? {}) },
    columns: config.columns ?? DEFAULT_TEMPLATE_CONFIG.columns,
    sections: config.sections ?? DEFAULT_TEMPLATE_CONFIG.sections,
  };
}

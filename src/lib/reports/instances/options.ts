/**
 * خيارات التقرير المحفوظ ولقطته المجمّدة (v2.6 — D-055/D-060). وحدة خالصة.
 *
 * `InstanceOptions` وصفة المسودة: ما اختاره المدير في المنشئ. تُخزَّن jsonb وتُطهَّر
 * بالمخطط الصارم عند **كل قراءة** — الصفّ المخزَّن ليس مصدر ثقة (سياسة v2.5.0).
 *
 * `SnapshotDoc` اللقطة النهائية: وثيقة واحدة مكتفية بذاتها تُكتب مرة واحدة داخل معاملة
 * الاعتماد، ومنها يُصيَّر كل شيء — المعاينة والطباعة وPDF وWord وExcel — فلا يمكن أن
 * تختلف المعاينة عن المُصدَّر إلا اختلاف تصيير لا اختلاف بيانات.
 */

import { z } from "zod";

/** تجاوزات الهوية المسموحة لكل تقرير (§E) — لا تغيّر الإعدادات المركزية أبداً */
export const identityOverridesSchema = z
  .object({
    schoolName: z.string().max(200).optional(),
    principalName: z.string().max(120).optional(),
    principalTitle: z.string().max(120).optional(),
    academicYear: z.string().max(60).optional(),
    headerNote: z.string().max(300).optional(),
    footerNote: z.string().max(300).optional(),
    /** بيانات الاتصال لهذا التقرير وحده — المركزية في هوية الوثائق (§E) */
    contactInfo: z.string().max(300).optional(),
  })
  .strict();

export type IdentityOverrides = z.infer<typeof identityOverridesSchema>;

export const instanceOptionsSchema = z
  .object({
    /** النوع المفرد: مفتاح التقرير المختار من السجل */
    reportKey: z.string().max(80).optional(),
    /** ترتيب الأقسام بمفاتيحها — ما غاب يلحق بالترتيب الافتراضي (§A) */
    sectionOrder: z.array(z.string().max(40)).max(30).optional(),
    /** الأقسام المخفية عمداً */
    hiddenSections: z.array(z.string().max(40)).max(30).optional(),
    /** إظهار الحقول والأقسام الفارغة بدل إخفائها التلقائي (§A) */
    showEmpty: z.boolean().optional(),
    /** مرشّحات إضافية لكل قسم فوق مرشّحات التقرير العامة — بشكل `StoredFilters` */
    sectionFilters: z.record(z.string(), z.record(z.string(), z.array(z.string().max(200)).max(200))).optional(),
    /** مفتاح القالب: أساسي أو معرّف نسخة مخصصة (D-058) */
    templateKey: z.string().max(80).optional(),
    /** تجاوزات هوية هذا التقرير وحده */
    identityOverrides: identityOverridesSchema.optional(),
    /** تضمين قائمة الشواهد والمرفقات المستعملة في ذيل التقرير (§F) */
    attachmentsList: z.boolean().optional(),
    /**
     * صيغ الإخراج المختارة (§A/§G) — يحترمها التوليد التلقائي بعد الاعتماد.
     * الفراغ يعني الثلاث كلها، كدلالة «الفراغ يعني الكل» في إطار المرشّحات.
     */
    outputFormats: z.array(z.enum(["pdf", "docx", "xlsx"])).max(3).optional(),
  })
  .strict();

export type InstanceOptions = z.infer<typeof instanceOptionsSchema>;

/**
 * تطهير خيارات مخزَّنة — الإنقاذ **لكل مفتاح على حدة**: المفتاح المجهول والقيمة من نوع
 * خاطئ يسقطان وحدهما ويبقى الصالح، فصفّ معطوب جزئياً لا يعطّل عرض التقرير كله.
 */
export function parseInstanceOptions(stored: unknown): InstanceOptions {
  if (!stored || typeof stored !== "object") return {};
  const parsed = instanceOptionsSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  const out: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(instanceOptionsSchema.shape)) {
    const value = (stored as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const field = (fieldSchema as z.ZodType).safeParse(value);
    if (field.success) out[key] = field.data;
  }
  return out as InstanceOptions;
}

/* ─────────────────────────── اللقطة المجمّدة ─────────────────────────── */

export type SnapshotColumn = { key: string; label: string; type?: string };

export type SnapshotSection = {
  key: string;
  reportKey: string;
  label: string;
  columns: SnapshotColumn[];
  rows: Record<string, string | number | null>[];
  total: number;
  truncated: boolean;
  /** وصف مرشّحات القسم الفعّالة بالعربية — أزواج «التسمية: القيمة» */
  filterLines: [string, string][];
  /** القسم فارغ — يُحفظ ليُقال في التقرير عند «إظهار الفارغ» بدل أن يختفي بصمت */
  empty: boolean;
};

export type SnapshotIdentity = {
  orgLines: string[];
  schoolName: string;
  principalName: string;
  principalTitle: string;
  academicYear: string;
  headerNote: string;
  footerNote: string;
  /** بيانات الاتصال المركزية أو المتجاوزة لهذا التقرير (§E) — قد تكون فارغة */
  contactInfo?: string;
  /** معرّفا ملفّي الشعارين وقت الاعتماد — الملفات المخزَّنة لا تُعاد كتابتها */
  ministryLogoFileId: string | null;
  schoolLogoFileId: string | null;
};

export type SnapshotAttachment = {
  fileId: string;
  name: string;
  /** مصدر المرفق: «شاهد» أو «مرفق تقرير» */
  source: string;
};

export type SnapshotDoc = {
  version: 1;
  typeKey: string;
  typeLabel: string;
  title: string;
  periodFrom: string | null;
  periodTo: string | null;
  /** نص الفترة للعرض — مزدوج التقويم */
  periodText: string | null;
  generatedAtIso: string;
  generatedAtText: string;
  sections: SnapshotSection[];
  identity: SnapshotIdentity;
  /** إعداد القالب محلولاً ومجمّداً (D-058) */
  style: Record<string, unknown>;
  templateKey: string;
  showEmpty: boolean;
  attachments: SnapshotAttachment[];
  stats: { sectionCount: number; totalRows: number };
};

/**
 * قراءة لقطة مخزَّنة. لا تطهير عميق هنا عمداً: اللقطة كتبتها معاملة الاعتماد وحدها
 * والقادح يمنع تعديلها — لكن الشكل يُفحص كي لا يسقط العرض على لقطة من إصدار أقدم.
 */
export function readSnapshot(stored: unknown): SnapshotDoc | null {
  if (!stored || typeof stored !== "object") return null;
  const doc = stored as SnapshotDoc;
  if (doc.version !== 1 || !Array.isArray(doc.sections) || typeof doc.title !== "string") return null;
  return doc;
}

/**
 * اسم الملف المولَّد (§G): «الاسم الكامل للتقرير - تاريخ إنشاء التقرير».
 * التاريخ ميلادي ISO لثبات الفرز في مجلد التنزيلات؛ الاسم يمر بمُطهِّر أسماء الملفات
 * عند الإخراج الفعلي.
 */
export function instanceFileBase(title: string, generatedAtIso: string): string {
  return `${title.trim() || "تقرير"} - ${generatedAtIso.slice(0, 10)}`;
}

/**
 * القوالب الأساسية الخمسة للتقارير المحفوظة (v2.6 §E — D-058).
 *
 * سجلّ نقي في الشيفرة: القوالب الأساسية ليست صفوفاً فلا تُحذف ولا تُعدَّل تدميرياً
 * بالبناء. النسخة المخصصة صفّ في `report_style_templates` يحمل مفتاح أصله وفرقاً
 * مُقيَّداً بالمخطط الصارم أدناه — **ليس** مصمم قوالب حراً.
 *
 * الألوان هادئة رسمية تُقرأ بتدرّج الرمادي (§F): التمييز بالبنية والكثافة لا باللون
 * وحده، والافتراضي هو أخضر المنصة المعتمد في `officialPageHtml` نفسه.
 */

import { z } from "zod";

export type StyleConfig = {
  /** لون العناوين والحدود الرئيسة */
  primaryColor: string;
  /** لون التمييز الثانوي (حدود العناوين الفرعية وخلفيات الترويسات) */
  accentColor: string;
  /** إظهار الهوية الرسمية (الترويسة والشعارات) — «بلا هوية» يطفئها كلها */
  showIdentity: boolean;
  /** إظهار الشعارات تحديداً حين تكون الهوية ظاهرة */
  showLogos: boolean;
  /** الغلاف: تلقائي (يظهر للتقارير الطويلة فقط) أو دائماً أو أبداً (§F) */
  cover: "تلقائي" | "نعم" | "لا";
  /** فهرس المحتويات: بالمنطق نفسه */
  toc: "تلقائي" | "نعم" | "لا";
  /** إظهار مربع الاعتماد والتوقيع في ذيل التقرير */
  approvalBox: boolean;
  /** نص ترويسة إضافي قابل للتحرير (§E) */
  headerText: string;
  /** نص تذييل قابل للتحرير */
  footerText: string;
  /** كثافة الجدول: مضغوط للتحليلي المفصّل، مريح للتنفيذي */
  density: "عادي" | "مضغوط";
};

/** لون CSS مسموح: hex فقط — لا `url()` ولا تعبيرات، فلا حقن عبر خانة لون */
const cssColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "اللون بصيغة hex فقط");

export const styleConfigSchema = z
  .object({
    primaryColor: cssColor,
    accentColor: cssColor,
    showIdentity: z.boolean(),
    showLogos: z.boolean(),
    cover: z.enum(["تلقائي", "نعم", "لا"]),
    toc: z.enum(["تلقائي", "نعم", "لا"]),
    approvalBox: z.boolean(),
    headerText: z.string().max(300),
    footerText: z.string().max(300),
    density: z.enum(["عادي", "مضغوط"]),
  })
  .strict();

export type BaseTemplate = {
  key: string;
  labelAr: string;
  description: string;
  config: StyleConfig;
};

export const BASE_TEMPLATES: readonly BaseTemplate[] = [
  {
    key: "official",
    labelAr: "تقرير رسمي إلى إدارة التعليم",
    description: "الهوية الكاملة بالشعارات، غلاف وفهرس للتقارير الطويلة، ومربع اعتماد — للرفع الرسمي",
    config: {
      primaryColor: "#1f5244",
      accentColor: "#348066",
      showIdentity: true,
      showLogos: true,
      cover: "تلقائي",
      toc: "تلقائي",
      approvalBox: true,
      headerText: "",
      footerText: "",
      density: "عادي",
    },
  },
  {
    key: "internal",
    labelAr: "تقرير إداري داخلي",
    description: "هوية مختصرة بلا غلاف — للتداول داخل المدرسة",
    config: {
      primaryColor: "#1f5244",
      accentColor: "#348066",
      showIdentity: true,
      showLogos: false,
      cover: "لا",
      toc: "تلقائي",
      approvalBox: false,
      headerText: "",
      footerText: "",
      density: "عادي",
    },
  },
  {
    key: "executive",
    labelAr: "ملخص تنفيذي موجز",
    description: "أرقام جامعة بكثافة مريحة وهوية مختصرة — لقراءة سريعة",
    config: {
      primaryColor: "#1f5244",
      accentColor: "#348066",
      showIdentity: true,
      showLogos: false,
      cover: "لا",
      toc: "لا",
      approvalBox: false,
      headerText: "",
      footerText: "",
      density: "عادي",
    },
  },
  {
    key: "analytical",
    labelAr: "تقرير تحليلي مفصّل",
    description: "جداول مضغوطة وفهرس دائم — لأكبر قدر من التفصيل في أقل ورق",
    config: {
      primaryColor: "#1f5244",
      accentColor: "#348066",
      showIdentity: true,
      showLogos: false,
      cover: "تلقائي",
      toc: "نعم",
      approvalBox: false,
      headerText: "",
      footerText: "",
      density: "مضغوط",
    },
  },
  {
    key: "plain",
    labelAr: "طباعة أولية بلا هوية",
    description: "المحتوى وحده بلا ترويسة ولا شعارات ولا اعتماد — للمراجعة قبل الإخراج الرسمي",
    config: {
      primaryColor: "#333333",
      accentColor: "#666666",
      showIdentity: false,
      showLogos: false,
      cover: "لا",
      toc: "لا",
      approvalBox: false,
      headerText: "",
      footerText: "",
      density: "عادي",
    },
  },
] as const;

export function baseTemplateByKey(key: string): BaseTemplate | undefined {
  return BASE_TEMPLATES.find((t) => t.key === key);
}

export function isBaseTemplateKey(key: string): boolean {
  return baseTemplateByKey(key) !== undefined;
}

/**
 * حلّ إعداد القالب النهائي: أساس معلوم + فرق مخصص مُطهَّر. الفرق الملفَّق — مفتاح غريب
 * أو لون ليس hex — يسقط كله ويبقى الأساس، فالصفّ المخزَّن ليس مصدر ثقة (سياسة v2.5.0).
 */
export function resolveStyleConfig(baseKey: string, customPatch?: unknown): StyleConfig {
  const base = baseTemplateByKey(baseKey) ?? BASE_TEMPLATES[0];
  if (!customPatch || typeof customPatch !== "object") return { ...base.config };
  const merged = { ...base.config, ...(customPatch as Record<string, unknown>) };
  const parsed = styleConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...base.config };
}

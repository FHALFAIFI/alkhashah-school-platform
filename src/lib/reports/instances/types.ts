/**
 * سجل أنواع التقارير المحفوظة (v2.6 §A/§C — D-056).
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات، على نمط `../catalog` تماماً. النوع المركّب قائمة
 * **أقسام مرتّبة، كل قسم مربوط بتقرير من السجل الواحد** — فكل ما يضمنه السجل أصلاً
 * (الصلاحية لكل تقرير، القوائم البيضاء للأعمدة والترتيب، عزل المرشّحات، الحساسية) يسري
 * على كل قسم بالبناء، ولا يوجد محرّك تقارير ثانٍ. التقرير المفرد حالة خاصة: قسم واحد.
 */

import { REPORTS, reportByKey, type ReportDefinition } from "../catalog";

/** حالات دورة حياة التقرير المحفوظ (§A) */
export const INSTANCE_STATUSES = ["مسودة", "نهائي", "مؤرشف"] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const INSTANCE_DRAFT: InstanceStatus = "مسودة";
export const INSTANCE_FINAL: InstanceStatus = "نهائي";
export const INSTANCE_ARCHIVED: InstanceStatus = "مؤرشف";

export function isInstanceStatus(value: string): value is InstanceStatus {
  return (INSTANCE_STATUSES as readonly string[]).includes(value);
}

/** قسم في نوع مركّب — مربوط بتقرير معلَن في السجل */
export type InstanceSectionDef = {
  /** مفتاح القسم داخل النوع — ثابت حتى لو أُعيد ترتيب الأقسام */
  key: string;
  /** مفتاح التقرير في `../catalog` */
  reportKey: string;
  /** تسمية القسم إن خالفت تسمية التقرير */
  labelAr?: string;
};

export type InstanceTypeDef = {
  key: string;
  labelAr: string;
  description: string;
  /**
   * أقسام النوع المركّب بترتيبها الافتراضي. النوع المفرد (`single`) يتركها فارغة
   * ويأخذ تقريره من خيارات التقرير المحفوظ (`options.reportKey`).
   */
  sections: readonly InstanceSectionDef[];
  /** مفتاح القالب الأساسي الافتراضي (D-058) — قابل للتجاوز من إعداد ومن كل تقرير */
  defaultTemplateKey: string;
};

/**
 * الأنواع المعتمدة. كل قسم يقرأ بيانات موجودة فعلاً في المنصة — لا قسم يُفبرك بيانات
 * (سابقة الحضور في v2.5.0: ما ليس في نموذج البيانات يُقال لا يُختلق).
 */
export const INSTANCE_TYPES: readonly InstanceTypeDef[] = [
  {
    key: "single",
    labelAr: "تقرير مجال واحد",
    description: "تقرير واحد من سجل التقارير بمرشّحاته وأعمدته — أي تقرير من مركز التقارير يصلح أصلاً له",
    sections: [],
    defaultTemplateKey: "internal",
  },
  {
    key: "periodic",
    labelAr: "التقرير الدوري",
    description: "صورة دورية شاملة: البرامج بحسب المجال، والمتابعة الأسبوعية، والشواهد، والصيانة، والمخصصات، وملخص اللجان",
    sections: [
      { key: "programs", reportKey: "programs-by-domain", labelAr: "البرامج التشغيلية بحسب المجال" },
      { key: "followup", reportKey: "plan-followups", labelAr: "المتابعة الأسبوعية" },
      { key: "evidence", reportKey: "evidence-by-program", labelAr: "الشواهد بحسب البرنامج" },
      { key: "maintenance", reportKey: "maintenance-register", labelAr: "بلاغات الصيانة" },
      { key: "budget", reportKey: "item-allocations", labelAr: "المخصص والمنفَق والمتبقي" },
      { key: "committees", reportKey: "committee-summary", labelAr: "ملخص المجالس واللجان" },
    ],
    defaultTemplateKey: "official",
  },
  {
    key: "final-term",
    labelAr: "التقرير الختامي",
    description: "حصيلة الفترة كاملة: البرامج ومكتملها، وتوزيع نتائج الأداء، واللجان، والمالية باتجاهها الشهري، والصيانة",
    sections: [
      { key: "programs", reportKey: "programs-by-domain", labelAr: "البرامج التشغيلية بحسب المجال" },
      { key: "completed", reportKey: "programs-completed", labelAr: "البرامج المكتملة" },
      { key: "perf", reportKey: "perf-distribution", labelAr: "توزيع نتائج الأداء" },
      { key: "committees", reportKey: "committee-summary", labelAr: "ملخص المجالس واللجان" },
      { key: "budget", reportKey: "item-allocations", labelAr: "المخصص والمنفَق والمتبقي" },
      { key: "trend", reportKey: "monthly-trend", labelAr: "الاتجاه الشهري للإيراد والمصروف" },
      { key: "maintenance", reportKey: "maintenance-register", labelAr: "بلاغات الصيانة" },
    ],
    defaultTemplateKey: "official",
  },
  {
    key: "executive",
    labelAr: "الملخص التنفيذي",
    description: "الأرقام الجامعة بلا تفصيل: ملخص البرامج بحسب المجال، وتوزيع الأداء، وملخص اللجان، والمخصصات والتجاوزات",
    sections: [
      { key: "programs", reportKey: "programs-by-domain-summary", labelAr: "ملخص البرامج بحسب المجال" },
      { key: "perf", reportKey: "perf-distribution", labelAr: "توزيع نتائج الأداء" },
      { key: "committees", reportKey: "committee-summary", labelAr: "ملخص المجالس واللجان" },
      { key: "budget", reportKey: "item-allocations", labelAr: "المخصص والمنفَق والمتبقي" },
      { key: "overbudget", reportKey: "over-budget", labelAr: "البنود المتجاوزة للمخصص" },
    ],
    defaultTemplateKey: "executive",
  },
] as const;

export function instanceTypeByKey(key: string): InstanceTypeDef | undefined {
  return INSTANCE_TYPES.find((t) => t.key === key);
}

export function isInstanceType(key: string): boolean {
  return instanceTypeByKey(key) !== undefined;
}

/**
 * الأقسام الفعلية لتقرير محفوظ: النوع المفرد يبني قسمه الواحد من `options.reportKey`،
 * والمركّب يعيد أقسام تعريفه. مفتاح تقرير غير معلَن في السجل يُسقَط بصمت (تقرير حُذف من
 * سجل إصدار لاحق) — كسياسة القوالب المحفوظة نفسها.
 */
export function sectionsOf(typeKey: string, options: { reportKey?: string }): InstanceSectionDef[] {
  const def = instanceTypeByKey(typeKey);
  if (!def) return [];
  if (def.key === "single") {
    const reportKey = options.reportKey ?? "";
    return reportByKey(reportKey) ? [{ key: "main", reportKey }] : [];
  }
  return def.sections.filter((s) => reportByKey(s.reportKey) !== undefined);
}

/** تعريف تقرير القسم — للقوائم البيضاء والصلاحيات */
export function sectionReport(section: InstanceSectionDef): ReportDefinition | undefined {
  return reportByKey(section.reportKey);
}

/** الصلاحيات اللازمة لبناء هذا التقرير أو عرضه حياً: صلاحية كل قسم دون استثناء */
export function requiredPermissions(typeKey: string, options: { reportKey?: string }): string[] {
  const perms = new Set<string>();
  for (const s of sectionsOf(typeKey, options)) {
    const def = reportByKey(s.reportKey);
    if (def) perms.add(def.permission);
  }
  return [...perms];
}

/** التقرير حسّاس إن حمل أي قسم بيانات أداء فردية (D-013) */
export function isSensitiveType(typeKey: string, options: { reportKey?: string }): boolean {
  return sectionsOf(typeKey, options).some((s) => reportByKey(s.reportKey)?.sensitive === true);
}

/** التقارير الصالحة نوعاً مفرداً — كل ما في السجل؛ المنشئ يجمّعها بفئاتها */
export function singleReportChoices(): ReportDefinition[] {
  return [...REPORTS];
}

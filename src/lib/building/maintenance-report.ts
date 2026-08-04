/**
 * نصوص وثوابت سير عمل الفحص ← الصيانة (v2.4.1 §1.2).
 *
 * وحدة خالصة: بلا قاعدة بيانات وبلا React، فتُستعمل في الشاشات والإجراءات والتقارير
 * والاختبارات معاً ولا تتفرع الصياغة بين السطوح.
 */

/** المسمّى الظاهر لنقطة الدخول داخل منطقة الصيانة — «المبنى ← الصيانة ← إجراء فحص» */
export const RUN_INSPECTION_CTA = "إجراء فحص";

/** أزرار دورة حياة بلاغ الصيانة كما يقرؤها المدير */
export const CREATE_ISSUE_CTA = "إنشاء بلاغ صيانة";
export const VIEW_ISSUE_CTA = "عرض بلاغ الصيانة";
export const PRINT_REPORT_CTA = "طباعة تقرير الصيانة";
export const DOWNLOAD_PDF_CTA = "تنزيل PDF";
export const APPROVE_AND_ISSUE_CTA = "اعتماد البلاغ وإصدار التقرير";

/** خيارات ما بعد حفظ الفحص — أربعة مسارات صريحة لا مسار واحد مفروض */
export const CREATE_SELECTED_CTA = "إنشاء البلاغات المحددة";
export const CREATE_ALL_SEPARATE_CTA = "إنشاء بلاغ منفصل لكل ملاحظة";
export const REVIEW_BEFORE_CREATE_CTA = "مراجعة قبل الإنشاء";
export const SKIP_FOR_NOW_CTA = "تخطي الآن";

/**
 * نتيجة الفحص المعروضة فور الحفظ.
 * الصياغة العربية تفرّق المفرد والمثنى والجمع — «ملاحظة واحدة» لا «1 ملاحظات».
 */
export function inspectionResultMessage(count: number): string {
  if (count === 0) return "لم تُسجَّل ملاحظات تحتاج إلى صيانة";
  if (count === 1) return "تم تسجيل ملاحظة واحدة تحتاج إلى صيانة";
  if (count === 2) return "تم تسجيل ملاحظتين تحتاجان إلى صيانة";
  return `تم تسجيل ${count} ملاحظات تحتاج إلى صيانة`;
}

/**
 * تصنيفات الصيانة — قائمة مغلقة يختار منها المدير. القيمة اختيارية دائماً
 * (القاعدة العامة §8): البلاغ يُحفظ ويُعتمد ويُطبع بلا تصنيف، ويُعرض «غير محدد».
 */
export const MAINTENANCE_CATEGORIES = [
  "كهرباء",
  "سباكة",
  "تكييف وتبريد",
  "أعمال مدنية وإنشائية",
  "نجارة وأثاث",
  "سلامة ومكافحة حريق",
  "شبكات وحاسب",
  "نظافة وتشغيل",
  "أخرى",
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export function isMaintenanceCategory(value: string): value is MaintenanceCategory {
  return (MAINTENANCE_CATEGORIES as readonly string[]).includes(value);
}

/** نص بديل موحّد للحقل غير المُدخل في تقرير الصيانة */
export const MAINTENANCE_FIELD_UNSET = "غير محدد";

/**
 * أثر السلامة المشتق من ملاحظة الفحص — **إعادة صياغة أمينة لخطورة الملاحظة نفسها**
 * لا تقدير جديد. البند الحرج يمسّ السلامة بحكم تعريفه في قالب الفحص.
 */
export function safetyImpactFromFinding(f: { critical: boolean; severity: string }): string {
  return f.critical
    ? "بند حرج — يمسّ سلامة مستخدمي المبنى ويمنع اعتبار الموقع جاهزاً حتى المعالجة"
    : `درجة خطورة البند في قالب الفحص: ${f.severity}`;
}

/** الإجراء المطلوب الافتراضي في خطاب البلاغ — نص إداري ثابت لا بيانات مُختلقة */
export const DEFAULT_REQUESTED_ACTION = "الكشف والمعالجة وإفادتنا بالنتيجة";

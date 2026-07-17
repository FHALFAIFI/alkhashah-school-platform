/**
 * عرض نتائج التحقق حسب حالة قرار الصف — وحدة نقية تصلح للخادم والعميل والاختبارات.
 *
 * القاعدة: التحذير يبقى «نشطاً» ما دام قرار المدير غير محسوم (يحتاج مراجعة/مؤجل).
 * بعد الحسم (جاهز/مستبعد/منفذ) تختفي التحذيرات النشطة، ويظهر بدل تحذير التصنيف
 * «تمت مراجعة التصنيف»، ويبقى النص الأصلي محفوظاً في بيانات الصف وسجل قراراته.
 * الأخطاء (errors) تُعرض دائماً لأنها سبب قرارات الاستبعاد.
 */

export const CLASSIFICATION_WARNING = "التصنيف (معلم/موظف) غير مؤكد — يحتاج تأكيد المدير";
export const CLASSIFICATION_RESOLVED_NOTE = "تمت مراجعة التصنيف";

/** الحالات التي لم يحسم المدير قراره فيها بعد */
export const UNDECIDED_STATUSES = ["يحتاج مراجعة", "مؤجل"] as const;

export type RowValidation = { errors?: string[]; warnings?: string[] } | null | undefined;

export function rowValidationDisplay(
  status: string,
  validation: RowValidation,
): { errors: string[]; activeWarnings: string[]; resolvedNotes: string[] } {
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  if ((UNDECIDED_STATUSES as readonly string[]).includes(status)) {
    return { errors, activeWarnings: warnings, resolvedNotes: [] };
  }
  return {
    errors,
    activeWarnings: [],
    resolvedNotes: warnings.includes(CLASSIFICATION_WARNING) ? [CLASSIFICATION_RESOLVED_NOTE] : [],
  };
}

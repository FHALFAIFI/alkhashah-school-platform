import { UploadValidationError } from "./storage";

/**
 * رسالة خطأ صالحة للعرض على المستخدم (v2.2 §11.5 / §11.2.7).
 *
 * القاعدة: لا يُعرض نص خطأ إلا إذا كان **مقصوداً للمستخدم** (خطأ تحقق كتبناه بالعربية).
 * أي خطأ آخر — خطأ نظام ملفات، خطأ قاعدة بيانات، خطأ مكتبة — يُستبدل برسالة عامة، لأن
 * نصه قد يحوي مساراً داخلياً أو اسم جدول أو نصاً إنجليزياً خاماً.
 *
 * الخطأ الأصلي لا يُبتلع: المستدعي يسجّله على الخادم حين يلزم.
 */
export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof UploadValidationError) return error.message;
  return fallback;
}

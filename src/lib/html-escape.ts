/**
 * تهريب HTML — **مصدر الحقيقة الوحيد** لكل ما يُحقن في وثيقة مولّدة أو تقرير أو قالب.
 *
 * وحدة خالصة بلا اعتماديات، تُختبر وحدوياً وتُستعمل على الخادم والعميل.
 *
 * لماذا تُهرَّب علامتا الاقتباس أيضاً: الوثائق الرسمية تضع قيماً داخل خصائص عناصر
 * (`src="…"`, `style="…"`)، وتهريب `&<>` وحده يترك الخروج من الخاصية ممكناً بعلامة
 * اقتباس. القاعدة هنا: تهريب واحد صالح لسياق النص وسياق الخاصية معاً.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * تهريب نص لإدراجه في HTML (نصاً كان أو قيمة خاصية).
 *
 * القيم الفارغة (null/undefined) تصير نصاً فارغاً — لا «null» ولا «undefined» في وثيقة رسمية.
 */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

/**
 * تهريب قيمة لإدراجها داخل خاصية `style` — أضيق من تهريب HTML العام.
 *
 * لا يُسمح إلا بمحارف أنماط CSS البسيطة (حروف وأرقام ومسافات و`#%.,()-`). أي محرف آخر
 * يُحذف، فلا تمر `expression()` ولا `url(javascript:…)` ولا إغلاق خاصية ولا تعليق CSS.
 * تُستعمل مع قائمة القيم المسموحة لا بديلاً عنها.
 */
export function sanitizeCssValue(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/[^A-Za-z0-9؀-ۿ #%.,()\-]/g, "")
    .slice(0, 120);
}

/**
 * هل النص خالٍ من أي محاولة وسم HTML؟ يُستعمل كتحقق إدخال (لا كبديل عن التهريب).
 * التهريب يبقى مُطبَّقاً دائماً عند العرض — هذا حارس إضافي عند حدود الإدخال.
 */
export function containsHtmlMarkup(value: string | null | undefined): boolean {
  if (!value) return false;
  return /<[^>]*>|&#|&[a-zA-Z]+;|javascript:|data:text\/html|on\w+\s*=/i.test(String(value));
}

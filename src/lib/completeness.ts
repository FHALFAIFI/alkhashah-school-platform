/**
 * اكتمال البيانات — مؤشّر معلوماتي لا بوابة (v2.5.0 §13).
 *
 * ── القاعدة التي يخدمها ─────────────────────────────────────────────────────
 * سياسة المنصة أن يُحفظ السجل ناقصاً (§12): الحقل الاختياري لا يمنع الحفظ. لكن «اختياري»
 * لا يعني «غير مهم»، والسجل الناقص يظهر ناقصاً في التقارير الرسمية بعد شهور. المؤشّر
 * يسدّ هذه الفجوة: **يقول ما ينقص، ولا يمنع شيئاً**.
 *
 * ── لماذا ليس حالة سير عمل ──────────────────────────────────────────────────
 * التكليف صريح: «لا تستعمل نسبة الاكتمال كحالة سير عمل ما لم تُوسم بوضوح أنها اكتمال
 * نموذج». لذلك التسمية هنا **«اكتمال البيانات»** حصراً، ولا تُخزَّن في القاعدة ولا
 * تدخل تقريراً كحالة، ولا تُقارن بتقدم البرنامج ولا بنتيجة تقييم. تُحسب عند العرض من
 * الحقول الحاضرة وتُنسى.
 *
 * وحدة خالصة: بلا قاعدة بيانات وبلا React.
 */

export type CompletenessField = {
  /** التسمية العربية كما تظهر للمستخدم في النموذج نفسه */
  label: string;
  /** هل للحقل قيمة فعلية؟ الفراغ والمسافات وحدها تُعدّ غياباً */
  filled: boolean;
  /**
   * حقل يؤثر غيابه في التكامل أو التقارير (§12.3) — يُذكر أولاً في قائمة النواقص.
   * مثال: الرقم الوظيفي لموظف؛ غيابه يكسر المطابقة مع نظام فارس.
   */
  affectsIntegration?: boolean;
};

export type Completeness = {
  /** عدد الحقول التي لها قيمة */
  filled: number;
  total: number;
  /** نسبة مئوية مقرَّبة — للعرض فقط */
  percent: number;
  /** أسماء الحقول الناقصة، ما يؤثر منها في التكامل أولاً */
  missing: string[];
  /** الحقول الناقصة التي يؤثر غيابها في التكامل أو التقارير */
  missingCritical: string[];
};

export function computeCompleteness(fields: CompletenessField[]): Completeness {
  const total = fields.length;
  const filled = fields.filter((f) => f.filled).length;
  const missingFields = fields.filter((f) => !f.filled);
  const critical = missingFields.filter((f) => f.affectsIntegration);
  const rest = missingFields.filter((f) => !f.affectsIntegration);
  return {
    filled,
    total,
    percent: total === 0 ? 100 : Math.round((filled / total) * 100),
    missing: [...critical, ...rest].map((f) => f.label),
    missingCritical: critical.map((f) => f.label),
  };
}

/** هل للقيمة محتوى فعلي؟ */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** الصياغة المعتمدة للمؤشّر — موسومة صراحةً بأنها اكتمال **بيانات النموذج** */
export const COMPLETENESS_LABEL = "اكتمال البيانات";
export const COMPLETENESS_HINT = "يمكنك الحفظ الآن واستكمال البيانات لاحقًا";

/** جملة النواقص المعروضة — تُسمّي الحقول بدل «توجد حقول ناقصة» */
export function missingSentence(c: Completeness): string | null {
  if (c.missing.length === 0) return null;
  const shown = c.missing.slice(0, 6).join("، ");
  const rest = c.missing.length - 6;
  return rest > 0 ? `${shown} و${rest} حقلاً آخر` : shown;
}

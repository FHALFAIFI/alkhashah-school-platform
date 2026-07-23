/**
 * تقدم التنفيذ للبرنامج — يُحسب من الأنشطة الموزونة حصراً (D-020).
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات: كل القواعد قابلة للاختبار مباشرة.
 *
 * القواعد الملزمة:
 *   - «مسودة» و«لم يبدأ» = 0٪ مهما كانت القيمة المسجّلة.
 *   - «مكتمل» = 100٪ مهما كانت القيمة المسجّلة.
 *   - «قيد التنفيذ» يأخذ القيمة المسجّلة صراحةً بين 1 و99 — ولا تُخترع قيمة افتراضية
 *     (لا 50٪ لمجرد أن النشاط جارٍ). نشاط جارٍ بلا قيمة مسجّلة = 0٪.
 *   - بلا أنشطة = 0٪ تقدم للبرنامج.
 *   - الأنشطة المؤرشفة والملغاة مستبعدة تماماً من الحساب ومن مجموع الأوزان.
 *   - الدقة تُحفظ داخلياً؛ التقريب للعرض فقط.
 */

export const ACTIVITY_STATUS = {
  draft: "مسودة",
  notStarted: "لم يبدأ",
  inProgress: "قيد التنفيذ",
  completed: "مكتمل",
  reopened: "أعيد فتحه",
  cancelled: "ملغى",
  archived: "مؤرشف",
} as const;

export type ActivityStatus = (typeof ACTIVITY_STATUS)[keyof typeof ACTIVITY_STATUS];

export const WEIGHTING_MODE = { equal: "متساوٍ", custom: "مخصص" } as const;
export type WeightingMode = (typeof WEIGHTING_MODE)[keyof typeof WEIGHTING_MODE];

export type ActivityForProgress = {
  id: string;
  name?: string;
  status: string;
  progress: number;
  weight: number | null;
  archivedAt?: Date | string | null;
};

/** النشاط يدخل الحساب؟ المؤرشف والملغى خارج الحساب ومجموع الأوزان معاً. */
export function countsTowardProgress(a: ActivityForProgress): boolean {
  if (a.archivedAt) return false;
  return a.status !== ACTIVITY_STATUS.archived && a.status !== ACTIVITY_STATUS.cancelled;
}

/**
 * نسبة إنجاز النشاط الفعلية بعد تطبيق قواعد الحالة.
 * القيمة المسجّلة تُحترم فقط في «قيد التنفيذ» و«أعيد فتحه»، ودائماً ضمن 1..99.
 */
export function effectiveActivityProgress(a: Pick<ActivityForProgress, "status" | "progress">): number {
  switch (a.status) {
    case ACTIVITY_STATUS.completed:
      return 100;
    case ACTIVITY_STATUS.draft:
    case ACTIVITY_STATUS.notStarted:
      return 0;
    case ACTIVITY_STATUS.inProgress:
    case ACTIVITY_STATUS.reopened: {
      // لا اختراع لقيمة افتراضية: غير المسجّل يبقى صفراً
      if (!Number.isFinite(a.progress)) return 0;
      return Math.max(0, Math.min(99, Math.trunc(a.progress)));
    }
    default:
      return 0;
  }
}

export type WeightValidation = {
  valid: boolean;
  mode: WeightingMode;
  /** مجموع الأوزان المخصصة للأنشطة المحتسبة (وضع «مخصص» فقط) */
  total: number;
  /** أسباب البطلان بالعربية — تظهر في قائمة الجاهزية */
  problemsAr: string[];
};

/**
 * تحقق من الأوزان. لا تطبيع صامت: مجموع مخصص مخالف لـ100 يبقى مخالفاً ويُبلَّغ عنه.
 */
export function validateWeights(activities: ActivityForProgress[], mode: WeightingMode): WeightValidation {
  const counted = activities.filter(countsTowardProgress);
  const problemsAr: string[] = [];

  if (mode === WEIGHTING_MODE.equal) {
    return { valid: true, mode, total: counted.length === 0 ? 0 : 100, problemsAr };
  }

  const missing = counted.filter((a) => a.weight === null || a.weight === undefined);
  const nonPositive = counted.filter((a) => a.weight !== null && a.weight !== undefined && a.weight <= 0);
  const total = counted.reduce((s, a) => s + (a.weight ?? 0), 0);

  if (missing.length > 0) {
    problemsAr.push(`${missing.length} نشاطاً بلا وزن مخصص`);
  }
  if (nonPositive.length > 0) {
    problemsAr.push(`${nonPositive.length} نشاطاً بوزن صفري أو سالب — الوزن المخصص يجب أن يكون موجباً`);
  }
  if (counted.length > 0 && total !== 100) {
    problemsAr.push(`مجموع الأوزان المخصصة ${total}٪ ولا يساوي 100٪`);
  }

  return { valid: problemsAr.length === 0, mode, total, problemsAr };
}

/** الوزن الفعلي لكل نشاط محتسب، بالنسبة المئوية. مجموعها 100 في الوضع الصحيح. */
export function effectiveWeights(
  activities: ActivityForProgress[],
  mode: WeightingMode,
): Map<string, number> {
  const counted = activities.filter(countsTowardProgress);
  const out = new Map<string, number>();
  if (counted.length === 0) return out;

  if (mode === WEIGHTING_MODE.equal) {
    const w = 100 / counted.length;
    for (const a of counted) out.set(a.id, w);
    return out;
  }

  const total = counted.reduce((s, a) => s + (a.weight ?? 0), 0);
  // مجموع غير صالح: لا تطبيع صامت — تُعاد الأوزان الخام كما هي ويبقى البطلان ظاهراً
  // عبر `validateWeights`، فيمنع الاكتمال الطبيعي بدل أن يُخفى بحسابٍ متساهل.
  if (total <= 0) return out;
  for (const a of counted) out.set(a.id, a.weight ?? 0);
  return out;
}

export type ProgramProgress = {
  /** القيمة الدقيقة غير المقربة — تُستعمل في الحسابات التالية */
  exact: number;
  /** القيمة المقربة للعرض */
  display: number;
  countedActivities: number;
  weights: WeightValidation;
};

/**
 * تقدم البرنامج = Σ (الوزن الفعلي للنشاط × نسبة إنجازه) ÷ 100.
 * بلا أنشطة محتسبة = 0٪.
 */
export function computeProgramProgressFromActivities(
  activities: ActivityForProgress[],
  mode: WeightingMode,
): ProgramProgress {
  const weights = validateWeights(activities, mode);
  const counted = activities.filter(countsTowardProgress);
  if (counted.length === 0) {
    return { exact: 0, display: 0, countedActivities: 0, weights };
  }

  const w = effectiveWeights(activities, mode);
  const weightTotal = [...w.values()].reduce((s, v) => s + v, 0);
  if (weightTotal <= 0) {
    return { exact: 0, display: 0, countedActivities: counted.length, weights };
  }

  // القسمة على مجموع الأوزان الفعلي تُبقي النتيجة ضمن 0..100 حتى في الوضع المخصص المخالف،
  // فلا يظهر تقدم > 100٪ للمستخدم بينما يبقى البطلان معلناً في `weights`.
  const weighted = counted.reduce((s, a) => s + (w.get(a.id) ?? 0) * effectiveActivityProgress(a), 0);
  const exact = weighted / weightTotal;

  return {
    exact,
    display: Math.round(exact),
    countedActivities: counted.length,
    weights,
  };
}

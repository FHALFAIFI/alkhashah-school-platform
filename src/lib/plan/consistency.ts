/**
 * كاشف تناقض حالات البرامج (v2.4.1 §5).
 *
 * السبب الجذري لشكوى «المتابعة الأسبوعية تُظهر كل البرامج مكتملة»: سجلات قديمة تحمل
 * `execution_status = «مكتمل»` مع `progress = 0` وبلا `completed_at`. إصلاح v2.4 (D-042)
 * صحّح **مسار الكتابة** والعرض، لكنه لا يستطيع تعويض تناقضٍ في السجل المصدر نفسه.
 *
 * هذه الوحدة **تكشف ولا تُصحِّح**: لا تفترض أي الحقلين هو الصحيح، ولا تعيد كتابة أي قيمة.
 * القرار للمدير عبر شاشة المراجعة — لأن «هل أُنجز اليوم الوطني فعلاً؟» سؤال تشغيلي لا
 * يملك النظام إجابته.
 *
 * وحدة خالصة: بلا قاعدة بيانات وبلا React، فتُختبر وحدوياً بالكامل.
 */

/** حالات التنفيذ التي تتوافق مع «مكتمل» — القائمة المرجعية الوحيدة */
export const COMPLETED_COMPATIBLE_EXECUTION = ["مكتمل"] as const;

/** حالة الاعتماد التي تعني الإقفال النهائي من المدير */
export const CLOSED_STATUS = "مقفل";

export type ProgramConsistencyRule = "A" | "B" | "C" | "D" | "E";

export type ProgramConsistencyFinding = {
  rule: ProgramConsistencyRule;
  /** وصف التناقض بالعربية — يُعرض في الشاشة والتقرير كما هو */
  reason: string;
  /** ما الذي يحتاج قراراً من المدير — لا يقترح قيمة بعينها */
  review: string;
};

export type ProgramConsistencyInput = {
  executionStatus: string;
  progress: number;
  completedAt: Date | null;
  /** مسودة | معتمد | مقفل */
  status: string;
  /** أقرّ المدير الاكتمال صراحةً رغم نقص الجاهزية (يُعرض كسياق لا كإسكات) */
  completionOverride?: boolean;
};

const isCompletedCompatible = (executionStatus: string): boolean =>
  (COMPLETED_COMPATIBLE_EXECUTION as readonly string[]).includes(executionStatus);

/**
 * يفحص سجل برنامج واحد ويعيد كل التناقضات المكتشفة (قد تجتمع عدة قواعد على سجل واحد).
 * المصفوفة الفارغة تعني «لا تناقض» — وليست تأكيداً على صحة القيم تشغيلياً.
 */
export function checkProgramConsistency(p: ProgramConsistencyInput): ProgramConsistencyFinding[] {
  const findings: ProgramConsistencyFinding[] = [];

  // A — «مكتمل» بينما التقدم أقل من 100٪
  if (isCompletedCompatible(p.executionStatus) && p.progress < 100) {
    findings.push({
      rule: "A",
      reason: `حالة التنفيذ «${p.executionStatus}» بينما التقدم ${p.progress}٪`,
      review: "راجع التقدم الفعلي أو حالة التنفيذ — أحدهما لا يطابق الواقع",
    });
  }

  // B — «مكتمل» بلا تاريخ اكتمال موثق
  if (isCompletedCompatible(p.executionStatus) && p.completedAt === null) {
    findings.push({
      rule: "B",
      reason: `حالة التنفيذ «${p.executionStatus}» بلا تاريخ اكتمال موثق`,
      review: "وثّق تاريخ الاكتمال أو أعد حالة التنفيذ إلى ما يطابق الواقع",
    });
  }

  // C — تقدم 100٪ وحالة التنفيذ ليست من حالات الاكتمال
  if (p.progress === 100 && !isCompletedCompatible(p.executionStatus)) {
    findings.push({
      rule: "C",
      reason: `التقدم 100٪ بينما حالة التنفيذ «${p.executionStatus}»`,
      review: "أكمل حالة التنفيذ أو صحّح التقدم — البرنامج مكتمل رقمياً وغير مكتمل حالةً",
    });
  }

  // D — مقفل من المدير بينما التنفيذ غير مكتمل فعلياً
  if (p.status === CLOSED_STATUS && (!isCompletedCompatible(p.executionStatus) || p.completedAt === null)) {
    findings.push({
      rule: "D",
      reason: `البرنامج «${CLOSED_STATUS}» بينما التنفيذ غير مكتمل موثقاً`,
      review: "راجع الإقفال: إمّا توثيق الاكتمال أو إعادة فتح البرنامج",
    });
  }

  // E — تاريخ اكتمال مسجَّل وحالة التنفيذ لا توافقه
  if (p.completedAt !== null && !isCompletedCompatible(p.executionStatus)) {
    findings.push({
      rule: "E",
      reason: `تاريخ اكتمال مسجَّل بينما حالة التنفيذ «${p.executionStatus}»`,
      review: "صحّح حالة التنفيذ أو أزل تاريخ الاكتمال",
    });
  }

  return findings;
}

/** هل السجل متناقض؟ اختصار للترشيح والعدّ */
export function isProgramInconsistent(p: ProgramConsistencyInput): boolean {
  return checkProgramConsistency(p).length > 0;
}

/** وسم يظهر بجانب البرنامج في المتابعة الأسبوعية والتقارير (§5.5) */
export const NEEDS_REVIEW_LABEL = "حالة البرنامج تحتاج مراجعة";

/** مرشِّحات شاشة المراجعة (§5.2) — المفتاح يظهر في عنوان الصفحة كمعامل بحث */
export const CONSISTENCY_FILTERS = {
  all: "كل البرامج",
  inconsistent: "غير المتسقة فقط",
  completedBelow100: "مكتمل بأقل من 100٪",
  completedNoDate: "مكتمل بلا تاريخ اكتمال",
  fullNotCompleted: "100٪ وغير مكتمل",
} as const;

export type ConsistencyFilter = keyof typeof CONSISTENCY_FILTERS;

/** هل يطابق السجل المرشِّح المختار؟ */
export function matchesConsistencyFilter(
  p: ProgramConsistencyInput,
  filter: ConsistencyFilter,
): boolean {
  if (filter === "all") return true;
  const rules = new Set(checkProgramConsistency(p).map((f) => f.rule));
  if (filter === "inconsistent") return rules.size > 0;
  if (filter === "completedBelow100") return rules.has("A");
  if (filter === "completedNoDate") return rules.has("B");
  if (filter === "fullNotCompleted") return rules.has("C");
  return false;
}

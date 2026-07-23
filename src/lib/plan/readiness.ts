/**
 * جاهزية اكتمال البرنامج — منفصلة تماماً عن تقدم التنفيذ.
 *
 * التقدم يقيس «كم أُنجز»؛ الجاهزية تقيس «هل استُوفيت الشروط الإلزامية للإقفال».
 * برنامج تقدمه 100٪ قد تكون جاهزيته أقل (شاهد ناقص، وزن مخالف، توقيع غير مرفوع).
 *
 * الجاهزية لا تُحسب أبداً من عدد الملفات المرفوعة — بل من فحوص إلزامية منطبقة،
 * كل فحص فاشل يظهر في قائمة النواقص بنص عربي صريح ورابط مباشر للسجل المعني.
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات.
 */

import {
  ACTIVITY_STATUS,
  countsTowardProgress,
  validateWeights,
  type ActivityForProgress,
  type WeightingMode,
} from "./activity-progress";

export type ReadinessCheckKey =
  | "program_info"
  | "activity_weights"
  | "required_activities"
  | "required_deliverables"
  | "required_evidence"
  | "approvals";

export type MissingItem = {
  check: ReadinessCheckKey;
  /** نص عربي صريح يذكر ما الناقص بالضبط */
  labelAr: string;
  /** رابط مباشر للنشاط أو المتطلب المعني */
  href?: string;
};

export type ReadinessCheck = {
  key: ReadinessCheckKey;
  labelAr: string;
  /** الفحص منطبق على هذا البرنامج؟ غير المنطبق لا يدخل النسبة */
  applicable: boolean;
  passed: boolean;
  missing: MissingItem[];
};

export type ReadinessResult = {
  /** نسبة الفحوص المنطبقة الناجحة */
  percent: number;
  /** الحالة بالعربية الواضحة */
  statusAr: string;
  ready: boolean;
  checks: ReadinessCheck[];
  /** كل النواقص مسطّحة — أساس قائمة التدقيق ولقطة التجاوز */
  missing: MissingItem[];
};

export type ReadinessInput = {
  programId: string;
  program: {
    name: string | null;
    domain: string | null;
    generalGoal: string | null;
    specificGoal: string | null;
    ownerPersonId: string | null;
    ownerPosition: string | null;
    hijriStart: string | null;
    hijriEnd: string | null;
    status: string;
    weightingMode: WeightingMode;
  };
  activities: (ActivityForProgress & { requiredForCompletion: boolean })[];
  /** مخرجات الأنشطة */
  deliverables: { id: string; activityId: string; name: string; required: boolean; completed: boolean }[];
  /** متطلبات الشواهد + عدد الشواهد المرتبطة فعلياً بكل متطلب */
  evidenceRequirements: {
    id: string;
    activityId: string;
    label: string;
    required: boolean;
    minCount: number;
    /** عدد روابط الشواهد المستوفية للتصنيف المطلوب */
    satisfiedCount: number;
  }[];
  /** الموافقات/التواقيع الإلزامية المعلنة لهذا البرنامج */
  approvals?: { key: string; labelAr: string; satisfied: boolean }[];
};

const activityHref = (programId: string, activityId: string) => `/plan/${programId}?نشاط=${activityId}`;

/** الحقول التعريفية الإلزامية للبرنامج قبل الإقفال. */
function checkProgramInfo(input: ReadinessInput): ReadinessCheck {
  const p = input.program;
  const required: { value: string | null; labelAr: string }[] = [
    { value: p.name, labelAr: "اسم البرنامج" },
    { value: p.domain, labelAr: "المجال" },
    { value: p.generalGoal, labelAr: "الهدف العام" },
    { value: p.specificGoal, labelAr: "الهدف التفصيلي" },
    { value: p.ownerPersonId ?? p.ownerPosition, labelAr: "مسؤول البرنامج" },
    { value: p.hijriStart, labelAr: "تاريخ البداية" },
    { value: p.hijriEnd, labelAr: "تاريخ النهاية" },
  ];
  const missing = required
    .filter((r) => !r.value || String(r.value).trim() === "")
    .map<MissingItem>((r) => ({
      check: "program_info",
      labelAr: `بيان ناقص في البرنامج: ${r.labelAr}`,
      href: `/plan/${input.programId}`,
    }));
  return { key: "program_info", labelAr: "بيانات البرنامج الأساسية", applicable: true, passed: missing.length === 0, missing };
}

/** أوزان الأنشطة صحيحة — المجموع المخصص المخالف يمنع الاكتمال ولا يُطبَّع صامتاً. */
function checkWeights(input: ReadinessInput): ReadinessCheck {
  const v = validateWeights(input.activities, input.program.weightingMode);
  const missing = v.problemsAr.map<MissingItem>((labelAr) => ({
    check: "activity_weights",
    labelAr: `وزن غير صالح: ${labelAr}`,
    href: `/plan/${input.programId}`,
  }));
  return { key: "activity_weights", labelAr: "صحة أوزان الأنشطة", applicable: true, passed: v.valid, missing };
}

/** الأنشطة الإلزامية مكتملة. */
function checkRequiredActivities(input: ReadinessInput): ReadinessCheck {
  const required = input.activities.filter((a) => countsTowardProgress(a) && a.requiredForCompletion);
  const missing = required
    .filter((a) => a.status !== ACTIVITY_STATUS.completed)
    .map<MissingItem>((a) => ({
      check: "required_activities",
      labelAr: `نشاط إلزامي غير مكتمل: «${a.name ?? "بلا اسم"}» (${a.status})`,
      href: activityHref(input.programId, a.id),
    }));
  return {
    key: "required_activities",
    labelAr: "اكتمال الأنشطة الإلزامية",
    applicable: required.length > 0,
    passed: missing.length === 0,
    missing,
  };
}

/** المخرجات الإلزامية منجزة. */
function checkRequiredDeliverables(input: ReadinessInput): ReadinessCheck {
  const live = new Set(input.activities.filter(countsTowardProgress).map((a) => a.id));
  const required = input.deliverables.filter((d) => d.required && live.has(d.activityId));
  const missing = required
    .filter((d) => !d.completed)
    .map<MissingItem>((d) => ({
      check: "required_deliverables",
      labelAr: `مخرج إلزامي غير منجز: «${d.name}»`,
      href: activityHref(input.programId, d.activityId),
    }));
  return {
    key: "required_deliverables",
    labelAr: "إنجاز المخرجات الإلزامية",
    applicable: required.length > 0,
    passed: missing.length === 0,
    missing,
  };
}

/**
 * متطلبات الشواهد الإلزامية مستوفاة.
 * المعيار هو استيفاء المتطلب المعلن (التصنيف والحد الأدنى) — لا مجرد عدد الملفات المرفوعة.
 */
function checkRequiredEvidence(input: ReadinessInput): ReadinessCheck {
  const live = new Set(input.activities.filter(countsTowardProgress).map((a) => a.id));
  const required = input.evidenceRequirements.filter((r) => r.required && live.has(r.activityId));
  const missing = required
    .filter((r) => r.satisfiedCount < r.minCount)
    .map<MissingItem>((r) => ({
      check: "required_evidence",
      labelAr: `شاهد ناقص: «${r.label}» — المطلوب ${r.minCount}، المتوفر ${r.satisfiedCount}`,
      href: activityHref(input.programId, r.activityId),
    }));
  return {
    key: "required_evidence",
    labelAr: "استيفاء متطلبات الشواهد",
    applicable: required.length > 0,
    passed: missing.length === 0,
    missing,
  };
}

/** الموافقات والتواقيع الإلزامية. */
function checkApprovals(input: ReadinessInput): ReadinessCheck {
  const approvals = input.approvals ?? [];
  const missing = approvals
    .filter((a) => !a.satisfied)
    .map<MissingItem>((a) => ({
      check: "approvals",
      labelAr: `اعتماد/توقيع مطلوب: ${a.labelAr}`,
      href: `/plan/${input.programId}`,
    }));
  return {
    key: "approvals",
    labelAr: "الاعتمادات والتواقيع",
    applicable: approvals.length > 0,
    passed: missing.length === 0,
    missing,
  };
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const checks = [
    checkProgramInfo(input),
    checkWeights(input),
    checkRequiredActivities(input),
    checkRequiredDeliverables(input),
    checkRequiredEvidence(input),
    checkApprovals(input),
  ];

  const applicable = checks.filter((c) => c.applicable);
  const passed = applicable.filter((c) => c.passed);
  const percent = applicable.length === 0 ? 100 : Math.round((passed.length / applicable.length) * 100);
  const missing = checks.flatMap((c) => c.missing);
  const ready = missing.length === 0;

  const statusAr = ready
    ? "جاهز للإقفال — كل المتطلبات الإلزامية مستوفاة"
    : `غير جاهز — ${missing.length} متطلباً ناقصاً`;

  return { percent, statusAr, ready, checks, missing };
}

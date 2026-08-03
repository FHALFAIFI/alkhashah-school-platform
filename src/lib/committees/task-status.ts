/**
 * v2.4 §12: حالات تنفيذ مهام اللجان — قائمة مغلقة. NULL يعني «لم تُحدَّد» وتُعرض «—»
 * في السجلات والتقارير؛ لا تُفترض أي حالة تلقائياً.
 */
export const COMMITTEE_TASK_STATUSES = ["لم تبدأ", "قيد التنفيذ", "منجزة"] as const;
export type CommitteeTaskStatus = (typeof COMMITTEE_TASK_STATUSES)[number];

export function isCommitteeTaskStatus(value: string): value is CommitteeTaskStatus {
  return (COMMITTEE_TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * v2.4.1 §6.1: الحالة غير المحددة تُشرح ولا تُختصر إلى «—».
 *
 * كل صفوف `committee_task_assignments` في الإنتاج (31 صفاً) تحمل `status = NULL` لأن
 * الهجرة 0028 أضافت العمود دون تعبئة — وهو الصواب: لا تُفترض حالة لم يُدخلها أحد. لكن
 * عرض «—» جعل المدير يقرأ الميزة على أنها غائبة. النص الصريح يفصل «لم يُحدَّد» عن
 * «لا توجد بيانات».
 */
export const TASK_STATUS_UNSET_LABEL = "لم يتم تحديد الحالة";

/** لجنة بلا مهام مسندة — حالة فارغة موجَّهة لا جدول فارغ (§6.3) */
export const COMMITTEE_NO_TASKS_LABEL = "لم تتم إضافة مهام لهذه اللجنة";

/** نص الإجراء المرافق للحالة الفارغة */
export const ADD_TASK_CTA = "إضافة مهمة";

/** نص العرض لحالة مهمة قد تكون غير محددة */
export function taskStatusLabel(status: string | null | undefined): string {
  return status ?? TASK_STATUS_UNSET_LABEL;
}

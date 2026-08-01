/**
 * v2.4 §12: حالات تنفيذ مهام اللجان — قائمة مغلقة. NULL يعني «لم تُحدَّد» وتُعرض «—»
 * في السجلات والتقارير؛ لا تُفترض أي حالة تلقائياً.
 */
export const COMMITTEE_TASK_STATUSES = ["لم تبدأ", "قيد التنفيذ", "منجزة"] as const;
export type CommitteeTaskStatus = (typeof COMMITTEE_TASK_STATUSES)[number];

export function isCommitteeTaskStatus(value: string): value is CommitteeTaskStatus {
  return (COMMITTEE_TASK_STATUSES as readonly string[]).includes(value);
}

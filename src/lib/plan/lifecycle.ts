/**
 * سير عمل البرنامج ثلاثي الحالات (التصحيح التشغيلي — القضية 2):
 *
 *   «قيد التنفيذ» ─ تعليم البرنامج كمكتمل ─→ «مكتمل» ─ إقفال البرنامج نهائياً ─→ «مغلق»
 *   «قيد التنفيذ» ←─ إعادة البرنامج للتنفيذ ─ «مكتمل» ←─ إعادة فتح البرنامج ─── «مغلق»
 *
 * الحالة مشتقة حصراً من العمودين الزمنيين على سجل البرنامج (`completedAt`/`closedAt`) —
 * لا من عدد الشواهد ولا نسب الأنشطة ولا المعالم ولا درجات جاهزية ولا حقول إلزامية
 * (D-024/D-025). محور مستقل تماماً عن الاعتماد (`status`) وعن الأرشفة (`archivedAt`).
 */

export const PROGRAM_LIFECYCLE = {
  active: "قيد التنفيذ",
  completed: "مكتمل",
  closed: "مغلق",
} as const;

export type ProgramLifecycle = (typeof PROGRAM_LIFECYCLE)[keyof typeof PROGRAM_LIFECYCLE];

/** أفعال سجل التحولات (append-only في `program_closure_history`) */
export const LIFECYCLE_ACTIONS = {
  complete: "اكتمال",
  close: "إقفال",
  reopen: "إعادة فتح",
  resume: "إعادة للتنفيذ",
} as const;

export function programLifecycle(p: { completedAt: Date | null; closedAt: Date | null }): ProgramLifecycle {
  if (p.closedAt) return PROGRAM_LIFECYCLE.closed;
  if (p.completedAt) return PROGRAM_LIFECYCLE.completed;
  return PROGRAM_LIFECYCLE.active;
}

/** الإجراء التالي المتاح — يُعرض في بطاقة حالة البرنامج */
export function nextLifecycleAction(p: { completedAt: Date | null; closedAt: Date | null }): string {
  const state = programLifecycle(p);
  if (state === PROGRAM_LIFECYCLE.active) return "تعليم البرنامج كمكتمل";
  if (state === PROGRAM_LIFECYCLE.completed) return "إقفال البرنامج نهائياً";
  return "إعادة فتح البرنامج";
}

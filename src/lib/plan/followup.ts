/**
 * المتابعة الأسبوعية: مفتاح الأسبوع ISO واستحقاق المتابعة.
 * البرنامج المعتمد بلا متابعة لأكثر من 14 يوماً يعد «متابعة مستحقة».
 */

/** حالات التنفيذ المتاحة في نموذج المتابعة الأسبوعية */
export const FOLLOWUP_STATUSES = ["في المسار", "متأخر", "متوقف مؤقتاً", "مكتمل"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

/** عدد الأيام التي يعتبر بعدها البرنامج المعتمد بحاجة لمتابعة */
export const FOLLOWUP_DUE_DAYS = 14;

/** مفتاح الأسبوع بصيغة ISO-8601 مثل «2026-W29» (الأسبوع يبدأ الاثنين) */
export function isoWeekKey(date: Date = new Date()): string {
  // خوارزمية ISO: الخميس من نفس الأسبوع يحدد السنة الأسبوعية
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // الاثنين=1 .. الأحد=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** عدد الأيام الكاملة منذ تاريخ معين */
export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

/** هل المتابعة مستحقة؟ (لا متابعة إطلاقاً، أو مضى أكثر من 14 يوماً) */
export function isFollowupDue(lastReviewAt: Date | null, now: Date = new Date()): boolean {
  if (!lastReviewAt) return true;
  return daysSince(lastReviewAt, now) > FOLLOWUP_DUE_DAYS;
}

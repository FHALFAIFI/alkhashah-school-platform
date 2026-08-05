/**
 * المتابعة الأسبوعية: مفتاح الأسبوع ISO واستحقاق المتابعة.
 * البرنامج المعتمد بلا متابعة لأكثر من 14 يوماً يعد «متابعة مستحقة».
 */

/**
 * حالات التنفيذ المعتمدة على **سجل البرنامج** (`programs.execution_status`).
 *
 * هذه المفردات موجودة فعلاً في بيانات الإنتاج منذ v2.1، ولا تُعاد كتابتها (§18). تبقى كما
 * هي لأنها محور مستقل عن حالة الأسبوع (§6.4).
 */
export const FOLLOWUP_STATUSES = ["في المسار", "متأخر", "متوقف مؤقتاً", "مكتمل"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

/**
 * حالات **المتابعة الأسبوعية** (v2.5.0 §6.3) — محور مستقل عن حالة البرنامج الجارية.
 *
 * الفارق عن القائمة أعلاه مقصود: التكليف يطلب «لم يبدأ» و«قيد التنفيذ» صراحةً. لم تُعد
 * كتابة أي صف تاريخي: القيم القديمة («في المسار» و«متوقف مؤقتاً» بالرسم القديم) تُطبَّع
 * عند القراءة عبر `normalizeWeeklyStatus`، فيرى المدير مفردات واحدة على الشاشة وفي
 * التقرير دون أن تُمسّ قاعدة البيانات.
 */
export const WEEKLY_STATUSES = ["لم يبدأ", "قيد التنفيذ", "متأخر", "مكتمل", "متوقف مؤقتًا"] as const;
export type WeeklyStatus = (typeof WEEKLY_STATUSES)[number];

/** مرادفات تاريخية محفوظة في `program_followups.execution_status` */
const LEGACY_WEEKLY_STATUS: Record<string, WeeklyStatus> = {
  "في المسار": "قيد التنفيذ",
  "متوقف مؤقتاً": "متوقف مؤقتًا",
};

/** تطبيع حالة أسبوع مقروءة من القاعدة إلى المفردات المعروضة — بلا كتابة */
export function normalizeWeeklyStatus(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return LEGACY_WEEKLY_STATUS[stored] ?? stored;
}

/** هل النص حالة أسبوع مقبولة للكتابة؟ يقبل المرادف التاريخي كي لا يُرفض تحرير صف قديم */
export function isWeeklyStatus(value: string): boolean {
  return (WEEKLY_STATUSES as readonly string[]).includes(value) || value in LEGACY_WEEKLY_STATUS;
}

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

/** وسم الأسبوع بلا تحديث — يظهر بدل الحالة عندما لا يوجد سجل متابعة للأسبوع المختار (v2.4 §7) */
export const NO_WEEKLY_UPDATE_LABEL = "لم يتم التحديث هذا الأسبوع";

/** هل النص مفتاح أسبوع ISO صالح مثل «2026-W31»؟ */
export function isValidWeekKey(key: string): boolean {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= 53;
}

/** تاريخ اثنين الأسبوع من مفتاحه (بتوقيت UTC) */
export function isoWeekMonday(weekKey: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // 4 يناير يقع دائماً في الأسبوع الأول بحسب ISO
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

/** مفتاح الأسبوع السابق (يتعامل مع حدود السنة بحساب اثنين الأسبوع ثم طرح 7 أيام) */
export function previousWeekKey(weekKey: string): string | null {
  const monday = isoWeekMonday(weekKey);
  if (!monday) return null;
  const prev = new Date(monday);
  prev.setUTCDate(monday.getUTCDate() - 7);
  return isoWeekKey(new Date(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate()));
}

/** آخر n أسابيع (الأحدث أولاً) — لقائمة اختيار الأسبوع */
export function recentWeekKeys(n: number, from: Date = new Date()): string[] {
  const keys: string[] = [];
  let key = isoWeekKey(from);
  for (let i = 0; i < n && key; i++) {
    keys.push(key);
    key = previousWeekKey(key) ?? "";
  }
  return keys;
}

/**
 * تجميع الحالة الأسبوعية الصادقة (v2.4 §7) — لا يساوي النظام بين:
 * اكتمال المستخدم واعتماد المدير، ولا بين تقدم 100٪ والإقفال، ولا بين غياب التحديث والاكتمال.
 */
export type WeeklyGroup =
  | "مغلق"
  | "مكتمل — بانتظار الإقفال"
  | "متأخر"
  | "متوقف مؤقتاً"
  | "في المسار"
  | "لم يبدأ"
  | "بلا تحديث هذا الأسبوع";

export function weeklyGroup(opts: {
  closedAt: Date | null;
  completedAt: Date | null;
  weekStatus: string | null;
  currentStatus: string;
}): WeeklyGroup {
  if (opts.closedAt) return "مغلق";
  if (opts.completedAt) return "مكتمل — بانتظار الإقفال";
  // يُطبَّع أولاً فيُعامَل الصف التاريخي والصف الجديد بالمعنى نفسه (§6.1)
  const s = normalizeWeeklyStatus(opts.weekStatus);
  // «مكتمل» في متابعة الأسبوع دون توثيق الاكتمال: يُجمَّع مع المكتمل وتظهر واجهة العرض
  // تنبيهاً بأن الاكتمال غير موثق بعد — لا يُساوى بالبرنامج الجاري
  if (s === "مكتمل") return "مكتمل — بانتظار الإقفال";
  if (s === "متأخر") return "متأخر";
  if (s === "متوقف مؤقتًا") return "متوقف مؤقتاً";
  if (s === "قيد التنفيذ") return "في المسار";
  if (s === "لم يبدأ") return "لم يبدأ";
  // لا سجل متابعة للأسبوع — الحالة الجارية للعرض فقط، وغياب التحديث لا يعني الاكتمال
  if (opts.currentStatus === "لم يبدأ") return "لم يبدأ";
  return "بلا تحديث هذا الأسبوع";
}

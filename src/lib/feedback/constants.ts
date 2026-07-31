/**
 * Pilot-feedback constants and pure helpers — shared by the client form, the
 * management screen, exports, and unit tests. MUST stay free of "server-only" and
 * "use server" so it can be imported into client components.
 *
 * All user-facing values are Arabic (stored verbatim in the DB, matching the
 * platform convention of Arabic status/category values).
 */

/** الفئات (عربية) — قائمة ثابتة */
export const FEEDBACK_CATEGORIES = [
  "مشكلة",
  "اقتراح",
  "خطوة غير واضحة",
  "بيانات غير صحيحة",
  "بطء في الاستخدام",
  "أخرى",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** الأهمية (عربية) — قائمة ثابتة */
export const FEEDBACK_SEVERITIES = [
  "ملاحظة بسيطة",
  "تؤثر جزئياً على العمل",
  "تمنع إكمال العمل",
] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

/** الحالات (عربية) — «لن تُنفذ» تتطلب سبباً موثقاً */
export const FEEDBACK_STATUSES = [
  "جديدة",
  "قيد المراجعة",
  "مخطط لمعالجتها",
  "تم الحل",
  "لن تُنفذ",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** فئات الجهاز (عربية) */
export const FEEDBACK_DEVICE_CLASSES = ["جوال", "لوحي", "سطح مكتب"] as const;
export type FeedbackDeviceClass = (typeof FEEDBACK_DEVICE_CLASSES)[number];

/** الوحدات (عربية) — لعرضها في القائمة المنسدلة */
export const FEEDBACK_MODULES = [
  "لوحة القيادة",
  "مركز التشغيل التجريبي",
  "الخطة التشغيلية",
  "اللجان والمجالس",
  "الأداء الوظيفي",
  "المبنى المدرسي",
  "سجل المنسوبين",
  "الاستيراد",
  "التقارير",
  "الوثائق الصادرة",
  "التقويم",
  "الشواهد",
  "المهام والإجراءات",
  "الإشعارات",
  "الإدارة",
  "أخرى",
] as const;

/** خرائط بادئة المسار → اسم الوحدة العربي */
const MODULE_BY_PREFIX: { prefix: string; module: string }[] = [
  { prefix: "/dashboard", module: "لوحة القيادة" },
  { prefix: "/pilot", module: "مركز التشغيل التجريبي" },
  { prefix: "/plan", module: "الخطة التشغيلية" },
  { prefix: "/committees", module: "اللجان والمجالس" },
  { prefix: "/performance", module: "الأداء الوظيفي" },
  { prefix: "/building", module: "المبنى المدرسي" },
  { prefix: "/people", module: "سجل المنسوبين" },
  { prefix: "/imports", module: "الاستيراد" },
  { prefix: "/reports", module: "التقارير" },
  { prefix: "/documents", module: "الوثائق الصادرة" },
  { prefix: "/calendar", module: "التقويم" },
  { prefix: "/evidence", module: "الشواهد" },
  { prefix: "/tasks", module: "المهام والإجراءات" },
  { prefix: "/notifications", module: "الإشعارات" },
  { prefix: "/admin", module: "الإدارة" },
];

/** يشتق اسم الوحدة العربي من مسار الصفحة — «أخرى» عند عدم التطابق */
export function moduleFromPath(pathname: string): string {
  const p = (pathname || "").split("?")[0];
  for (const { prefix, module } of MODULE_BY_PREFIX) {
    if (p === prefix || p.startsWith(prefix + "/")) return module;
  }
  return "أخرى";
}

/** فئة الجهاز من عرض نافذة العرض بالبكسل */
export function deviceClassFromViewport(width: number): FeedbackDeviceClass {
  if (!Number.isFinite(width) || width <= 0) return "سطح مكتب";
  if (width < 640) return "جوال";
  if (width < 1024) return "لوحي";
  return "سطح مكتب";
}

/**
 * تطبيع مقاس نافذة العرض إلى «العرض×الارتفاع» بأرقام سليمة فقط، وإلا فارغ.
 * لا يقبل إلا رقمين موجبين ضمن حدود معقولة (حماية من قيم مُلفّقة من العميل).
 */
export function normalizeViewport(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{1,5})[x×](\d{1,5})$/.exec(raw.trim());
  if (!m) return "";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w <= 0 || h <= 0 || w > 20000 || h > 20000) return "";
  return `${w}×${h}`;
}

/** عائلة المتصفح العامة الآمنة من نص وكيل المستخدم — لا بصمة دقيقة */
export function browserFamilyFromUA(ua: string | null | undefined): string {
  const s = (ua || "").toLowerCase();
  if (!s) return "غير معروف";
  if (s.includes("edg/")) return "Edge";
  if (s.includes("chrome") && !s.includes("edg/")) return "Chrome";
  if (s.includes("firefox")) return "Firefox";
  if (s.includes("safari") && !s.includes("chrome")) return "Safari";
  return "متصفح آخر";
}

/** رمز محرف تحكم يجب إسقاطه (عدا الجدولة 9 والسطر الجديد 10) */
function isDroppableControl(code: number): boolean {
  if (code === 9 || code === 10) return false; // احتفظ بالجدولة والسطر الجديد
  return code < 32 || code === 127;
}

/**
 * تنقية نص الإدخال قبل التخزين: إزالة محارف التحكم (عدا السطر الجديد والجدولة)، قص الطول.
 * دفاع في العمق فوق هروب React التلقائي — لا يُخزَّن HTML ولا سكربتات.
 */
export function sanitizeFeedbackText(input: string | null | undefined, maxLen: number): string {
  if (!input) return "";
  const normalized = String(input).replace(/\r\n?/g, "\n");
  let out = "";
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isDroppableControl(code)) out += ch;
  }
  return out.trim().slice(0, maxLen);
}

/**
 * يتحقق أن المسار مسار داخلي آمن للتطبيق (يبدأ بشرطة مائلة واحدة، بلا نطاق أو بروتوكول
 * أو محارف تحكم/مسافات). يمنع تخزين روابط مطلقة قد تُستغل كإعادة توجيه.
 */
export function isSafeInternalPath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  if (path.length > 512) return false;
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 32 || code === 127) return false; // محارف تحكم أو مسافات
  }
  return true;
}

/** حدود أطوال الحقول النصية */
export const FEEDBACK_LIMITS = {
  title: 200,
  attempted: 2000,
  happened: 2000,
  expected: 2000,
  note: 2000,
  reason: 2000,
} as const;

/** هل تتطلب هذه الحالة سبباً/ملاحظة موثقة عند الانتقال إليها */
export function statusRequiresNote(status: string): boolean {
  return status === "لن تُنفذ" || status === "تم الحل";
}

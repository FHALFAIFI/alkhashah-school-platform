/**
 * معيار التنقّل الموحّد للمنصة (v2.2 §C).
 *
 * مصدر واحد للحقيقة يحدّد «الصفحة الأب» لكل مسار، فيظهر زر «العودة» في كل صفحة فرعية
 * بسلوك متّسق بدل أزرار متفرقة مكتوبة يدوياً في كل صفحة.
 *
 * القواعد:
 *  - الأب مسار حقيقي موجود في التطبيق (وجهة احتياطية آمنة تعمل عند الفتح المباشر بالرابط).
 *  - الأب دائماً «للأعلى» في الشجرة ولا يساوي المسار نفسه أبداً — فلا تنشأ حلقة تنقّل.
 *  - `/dashboard` هو جذر التطبيق: لا زر عودة فيه (ولا في صفحات المصادقة).
 *  - ما لا يُذكر صراحةً يسقط تلقائياً إلى حذف آخر مقطع من المسار، ثم إلى `/dashboard`.
 *
 * الوحدة خالصة بلا React وبلا وصول لقاعدة البيانات، فتُختبر وحدوياً بلا متصفّح.
 */

/** جذر التطبيق — لا يعرض زر عودة */
export const APP_ROOT = "/dashboard";

/** الوجهة الاحتياطية النهائية حين يتعذّر اشتقاق أب ذي معنى */
const FINAL_FALLBACK = APP_ROOT;

/**
 * المسارات التي لا يظهر فيها زر «العودة»:
 * جذر التطبيق نفسه وصفحات المصادقة (لا يوجد «أعلى» منها).
 */
const NO_BACK: readonly string[] = ["/", APP_ROOT, "/login"];

/**
 * خريطة الأب الصريحة — تُكتب بأنماط مسارات Next.js (`[id]` وغيرها).
 *
 * تُذكر هنا الحالات التي يخطئ فيها حذف آخر مقطع: مثل مسار اجتماع اللجنة الذي أبوه صفحة
 * اللجنة لا مقطع `meetings` (وهو ليس صفحة أصلاً)، وصفحة تقرير البرنامج التي تعود لصفحة
 * البرنامج نفسه لا لقائمة الخطة.
 */
const PARENT_MAP: Readonly<Record<string, string>> = {
  // الخطة والبرامج
  "/plan/[id]": "/plan",
  "/plan/[id]/report": "/plan/[id]",
  "/plan/followup": "/plan",
  "/plan/classifications": "/plan",
  "/plan/kpis": "/plan",
  "/plan/risks": "/plan",
  "/plan/swot": "/plan",

  // اللجان والمجالس
  "/committees/[id]": "/committees",
  // اجتماع اللجنة يعود إلى صفحة اللجنة — «meetings» ليست صفحة
  "/committees/[id]/meetings/[mid]": "/committees/[id]",
  "/committees/[id]/report": "/committees/[id]",
  "/committees/templates": "/committees",
  "/committees/meeting-types": "/committees",
  "/committees/task-templates": "/committees",

  // الأداء الوظيفي
  "/performance/cycles/[id]": "/performance",
  // جلسة التقييم تعود إلى الدورة — «sessions» ليست صفحة
  "/performance/cycles/[id]/sessions/[sid]": "/performance/cycles/[id]",
  "/performance/models": "/performance",
  "/performance/models/[id]": "/performance/models",

  // المبنى والمرافق
  "/building/3d": "/building",
  "/building/report": "/building",
  "/building/scan": "/building",
  "/building/offline": "/building",
  "/building/documents": "/building",
  "/building/facilities": "/building",
  "/building/assets": "/building",
  "/building/maintenance": "/building",
  "/building/inspections": "/building",
  "/building/rooms/[id]": "/building",
  "/building/editor/[floorKey]": "/building",
  "/building/inspections/templates": "/building/inspections",
  "/building/inspections/templates/new": "/building/inspections/templates",
  "/building/inspections/templates/[id]": "/building/inspections/templates",
  "/building/inspections/templates/[id]/edit": "/building/inspections/templates/[id]",

  // المنسوبون
  "/people/[id]": "/people",
  "/people/new": "/people",

  // الشواهد والوثائق والاستيراد
  "/evidence/[id]": "/evidence",
  "/imports/new": "/imports",
  "/imports/[id]": "/imports",

  // التقارير
  "/reports/executive": "/reports",
  // v2.6: أرشيف التقارير المحفوظة وصفحاته
  "/reports/archive": "/reports",
  "/reports/archive/new": "/reports/archive",
  "/reports/archive/[id]": "/reports/archive",

  // المالية — لا صفحة فهرس على `/budget/items`، فتفصيل البند يعود إلى لوحة المالية
  "/budget/items/[id]": "/budget",

  // بلاغ صيانة واحد يعود إلى قائمة البلاغات
  "/building/maintenance/[id]": "/building/maintenance",
  // v2.4.1 §1.2: الفحص أصبح تحت الصيانة، فأبوه صفحة الصيانة لا صفحة الفحص والجاهزية
  "/building/maintenance/inspect": "/building/maintenance",

  // الأداء الوظيفي — اللوحة العامة وتقرير المنسوب
  "/performance/analytics": "/performance",
  "/performance/employees/[personId]": "/performance/analytics",

  // الإدارة — لا توجد صفحة فهرس على `/admin`، فأقسامها تعود إلى جذر التطبيق مباشرةً
  // (حذف آخر مقطع وحده كان سينتج رابطاً إلى صفحة غير موجودة).
  "/admin/users": APP_ROOT,
  "/admin/settings": APP_ROOT,
  "/admin/feedback": APP_ROOT,
  "/admin/audit": APP_ROOT,
  "/admin/cleanup": APP_ROOT,
  "/admin/backup": APP_ROOT,
  "/admin/templates": APP_ROOT,
  "/admin/feedback/[id]": "/admin/feedback",
};

/** مقاطع المسار بلا فراغات — "/a/b/" → ["a","b"] */
function segments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** إزالة الشرطة المائلة الأخيرة (عدا الجذر) وتوحيد المسار قبل المطابقة */
export function normalizePath(pathname: string): string {
  const s = segments(pathname);
  return s.length === 0 ? "/" : `/${s.join("/")}`;
}

/**
 * هل يطابق المسار الفعلي نمط مسار فيه مقاطع ديناميكية؟
 * `[x]` يطابق أي مقطع واحد غير فارغ.
 */
function patternMatches(pattern: string, pathname: string): boolean {
  const p = segments(pattern);
  const a = segments(pathname);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => (seg.startsWith("[") && seg.endsWith("]") ? a[i].length > 0 : seg === a[i]));
}

/**
 * تعبئة نمط الأب بالقيم الفعلية من المسار الحالي.
 * الأب بادئة للنمط الابن دائماً، فتُؤخذ قيم المقاطع الديناميكية من المسار الفعلي بموضعها.
 */
function fillPattern(parentPattern: string, childPattern: string, pathname: string): string {
  const parentSegs = segments(parentPattern);
  const childSegs = segments(childPattern);
  const actualSegs = segments(pathname);
  const out = parentSegs.map((seg, i) => {
    if (!seg.startsWith("[") || !seg.endsWith("]")) return seg;
    // المقطع الديناميكي في الأب يقابل الموضع نفسه في الابن — نأخذ قيمته الفعلية
    if (childSegs[i] === seg && actualSegs[i]) return actualSegs[i];
    return actualSegs[i] ?? seg;
  });
  return `/${out.join("/")}`;
}

/**
 * المسار الأب لصفحة ما، أو `null` إذا كانت الصفحة جذراً لا عودة منه.
 *
 * الترتيب: الخريطة الصريحة ← حذف آخر مقطع ← `/dashboard`. النتيجة لا تساوي المسار
 * الحالي أبداً (حارس صريح ضد حلقة التنقّل).
 */
export function parentRouteFor(pathname: string): string | null {
  const path = normalizePath(pathname);
  if (NO_BACK.includes(path)) return null;

  let parent: string | null = null;
  for (const [childPattern, parentPattern] of Object.entries(PARENT_MAP)) {
    if (patternMatches(childPattern, path)) {
      parent = fillPattern(parentPattern, childPattern, path);
      break;
    }
  }

  if (!parent) {
    const segs = segments(path);
    // حذف آخر مقطع كسقوط افتراضي — صفحة من مقطع واحد أبوها جذر التطبيق
    parent = segs.length > 1 ? `/${segs.slice(0, -1).join("/")}` : FINAL_FALLBACK;
  }

  const normalizedParent = normalizePath(parent);
  // حارس الحلقة: الأب لا يساوي الصفحة نفسها بحال
  if (normalizedParent === path) return FINAL_FALLBACK === path ? null : FINAL_FALLBACK;
  return normalizedParent;
}

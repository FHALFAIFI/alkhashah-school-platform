/**
 * الربط التفاعلي في معاينة التطبيق (v2.6 §A) — وحدة خالصة.
 *
 * الأسماء والأرقام في **معاينة التطبيق** روابط إلى مصادر تفاصيلها؛ الملفات المُصدَّرة
 * تحمل النص وحده. الصفوف مسطّحة بلا معرّفات (تصميم المحمّلات منذ v2.2 يمنع تسرّب
 * الحقول غير المعلَنة)، فالرابط يقصد صفحة المصدر ببحثٍ باسم القيمة — وجهة صحيحة دائماً
 * وإن لم تكن قفزة مباشرة للسجل، ولا يُفبرك رابط لقيمة لا صفحة لها.
 */

const COLUMN_ROUTES: Record<string, (value: string) => string> = {
  // البرامج — بحث باسم البرنامج في صفحة الخطة
  name: (v) => `/plan?search=${encodeURIComponent(v)}`,
  programName: (v) => `/plan?search=${encodeURIComponent(v)}`,
  // المنسوبون
  personName: (v) => `/people?search=${encodeURIComponent(v)}`,
  fullName: (v) => `/people?search=${encodeURIComponent(v)}`,
  owner: (v) => `/people?search=${encodeURIComponent(v)}`,
  // اللجان والاجتماعات
  committeeName: (v) => `/committees?search=${encodeURIComponent(v)}`,
  nameAr: (v) => `/committees?search=${encodeURIComponent(v)}`,
  // الصيانة برمز البلاغ
  code: (v) => `/building/maintenance?search=${encodeURIComponent(v)}`,
  // بنود الصرف
  itemName: (v) => `/budget?search=${encodeURIComponent(v)}`,
};

/** المفاتيح المرتبطة بحسب تقرير القسم — `nameAr` يعني لجنة في تقارير اللجان فقط */
const REPORT_SCOPES: Record<string, string[]> = {
  "committee-summary": ["nameAr", "personName"],
  "committee-registry-detailed": ["committeeName", "personName"],
  "committee-register": ["nameAr"],
  "committee-members": ["committeeName", "personName"],
  "committee-tasks": ["committeeName", "personName"],
  "committees-without-meetings": ["nameAr"],
  "meetings-registry-detailed": ["committeeName"],
  "meetings-register": ["committeeName"],
  "meeting-decisions": ["committeeName"],
  "maintenance-register": ["code", "owner"],
  "employee-register": ["fullName"],
  "employee-missing-data": ["fullName"],
  "employee-committees": ["fullName", "committeeName"],
};

const PROGRAM_REPORT_PREFIXES = ["programs-", "plan-", "program-", "evidence-by-program"];

export function linkForCell(reportKey: string, columnKey: string, value: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "—") return null;

  const scoped = REPORT_SCOPES[reportKey];
  if (scoped) {
    return scoped.includes(columnKey) ? COLUMN_ROUTES[columnKey]?.(text) ?? null : null;
  }
  // تقارير البرامج: اسم البرنامج واسم المسؤول
  if (PROGRAM_REPORT_PREFIXES.some((p) => reportKey.startsWith(p))) {
    if (columnKey === "name" || columnKey === "programName") return COLUMN_ROUTES.programName(text);
    if (columnKey === "owner") return COLUMN_ROUTES.owner(text);
    return null;
  }
  // تقارير الأداء: اسم الموظف
  if (reportKey.startsWith("perf-") && columnKey === "personName") {
    return COLUMN_ROUTES.personName(text);
  }
  // المالية: بند الصرف
  if (columnKey === "itemName") return COLUMN_ROUTES.itemName(text);
  return null;
}

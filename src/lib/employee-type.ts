/**
 * نوع الموظف المعتمد في نطاق المنتج (D-019).
 *
 * الجدول `people` يحمل عمودين:
 *   - `category`      : التصنيف المصدري كما ورد في الاستيراد الرسمي («معلم» | «موظف»).
 *                        لا يُعاد كتابته أبداً — دفعة فارس في «معاينة» معبَّر عنها به،
 *                        وهي دفعة محمية لا يمسّها النظام.
 *   - `employee_type` : النوع المعتمد للعرض والعمل («معلم» | «موظف إداري»)، عمود إضافي.
 *
 * القراءة تمر دائماً عبر `employeeTypeOf` فتُشتق القيمة من `category` حين يكون العمود
 * الجديد فارغاً — فتظهر كل الصفوف القائمة بالمسمى الصحيح دون أي تعديل على بياناتها.
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات — تُستعمل في الخادم والعميل معاً.
 */

export const EMPLOYEE_TYPES = ["معلم", "موظف إداري"] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

/** التصنيف المصدري المقابل لكل نوع — يُكتب في `category` للصفوف الجديدة فقط. */
const CATEGORY_FOR_TYPE: Record<EmployeeType, string> = {
  "معلم": "معلم",
  "موظف إداري": "موظف",
};

export function isEmployeeType(value: string): value is EmployeeType {
  return (EMPLOYEE_TYPES as readonly string[]).includes(value);
}

/** النوع المعتمد لصف قائم — يشتق من `category` عند غياب `employee_type`. */
export function employeeTypeOf(row: { category: string; employeeType?: string | null }): EmployeeType {
  const stored = row.employeeType?.trim();
  if (stored && isEmployeeType(stored)) return stored;
  return row.category === "معلم" ? "معلم" : "موظف إداري";
}

export function categoryForEmployeeType(type: EmployeeType): string {
  return CATEGORY_FOR_TYPE[type];
}

/** النوع المعتمد المقابل لتصنيف مصدري — للاستيراد وشاشات المعاينة. */
export function employeeTypeForCategory(category: string): EmployeeType {
  return category === "معلم" ? "معلم" : "موظف إداري";
}

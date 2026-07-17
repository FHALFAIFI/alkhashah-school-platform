/** حقول معاينة الأشخاص وتسمياتها العربية — تستخدم في صفحة الدفعة وسجل التدقيق */
export const PEOPLE_FIELDS: { key: string; label: string }[] = [
  { key: "fullName", label: "الاسم" },
  { key: "category", label: "الفئة" },
  { key: "jobTitle", label: "الوظيفة" },
  { key: "cadre", label: "السلك/الكادر" },
  { key: "employmentStatus", label: "الحالة" },
  { key: "orgUnit", label: "المرحلة/الجهة" },
  { key: "jobNumber", label: "رقم الوظيفة" },
];

export function peopleFieldLabel(key: string): string {
  return PEOPLE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

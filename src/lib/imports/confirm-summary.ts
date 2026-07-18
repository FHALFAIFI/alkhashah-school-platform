/**
 * ملخص تأكيد التنفيذ حسب نوع الاستيراد — يمنع ظهور تسميات نوع على دفعة من نوع آخر.
 * دفعة الخطة التشغيلية تعرض عدّادات الخطة العربية (برامج/مخرجات/مؤشرات/…)،
 * ولا تعرض إطلاقاً «عدد المعلمين» أو «عدد الموظفين» (تسميات دفعة الأشخاص).
 * دالة نقية بلا وصول لقاعدة البيانات — تُختبر وحدةً وتُستعمل في صفحة الدفعة.
 */

export type ConfirmItem = { label: string; value: number };
export type ConfirmSummary = { title: string; items: ConfirmItem[] };

/** تسميات مجموعات صفوف الخطة التشغيلية — نفس تسميات المعاينة */
const PLAN_GROUP_LABELS: Record<string, string> = {
  program: "البرامج والمبادرات",
  deliverable: "المخرجات المطلوبة",
  kpi: "مؤشرات الأداء",
  risk: "سجل المخاطر",
  budget: "بنود الميزانية",
  roadmap: "خارطة التنفيذ",
};
const PLAN_GROUP_ORDER = ["program", "deliverable", "kpi", "risk", "budget", "roadmap"];

/**
 * يبني ملخص التأكيد من الصفوف الجاهزة فقط + عدد المستبعدين.
 * importType غير المعروف يُعامَل كأشخاص (السلوك الافتراضي التاريخي).
 */
export function buildConfirmSummary(
  importType: string,
  readyRows: { mapped: unknown; validation?: unknown }[],
  excludedCount: number,
): ConfirmSummary {
  if (importType === "operational_plan") {
    const byType = new Map<string, number>();
    for (const r of readyRows) {
      const t = String((r.mapped as { rowType?: string })?.rowType ?? "غير معروف");
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const items: ConfirmItem[] = [{ label: "إجمالي الصفوف الجاهزة", value: readyRows.length }];
    for (const t of PLAN_GROUP_ORDER) {
      if (byType.has(t)) items.push({ label: PLAN_GROUP_LABELS[t], value: byType.get(t)! });
    }
    // أي أنواع غير معروفة تُعرض بمفتاحها كما هو حتى لا تُطمس
    for (const [t, c] of byType) {
      if (!PLAN_GROUP_ORDER.includes(t)) items.push({ label: t, value: c });
    }
    if (excludedCount > 0) items.push({ label: "الصفوف المستبعدة", value: excludedCount });
    return { title: "تأكيد استيراد الخطة التشغيلية — راجع عدّادات الخطة قبل الموافقة النهائية", items };
  }

  // الأشخاص (السلوك الافتراضي)
  const teachers = readyRows.filter(
    (r) => (r.mapped as { category?: string })?.category === "معلم",
  ).length;

  // فحوصات أمان تُعرض للمدير قبل الموافقة النهائية (حساب نقي من الصفوف الجاهزة):
  // — أرقام وظيفية مكررة: مجموع الفائض عن أول ظهور لكل رقم وظيفي غير فارغ.
  const jobCounts = new Map<string, number>();
  for (const r of readyRows) {
    const jn = String((r.mapped as { jobNumber?: string })?.jobNumber ?? "").trim();
    if (jn) jobCounts.set(jn, (jobCounts.get(jn) ?? 0) + 1);
  }
  let duplicateJobNumbers = 0;
  for (const c of jobCounts.values()) if (c > 1) duplicateJobNumbers += c - 1;

  // — صفوف بحقول إلزامية ناقصة (الاسم/الرقم الوظيفي/التصنيف).
  const missingMandatory = readyRows.filter((r) => {
    const m = r.mapped as { fullName?: string; jobNumber?: string; category?: string };
    return !String(m?.fullName ?? "").trim() || !String(m?.jobNumber ?? "").trim() || !String(m?.category ?? "").trim();
  }).length;

  // — تصنيفات (معلم/موظف) روجعت يدوياً: صفوف حملت تنبيه «التصنيف غير مؤكد» وأكّدها المدير.
  const reviewedClassifications = readyRows.filter((r) => {
    const warnings = (r.validation as { warnings?: unknown[] })?.warnings;
    return Array.isArray(warnings) && warnings.some((w) => typeof w === "string" && w.includes("التصنيف") && w.includes("غير مؤكد"));
  }).length;

  const items: ConfirmItem[] = [
    { label: "عدد الصفوف الجاهزة (سجلات منسوبين ستُنشأ)", value: readyRows.length },
    { label: "عدد المعلمين", value: teachers },
    { label: "عدد الموظفين", value: readyRows.length - teachers },
    { label: "تصنيفات روجعت يدوياً (معلم/موظف)", value: reviewedClassifications },
    { label: "أرقام وظيفية مكررة", value: duplicateJobNumbers },
    { label: "صفوف بحقول إلزامية ناقصة", value: missingMandatory },
    { label: "عدد المستبعدين", value: excludedCount },
  ];
  return { title: "تأكيد استيراد بيانات الموظفين — راجع ملخص الدفعة قبل الموافقة النهائية", items };
}

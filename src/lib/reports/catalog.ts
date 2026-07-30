/**
 * فهرس التقارير المركزي (v2.2 §D) — **سجل واحد** يعرّف كل تقرير في المنصة.
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات: تُستعمل على الخادم والعميل معاً وتُختبر وحدوياً.
 * محمّلات البيانات في `./loaders` (server-only) وتُربط بالمفتاح نفسه، فلا يوجد قسم
 * يبني محرّك تقارير خاصاً به.
 */

/** أعمدة التقرير — النوع يحدّد التنسيق ومحاذاة العرض والتصدير */
export type ColumnType = "text" | "number" | "money" | "date" | "percent";

export type ReportColumn = {
  key: string;
  label: string;
  type?: ColumnType;
};

/** مرشّحات موحّدة لكل التقارير — كلها اختيارية */
export type ReportFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  personId?: string;
  itemId?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type ReportRow = Record<string, string | number | null>;

export type CategoryKey =
  | "plan"
  | "evidence"
  | "finance"
  | "performance"
  | "committees"
  | "meetings"
  | "building"
  | "employees"
  | "risks"
  | "external"
  | "documents"
  | "imports"
  | "usage";

export type ReportCategory = {
  key: CategoryKey;
  label: string;
  description: string;
  /** الصلاحية اللازمة لرؤية هذه الفئة أصلاً */
  permission: string;
};

/** الفئات الثلاث عشرة المطلوبة (§D) */
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  { key: "plan", label: "الخطة والبرامج", description: "البرامج النشطة والمغلقة والمؤرشفة وتقدمها وحالتها وسجل إقفالها", permission: "plan.read" },
  { key: "evidence", label: "الشواهد", description: "الشواهد حسب البرنامج والنوع وتواريخ الرفع والبرامج بلا شواهد", permission: "evidence.read" },
  { key: "finance", label: "المالية والميزانية", description: "سجل الإيرادات والمصروفات وبنود الصرف والمخصصات والفواتير والاتجاه الشهري", permission: "budget.read" },
  { key: "performance", label: "الأداء الوظيفي", description: "جلسات التخطيط والتقييمات والتوصيات ونواقص التقييم", permission: "performance.read" },
  { key: "committees", label: "اللجان والمجالس", description: "سجل اللجان والأعضاء والمهام ووثائق التكليف الصادرة", permission: "committees.read" },
  { key: "meetings", label: "الاجتماعات والقرارات", description: "الاجتماعات والمحاضر والقرارات والتوصيات", permission: "committees.read" },
  { key: "building", label: "المبنى والمرافق", description: "الأدوار والغرف والمرافق والصيانة والأصول والفحوصات", permission: "building.read" },
  { key: "employees", label: "الموظفون", description: "سجل المنسوبين وحالاتهم وعضوياتهم ونواقص البيانات", permission: "people.read" },
  // التحليل الرباعي صار له نموذج بيانات (`plan_swot_items`) يُستورد من ورقة «التحليل الرباعي»
  // الرسمية في مصنف الخطة، فله تقاريره هنا. لا تقرير يُبنى على بيانات غير موجودة.
  { key: "risks", label: "المخاطر والتحليل الرباعي", description: "سجل المخاطر ودرجاتها ومعالجتها، وعناصر التحليل الرباعي (القوة والضعف والفرص والتهديدات)", permission: "plan.read" },
  { key: "external", label: "التقييم الخارجي", description: "نتائج التقييم الخارجي ومجالات التحسين وخطط التحسين", permission: "plan.read" },
  { key: "documents", label: "الوثائق والمرفقات", description: "الوثائق الصادرة والمرفقات وأنواع الملفات والوثائق المجمّدة", permission: "documents.read" },
  { key: "imports", label: "الاستيراد وجودة البيانات", description: "دفعات الاستيراد وصفوفها وحالات التحقق ونواقص البيانات", permission: "imports.read" },
  { key: "usage", label: "سجل الاستخدام والعمليات", description: "سجل التدقيق والعمليات الحساسة وتصدير التقارير", permission: "admin.audit.read" },
] as const;

export function categoryByKey(key: string): ReportCategory | undefined {
  return REPORT_CATEGORIES.find((c) => c.key === key);
}

/** تعريف تقرير واحد — البيانات تأتي من المحمّل المطابق للمفتاح في `./loaders` */
export type ReportDefinition = {
  key: string;
  category: CategoryKey;
  label: string;
  description: string;
  /** الصلاحية اللازمة لتشغيل هذا التقرير تحديداً */
  permission: string;
  columns: ReportColumn[];
  /** مرشّحات ذات معنى لهذا التقرير — تُعرض وحدها فلا يظهر مرشّح لا أثر له */
  filters?: ("search" | "dateRange" | "status" | "person" | "item")[];
};

const col = (key: string, label: string, type: ColumnType = "text"): ReportColumn => ({ key, label, type });

/**
 * سجل التقارير. كل تقرير يعتمد بيانات موجودة فعلاً في المنصة — لا تقارير وهمية.
 *
 * ملاحظة نطاق (D1): لا تُعاد الأنشطة التشغيلية ولا المعالم ولا الأوزان ولا نسبة جاهزية
 * الإقفال ولا حصص الشواهد إلى التقارير (D-024/D-025).
 */
export const REPORTS: readonly ReportDefinition[] = [
  /* ── الخطة والبرامج ─────────────────────────────────────────── */
  {
    key: "programs-active",
    category: "plan",
    label: "البرامج النشطة",
    description: "البرامج غير المغلقة وغير المؤرشفة مع تقدمها وحالتها ومسؤولها",
    permission: "plan.read",
    columns: [col("seq", "م", "number"), col("name", "البرنامج"), col("domain", "المجال"), col("owner", "مسؤول التنفيذ"), col("progress", "الإنجاز", "percent"), col("executionStatus", "حالة التنفيذ"), col("status", "الحالة")],
    filters: ["search", "status"],
  },
  {
    key: "programs-completed",
    category: "plan",
    label: "البرامج المكتملة",
    description: "البرامج المعلَّمة كمكتملة (غير المغلقة) مع تاريخ الاكتمال وملاحظته",
    permission: "plan.read",
    columns: [col("seq", "م", "number"), col("name", "البرنامج"), col("domain", "المجال"), col("completedAt", "تاريخ الاكتمال", "date"), col("completionNote", "ملاحظة الاكتمال"), col("progress", "الإنجاز", "percent")],
    filters: ["search", "dateRange"],
  },
  {
    key: "programs-closed",
    category: "plan",
    label: "البرامج المغلقة",
    description: "البرامج التي أُقفلت نهائياً مع تاريخ الإقفال وملاحظته",
    permission: "plan.read",
    columns: [col("seq", "م", "number"), col("name", "البرنامج"), col("domain", "المجال"), col("closedAt", "تاريخ الإقفال", "date"), col("closureNote", "ملاحظة الإقفال"), col("progress", "الإنجاز عند الإقفال", "percent")],
    filters: ["search", "dateRange"],
  },
  {
    key: "programs-archived",
    category: "plan",
    label: "البرامج المؤرشفة",
    description: "البرامج المخفاة بحذف ناعم مع سبب الأرشفة — قابلة للاسترجاع",
    permission: "plan.read",
    columns: [col("seq", "م", "number"), col("name", "البرنامج"), col("domain", "المجال"), col("archivedAt", "تاريخ الأرشفة", "date"), col("archivedReason", "سبب الأرشفة")],
    filters: ["search", "dateRange"],
  },
  {
    key: "programs-reopened",
    category: "plan",
    label: "البرامج المعاد فتحها",
    description: "البرامج التي أُعيد فتحها بعد إقفالها",
    permission: "plan.read",
    columns: [col("seq", "م", "number"), col("name", "البرنامج"), col("reopenedAt", "تاريخ إعادة الفتح", "date")],
    filters: ["search", "dateRange"],
  },
  {
    key: "program-closure-history",
    category: "plan",
    label: "سجل تحولات حالة البرامج",
    description: "التسلسل التاريخي الكامل لكل اكتمال وإقفال وإعادة فتح وإعادة للتنفيذ",
    permission: "plan.read",
    columns: [col("programName", "البرنامج"), col("action", "الإجراء"), col("fromStatus", "من حالة"), col("toStatus", "إلى حالة"), col("at", "التاريخ", "date"), col("note", "الملاحظة"), col("actor", "المنفّذ")],
    filters: ["search", "dateRange"],
  },
  {
    key: "programs-by-domain",
    category: "plan",
    label: "البرامج حسب المجال",
    description: "توزيع البرامج على المجالات مع متوسط الإنجاز",
    permission: "plan.read",
    columns: [col("domain", "المجال"), col("count", "عدد البرامج", "number"), col("avgProgress", "متوسط الإنجاز", "percent"), col("closedCount", "المغلقة", "number")],
  },
  {
    key: "programs-by-owner",
    category: "plan",
    label: "البرامج حسب المسؤول",
    description: "توزيع البرامج على مسؤولي التنفيذ",
    permission: "plan.read",
    columns: [col("owner", "مسؤول التنفيذ"), col("count", "عدد البرامج", "number"), col("avgProgress", "متوسط الإنجاز", "percent")],
  },
  {
    key: "programs-without-evidence",
    category: "plan",
    label: "برامج بلا شواهد",
    description: "برامج لم يُرفع لها أي شاهد — معلوماتي بلا حصة أو إلزام (D-025)",
    permission: "plan.read",
    columns: [col("seq", "م", "number"), col("name", "البرنامج"), col("domain", "المجال"), col("status", "الحالة")],
    filters: ["search"],
  },
  {
    key: "plan-kpis",
    category: "plan",
    label: "مؤشرات الأداء",
    description: "مؤشرات الخطة بخط الأساس والمستهدف والدورية ومصدر البيانات ومسؤولها",
    permission: "plan.read",
    columns: [col("code", "الرمز"), col("nameAr", "المؤشر"), col("baseline", "خط الأساس"), col("target", "المستهدف"), col("periodicity", "الدورية"), col("owner", "المسؤول"), col("dataSource", "مصدر البيانات")],
    filters: ["search"],
  },
  {
    key: "plan-followups",
    category: "plan",
    label: "المتابعة الأسبوعية",
    description: "ملاحظات المتابعة الأسبوعية للبرامج مع لقطة التقدم وحالة التنفيذ",
    permission: "plan.read",
    columns: [col("weekKey", "الأسبوع"), col("programName", "البرنامج"), col("executionStatus", "حالة التنفيذ"), col("progressSnapshot", "التقدم", "percent"), col("note", "الملاحظة"), col("createdAt", "التاريخ", "date")],
    filters: ["search", "dateRange", "status"],
  },
  {
    key: "action-tasks",
    category: "plan",
    label: "المهام والإجراءات",
    description: "المهام المنبثقة عن القرارات والبرامج والفحوصات بحالتها ومسؤولها وموعدها",
    permission: "tasks.read",
    columns: [col("title", "المهمة"), col("owner", "المسؤول"), col("status", "الحالة"), col("priority", "الأولوية"), col("progress", "الإنجاز", "percent"), col("dueDate", "الاستحقاق", "date"), col("sourceType", "المصدر")],
    filters: ["search", "status", "dateRange"],
  },
  {
    key: "calendar-events",
    category: "plan",
    label: "التقويم الدراسي",
    description: "أحداث التقويم المعتمد بتواريخها الهجرية والميلادية وأثرها وإجراء المدرسة",
    permission: "calendar.read",
    columns: [col("nameAr", "الحدث"), col("hijriFrom", "من (هجري)"), col("hijriTo", "إلى (هجري)"), col("gregorianText", "الميلادي"), col("impact", "الأثر"), col("schoolAction", "إجراء المدرسة")],
    filters: ["search"],
  },

  /* ── الشواهد ───────────────────────────────────────────────── */
  {
    key: "evidence-register",
    category: "evidence",
    label: "سجل الشواهد",
    description: "كل الشواهد مع نوعها ومصدرها وتاريخها والمرفوع بواسطته",
    permission: "evidence.read",
    columns: [col("title", "الشاهد"), col("kind", "النوع"), col("evidenceType", "التصنيف"), col("evidenceDate", "التاريخ", "date"), col("createdAt", "تاريخ الرفع", "date"), col("linkCount", "الارتباطات", "number")],
    filters: ["search", "dateRange"],
  },
  {
    key: "evidence-by-type",
    category: "evidence",
    label: "الشواهد حسب النوع",
    description: "توزيع الشواهد على الأنواع مع أحدث تاريخ رفع",
    permission: "evidence.read",
    columns: [col("kind", "النوع"), col("count", "العدد", "number"), col("latest", "أحدث رفع", "date")],
  },
  {
    key: "evidence-by-program",
    category: "evidence",
    label: "الشواهد حسب البرنامج",
    description: "عدد الشواهد المرتبطة بكل برنامج وأحدث تاريخ رفع",
    permission: "evidence.read",
    columns: [col("programName", "البرنامج"), col("count", "عدد الشواهد", "number"), col("latest", "أحدث رفع", "date")],
    filters: ["search"],
  },
  {
    key: "evidence-file-types",
    category: "evidence",
    label: "توزيع أنواع الملفات",
    description: "أنواع الملفات المرفوعة وأحجامها",
    permission: "evidence.read",
    columns: [col("mime", "نوع الملف"), col("count", "العدد", "number"), col("totalSize", "الحجم الكلي", "number")],
  },

  /* ── المالية والميزانية ────────────────────────────────────── */
  {
    key: "income-register",
    category: "finance",
    label: "سجل الإيرادات",
    description: "كل الإيرادات مع مصدرها ومبلغها وبندها وحالتها",
    permission: "budget.read",
    columns: [col("source", "المصدر"), col("amount", "المبلغ", "money"), col("incomeDate", "التاريخ", "date"), col("itemName", "البند"), col("status", "الحالة"), col("hasInvoice", "إيصال مرفق")],
    filters: ["search", "dateRange", "status", "item"],
  },
  {
    key: "expense-register",
    category: "finance",
    label: "سجل المصروفات",
    description: "كل المصروفات مع مبلغها وبندها ورقم فاتورتها ومورّدها",
    permission: "budget.read",
    columns: [col("amount", "المبلغ", "money"), col("expenseDate", "التاريخ", "date"), col("itemName", "البند"), col("paymentReference", "رقم الفاتورة"), col("supplier", "المورّد"), col("hasInvoice", "فاتورة مرفقة")],
    filters: ["search", "dateRange", "item"],
  },
  {
    key: "item-allocations",
    category: "finance",
    label: "المخصص والمنفَق والمتبقي لكل بند",
    description: "لكل بند صرف: مخصصه وإيراده ومصروفه ومتبقيه ونسبة إنفاقه",
    permission: "budget.read",
    columns: [col("name", "البند"), col("allocated", "المخصص", "money"), col("income", "الإيراد", "money"), col("expenses", "المصروف", "money"), col("remaining", "المتبقي", "money"), col("spentPercent", "٪ الإنفاق", "percent"), col("state", "الحالة")],
  },
  {
    key: "over-budget",
    category: "finance",
    label: "البنود المتجاوزة للمخصص",
    description: "البنود التي تجاوز مصروفها مخصصها مع مقدار التجاوز",
    permission: "budget.read",
    columns: [col("name", "البند"), col("allocated", "المخصص", "money"), col("expenses", "المصروف", "money"), col("overrun", "مقدار التجاوز", "money")],
  },
  {
    key: "missing-invoice",
    category: "finance",
    label: "عمليات بدون فاتورة",
    description: "العمليات المالية التي لم تُرفق لها فاتورة أو إيصال — معلوماتي لا إلزامي",
    permission: "budget.read",
    columns: [col("kind", "النوع"), col("amount", "المبلغ", "money"), col("date", "التاريخ", "date"), col("itemName", "البند"), col("reference", "المرجع")],
    filters: ["dateRange", "item"],
  },
  {
    key: "invoice-register",
    category: "finance",
    label: "سجل الفواتير المرفقة",
    description: "العمليات التي أُرفقت لها فاتورة أو إيصال",
    permission: "budget.read",
    columns: [col("kind", "النوع"), col("amount", "المبلغ", "money"), col("date", "التاريخ", "date"), col("itemName", "البند"), col("reference", "المرجع")],
    filters: ["dateRange", "item"],
  },
  {
    key: "all-operations",
    category: "finance",
    label: "كل العمليات المالية",
    description: "الإيرادات والمصروفات في سجل واحد مرتّب زمنياً",
    permission: "budget.read",
    columns: [col("kind", "النوع"), col("amount", "المبلغ", "money"), col("date", "التاريخ", "date"), col("itemName", "البند"), col("description", "البيان"), col("hasInvoice", "فاتورة")],
    filters: ["search", "dateRange", "item"],
  },
  {
    key: "monthly-trend",
    category: "finance",
    label: "الاتجاه الشهري للإيراد والمصروف",
    description: "مجاميع كل شهر للإيراد المستلم والمصروف",
    permission: "budget.read",
    columns: [col("month", "الشهر"), col("income", "الإيراد", "money"), col("expenses", "المصروف", "money"), col("net", "الصافي", "money")],
  },
  {
    key: "finance-archived",
    category: "finance",
    label: "العمليات المؤرشفة والملغاة",
    description: "العمليات المؤرشفة والإيرادات الملغاة — خارج المجاميع الجارية",
    permission: "budget.read",
    columns: [col("kind", "النوع"), col("amount", "المبلغ", "money"), col("date", "التاريخ", "date"), col("state", "الحالة")],
    filters: ["dateRange"],
  },

  /* ── الأداء الوظيفي ────────────────────────────────────────── */
  {
    key: "perf-planning-sessions",
    category: "performance",
    label: "جلسات التخطيط",
    description: "جلسات التخطيط — مستثناة من احتساب المؤشرات وتُعرض «لم يبدأ التقييم بعد»",
    permission: "performance.read",
    columns: [col("personName", "الموظف"), col("cycleType", "الدورة"), col("stage", "المرحلة"), col("state", "الحالة")],
    filters: ["search", "person"],
  },
  {
    key: "perf-evaluations",
    category: "performance",
    label: "التقييمات",
    description: "جلسات التقييم المنتصفية والنهائية وحالاتها",
    permission: "performance.read",
    columns: [col("personName", "الموظف"), col("cycleType", "الدورة"), col("stage", "المرحلة"), col("status", "الحالة"), col("sessionResult", "النتيجة"), col("completedAt", "تاريخ الاكتمال", "date")],
    filters: ["search", "status", "person", "dateRange"],
  },
  {
    key: "perf-incomplete",
    category: "performance",
    label: "التقييمات غير المكتملة",
    description: "الجلسات التي لم تُقفل بعد",
    permission: "performance.read",
    columns: [col("personName", "الموظف"), col("cycleType", "الدورة"), col("stage", "المرحلة"), col("status", "الحالة")],
    filters: ["search", "person"],
  },
  {
    key: "perf-evidence-counts",
    category: "performance",
    label: "عدد الشواهد لكل جلسة",
    description: "عدد شواهد كل جلسة — معلوماتي، والإقفال لا يشترط شاهداً",
    permission: "performance.read",
    columns: [col("personName", "الموظف"), col("stage", "المرحلة"), col("evidenceCount", "عدد الشواهد", "number"), col("status", "الحالة")],
    filters: ["search", "person"],
  },

  /* ── اللجان والمجالس ───────────────────────────────────────── */
  {
    key: "committee-register",
    category: "committees",
    label: "سجل اللجان والمجالس",
    description: "كل اللجان مع نوعها وحالتها وعدد أعضائها واجتماعاتها",
    permission: "committees.read",
    columns: [col("nameAr", "اللجنة"), col("kind", "النوع"), col("status", "الحالة"), col("memberCount", "الأعضاء", "number"), col("meetingCount", "الاجتماعات", "number")],
    filters: ["search", "status"],
  },
  {
    key: "committee-members",
    category: "committees",
    label: "أعضاء اللجان",
    description: "عضويات اللجان بأسماء الأعضاء وأدوارهم",
    permission: "committees.read",
    columns: [col("committeeName", "اللجنة"), col("personName", "العضو"), col("role", "الدور")],
    filters: ["search", "person"],
  },
  {
    key: "committee-tasks",
    category: "committees",
    label: "مهام اللجان",
    description: "المهام الموزّعة على أعضاء اللجان",
    permission: "committees.read",
    columns: [col("committeeName", "اللجنة"), col("personName", "المكلَّف"), col("taskText", "المهمة")],
    filters: ["search", "person"],
  },
  {
    key: "committees-without-meetings",
    category: "committees",
    label: "لجان بلا اجتماعات",
    description: "اللجان التي لم يُسجَّل لها أي اجتماع",
    permission: "committees.read",
    columns: [col("nameAr", "اللجنة"), col("status", "الحالة"), col("memberCount", "الأعضاء", "number")],
  },

  /* ── الاجتماعات والقرارات ──────────────────────────────────── */
  {
    key: "meetings-register",
    category: "meetings",
    label: "سجل الاجتماعات",
    description: "الاجتماعات مع لجنتها وتاريخها ومكانها وحالتها وعدد قراراتها",
    permission: "committees.read",
    columns: [col("committeeName", "اللجنة"), col("title", "الاجتماع"), col("meetingDate", "التاريخ", "date"), col("location", "المكان"), col("status", "الحالة"), col("outcomeCount", "القرارات", "number")],
    filters: ["search", "dateRange", "status"],
  },
  {
    key: "meeting-decisions",
    category: "meetings",
    label: "القرارات والتوصيات",
    description: "قرارات وتوصيات الاجتماعات",
    permission: "committees.read",
    columns: [col("committeeName", "اللجنة"), col("meetingTitle", "الاجتماع"), col("meetingDate", "التاريخ", "date"), col("outcomeText", "القرار/التوصية")],
    filters: ["search", "dateRange"],
  },

  /* ── المبنى والمرافق ───────────────────────────────────────── */
  {
    key: "rooms-register",
    category: "building",
    label: "سجل الغرف",
    description: "الغرف بأدوارها وأنواعها وسعتها وحالتها",
    permission: "building.read",
    columns: [col("code", "الرمز"), col("nameAr", "الغرفة"), col("floorName", "الدور"), col("roomType", "النوع"), col("capacity", "السعة", "number"), col("areaM2", "المساحة", "number"), col("status", "الحالة")],
    filters: ["search"],
  },
  {
    key: "facilities-register",
    category: "building",
    label: "سجل المرافق",
    description: "المرافق المدرسية وحالتها",
    permission: "building.read",
    columns: [col("facilityType", "المرفق"), col("kind", "النوع"), col("status", "الحالة"), col("requiredQty", "المطلوب", "number")],
    filters: ["search"],
  },
  {
    key: "maintenance-register",
    category: "building",
    label: "بلاغات الصيانة",
    description: "بلاغات الصيانة وحالتها وأولويتها",
    permission: "maintenance.read",
    columns: [col("title", "البلاغ"), col("roomName", "الموقع"), col("priority", "الأولوية"), col("status", "الحالة"), col("createdAt", "تاريخ البلاغ", "date")],
    filters: ["search", "status", "dateRange"],
  },
  {
    key: "assets-register",
    category: "building",
    label: "سجل الأصول والعهد",
    description: "الأصول بمواقعها وحالتها",
    permission: "assets.read",
    columns: [col("code", "الرمز"), col("nameAr", "الأصل"), col("category", "التصنيف"), col("roomName", "الموقع"), col("condition", "الحالة"), col("quantity", "الكمية", "number")],
    filters: ["search"],
  },

  /* ── الموظفون ──────────────────────────────────────────────── */
  {
    key: "employee-register",
    category: "employees",
    label: "سجل المنسوبين",
    description: "المعلمون والموظفون بأنواعهم وحالاتهم",
    permission: "people.read",
    columns: [col("fullName", "الاسم"), col("employeeType", "النوع"), col("jobTitle", "المسمى"), col("orgUnit", "الوحدة"), col("status", "الحالة")],
    filters: ["search", "status"],
  },
  {
    key: "employee-missing-data",
    category: "employees",
    label: "نواقص بيانات المنسوبين",
    description: "السجلات التي تنقصها حقول أساسية — معلوماتي، والحقول اختيارية",
    permission: "people.read",
    columns: [col("fullName", "الاسم"), col("missing", "الحقول الناقصة")],
    filters: ["search"],
  },
  {
    key: "employee-committees",
    category: "employees",
    label: "عضويات المنسوبين في اللجان",
    description: "عدد اللجان التي ينتمي إليها كل منسوب",
    permission: "people.read",
    columns: [col("fullName", "الاسم"), col("committeeCount", "عدد اللجان", "number"), col("committees", "اللجان")],
    filters: ["search"],
  },

  /* ── المخاطر والتحليل الرباعي ──────────────────────────────── */
  {
    key: "risk-register",
    category: "risks",
    label: "سجل المخاطر",
    description: "المخاطر بدرجاتها وتصنيفها ومعالجتها ومسؤولها",
    permission: "plan.read",
    columns: [col("code", "الرمز"), col("risk", "الخطر"), col("likelihood", "الاحتمال"), col("impact", "الأثر"), col("classification", "التصنيف"), col("treatment", "المعالجة"), col("owner", "المسؤول")],
    filters: ["search", "status"],
  },
  {
    key: "swot-register",
    category: "risks",
    label: "سجل التحليل الرباعي",
    description: "عناصر القوة والضعف والفرص والتهديدات ودلالتها الاستراتيجية — من ورقة «التحليل الرباعي» الرسمية",
    permission: "plan.read",
    columns: [col("category", "النوع"), col("code", "الرمز"), col("item", "العنصر"), col("implication", "الدلالة الاستراتيجية"), col("planYear", "السنة")],
    filters: ["search", "status"],
  },
  {
    key: "swot-by-category",
    category: "risks",
    label: "التحليل الرباعي حسب النوع",
    description: "عدد عناصر كل نوع في التحليل الرباعي",
    permission: "plan.read",
    columns: [col("category", "النوع"), col("count", "العدد", "number")],
  },

  /* ── التقييم الخارجي ───────────────────────────────────────── */
  {
    key: "improvement-plans",
    category: "external",
    label: "خطط التحسين",
    description: "خطط التحسين المنبثقة عن جلسات الأداء والتقييم",
    permission: "plan.read",
    columns: [col("title", "الخطة"), col("goals", "الأهداف"), col("actions", "الإجراءات"), col("status", "الحالة"), col("createdAt", "التاريخ", "date")],
    filters: ["search", "status"],
  },

  /* ── الوثائق والمرفقات ─────────────────────────────────────── */
  {
    key: "documents-register",
    category: "documents",
    label: "سجل الوثائق الصادرة",
    description: "الوثائق الصادرة بأرقامها ورموز تحققها ولقطاتها المجمّدة",
    permission: "documents.read",
    columns: [col("docNumber", "رقم الوثيقة"), col("docType", "النوع"), col("title", "العنوان"), col("issuedAt", "تاريخ الإصدار", "date"), col("verificationCode", "رمز التحقق")],
    filters: ["search", "dateRange"],
  },
  {
    key: "files-register",
    category: "documents",
    label: "سجل الملفات المرفوعة",
    description: "الملفات المخزَّنة بأنواعها وأحجامها وتواريخ رفعها",
    permission: "documents.read",
    columns: [col("originalName", "الملف"), col("mime", "النوع"), col("size", "الحجم", "number"), col("createdAt", "تاريخ الرفع", "date")],
    filters: ["search", "dateRange"],
  },

  /* ── الاستيراد وجودة البيانات ──────────────────────────────── */
  {
    key: "import-batches",
    category: "imports",
    label: "دفعات الاستيراد",
    description: "دفعات الاستيراد وحالاتها وعدد صفوفها",
    permission: "imports.read",
    columns: [col("importType", "النوع"), col("fileName", "الملف"), col("status", "الحالة"), col("rowCount", "الصفوف", "number"), col("createdAt", "التاريخ", "date")],
    filters: ["search", "status", "dateRange"],
  },
  {
    key: "import-row-quality",
    category: "imports",
    label: "جودة صفوف الاستيراد",
    description: "توزيع حالات صفوف الاستيراد (جاهز/تحذير/خطأ)",
    permission: "imports.read",
    columns: [col("batchKind", "الدفعة"), col("state", "الحالة"), col("count", "العدد", "number")],
  },

  /* ── سجل الاستخدام والعمليات ───────────────────────────────── */
  {
    key: "audit-log",
    category: "usage",
    label: "سجل التدقيق",
    description: "العمليات المسجّلة بمنفّذها وتاريخها",
    permission: "admin.audit.read",
    columns: [col("action", "العملية"), col("entityType", "الكيان"), col("summary", "البيان"), col("actor", "المنفّذ"), col("createdAt", "التاريخ", "date")],
    filters: ["search", "dateRange"],
  },
  {
    key: "export-audit",
    category: "usage",
    label: "سجل تصدير التقارير",
    description: "من صدّر أي تقرير ومتى وبأي صيغة",
    permission: "admin.audit.read",
    columns: [col("summary", "التقرير"), col("actor", "المنفّذ"), col("createdAt", "التاريخ", "date")],
    filters: ["search", "dateRange"],
  },
  {
    key: "feedback-register",
    category: "usage",
    label: "سجل الملاحظات والبلاغات",
    description: "ملاحظات التشغيل المُبلَّغة من داخل المنصة بوحداتها وفئاتها وحالتها",
    // لا يُعرض نص الملاحظة الحساس ولا المرفق — العنوان والتصنيف والحالة فقط
    permission: "feedback.manage",
    columns: [col("ref", "الرقم"), col("module", "الوحدة"), col("category", "الفئة"), col("severity", "الأهمية"), col("title", "العنوان"), col("status", "الحالة"), col("createdAt", "التاريخ", "date")],
    filters: ["search", "status", "dateRange"],
  },
] as const;

export function reportByKey(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}

export function reportsInCategory(category: CategoryKey): ReportDefinition[] {
  return REPORTS.filter((r) => r.category === category);
}

/**
 * أعمدة مسموح الترتيب بها لتقرير ما — قائمة بيضاء تمنع تمرير اسم عمود عشوائي
 * من عنوان URL إلى الترتيب (حماية من الحقن وكشف الأعمدة).
 */
export function isSortableColumn(reportKey: string, column: string): boolean {
  const def = reportByKey(reportKey);
  if (!def) return false;
  return def.columns.some((c) => c.key === column);
}

/** الربط العميق: رابط فئة/تقرير مع مرشّحاته */
export function reportHref(categoryKey: CategoryKey, reportKey?: string, params?: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  sp.set("category", categoryKey);
  if (reportKey) sp.set("report", reportKey);
  for (const [k, v] of Object.entries(params ?? {})) if (v) sp.set(k, v);
  return `/reports?${sp.toString()}`;
}

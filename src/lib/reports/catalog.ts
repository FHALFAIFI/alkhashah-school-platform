/**
 * فهرس التقارير المركزي (v2.2 §D) — **سجل واحد** يعرّف كل تقرير في المنصة.
 *
 * وحدة خالصة بلا وصول لقاعدة البيانات: تُستعمل على الخادم والعميل معاً وتُختبر وحدوياً.
 * محمّلات البيانات في `./loaders` (server-only) وتُربط بالمفتاح نفسه، فلا يوجد قسم
 * يبني محرّك تقارير خاصاً به.
 */

import type { FilterKey as FilterKeyName, ReportMode as ReportModeName } from "./filters";

/** أعمدة التقرير — النوع يحدّد التنسيق ومحاذاة العرض والتصدير */
export type ColumnType = "text" | "number" | "money" | "date" | "percent";

export type ReportColumn = {
  key: string;
  label: string;
  type?: ColumnType;
};

/**
 * المرشّحات الموحّدة عرّفها `./filters` (v2.5.0 §3) — إطار واحد تستعمله الشاشة والتصدير
 * ومنشئ التقارير معاً. تُعاد هنا كي تبقى الاستيرادات القائمة من `catalog` صالحة.
 */
export type { ReportFilters, FilterKey } from "./filters";

/**
 * مصادر بيانات منشئ التقارير (§4.1) — كل مصدر يقابل مجال أعمال واحداً، ويشترك تقرير
 * واحد أو أكثر في المصدر نفسه فلا يوجد محرّك تقارير ثانٍ.
 */
export const REPORT_SOURCES = {
  programs: "البرامج التشغيلية",
  "weekly-followup": "المتابعة الأسبوعية",
  evidence: "شواهد البرامج",
  approvals: "اعتمادات البرامج",
  budget: "الميزانية والمصروفات",
  employees: "الموظفون",
  "perf-cycles": "دورات الأداء",
  "perf-results": "نتائج الأداء",
  committees: "المجالس واللجان",
  "committee-tasks": "مهام اللجان",
  meetings: "الاجتماعات",
  decisions: "القرارات والتوصيات",
  maintenance: "الصيانة",
  inspections: "الفحوصات",
} as const;

export type ReportSource = keyof typeof REPORT_SOURCES;

export function isReportSource(value: string): value is ReportSource {
  return Object.prototype.hasOwnProperty.call(REPORT_SOURCES, value);
}

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

/**
 * أقسام صفحة التقارير (v2.5.0 §14) — تجميع مجالي فوق الفئات.
 *
 * ثلاث عشرة فئة في صف واحد كانت تُقرأ كقائمة طويلة لا كخريطة. الأقسام تجمعها بالمجال
 * الذي يفكّر به المدير: البرامج، الأداء، المجالس، المالية، المبنى، ثم المخصص والسجلات
 * المساندة. الفئات نفسها لم تتغيّر، فالروابط العميقة المحفوظة تبقى صالحة.
 */
export const REPORT_SECTIONS = {
  programs: "البرامج والخطة",
  performance: "الأداء الوظيفي",
  councils: "المجالس واللجان",
  finance: "المالية",
  building: "المبنى والصيانة",
  custom: "تقارير مخصصة",
  records: "سجلات مساندة",
} as const;

export type SectionKey = keyof typeof REPORT_SECTIONS;

export type ReportCategory = {
  key: CategoryKey;
  label: string;
  description: string;
  /** الصلاحية اللازمة لرؤية هذه الفئة أصلاً */
  permission: string;
  /** القسم المجالي الذي تظهر تحته في صفحة التقارير (§14) */
  section: SectionKey;
};

/** الفئات الثلاث عشرة المطلوبة (§D) */
export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  { key: "plan", label: "الخطة والبرامج", description: "البرامج النشطة والمغلقة والمؤرشفة وتقدمها وحالتها وسجل إقفالها", permission: "plan.read" , section: "programs" },
  { key: "evidence", label: "الشواهد", description: "الشواهد حسب البرنامج والنوع وتواريخ الرفع والبرامج بلا شواهد", permission: "evidence.read" , section: "programs" },
  { key: "finance", label: "المالية والميزانية", description: "سجل الإيرادات والمصروفات وبنود الصرف والمخصصات والفواتير والاتجاه الشهري", permission: "budget.read" , section: "finance" },
  { key: "performance", label: "الأداء الوظيفي", description: "جلسات التخطيط والتقييمات والتوصيات ونواقص التقييم", permission: "performance.read" , section: "performance" },
  { key: "committees", label: "اللجان والمجالس", description: "سجل اللجان والأعضاء والمهام ووثائق التكليف الصادرة", permission: "committees.read" , section: "councils" },
  { key: "meetings", label: "الاجتماعات والقرارات", description: "الاجتماعات والمحاضر والقرارات والتوصيات", permission: "committees.read" , section: "councils" },
  { key: "building", label: "المبنى والمرافق", description: "الأدوار والغرف والمرافق والصيانة والأصول والفحوصات", permission: "building.read" , section: "building" },
  { key: "employees", label: "الموظفون", description: "سجل المنسوبين وحالاتهم وعضوياتهم ونواقص البيانات", permission: "people.read" , section: "records" },
  // التحليل الرباعي صار له نموذج بيانات (`plan_swot_items`) يُستورد من ورقة «التحليل الرباعي»
  // الرسمية في مصنف الخطة، فله تقاريره هنا. لا تقرير يُبنى على بيانات غير موجودة.
  { key: "risks", label: "المخاطر والتحليل الرباعي", description: "سجل المخاطر ودرجاتها ومعالجتها، وعناصر التحليل الرباعي (القوة والضعف والفرص والتهديدات)", permission: "plan.read" , section: "programs" },
  { key: "external", label: "التقييم الخارجي", description: "نتائج التقييم الخارجي ومجالات التحسين وخطط التحسين", permission: "plan.read" , section: "programs" },
  { key: "documents", label: "الوثائق والمرفقات", description: "الوثائق الصادرة والمرفقات وأنواع الملفات والوثائق المجمّدة", permission: "documents.read" , section: "records" },
  { key: "imports", label: "الاستيراد وجودة البيانات", description: "دفعات الاستيراد وصفوفها وحالات التحقق ونواقص البيانات", permission: "imports.read" , section: "records" },
  { key: "usage", label: "سجل الاستخدام والعمليات", description: "سجل التدقيق والعمليات الحساسة وتصدير التقارير", permission: "admin.audit.read" , section: "records" },
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
  filters?: FilterKeyName[];
  /**
   * v2.5.0 §4: مصدر بيانات منشئ التقارير. التقارير التي تحمل مصدراً تظهر في المنشئ
   * وتقبل اختيار الأعمدة والتجميع والقوالب المحفوظة؛ ما لا يحمله يبقى تقريراً جاهزاً.
   */
  source?: ReportSource;
  /** أنماط العرض المدعومة لهذا التقرير — أولها الافتراضي */
  modes?: ReportModeName[];
  /** أعمدة التجميع المسموح بها (§4.2) — مقيَّدة بأعمدة التقرير نفسه */
  groupBy?: string[];
  /** التقرير يحمل بيانات أداء فردية حسّاسة (D-013) — يُدقَّق إصداره ويُحذَّر قبل تصديره */
  sensitive?: boolean;
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
    description:
      "برامج كل مجال بالاسم والمسؤول والحالة والتقدم والتواريخ والشواهد — الصفوف متجاورة لكل مجال، ويقبل مجالاً واحداً أو عدة مجالات أو الكل (§5.6)",
    permission: "plan.read",
    source: "programs",
    modes: ["detailed", "grouped", "summary", "exception"],
    groupBy: ["domain", "owner", "approval", "lifecycle", "executionStatus"],
    columns: [
      col("domain", "المجال"),
      col("seq", "م", "number"),
      col("name", "البرنامج"),
      col("owner", "المسؤول"),
      col("approval", "الاعتماد"),
      col("lifecycle", "دورة الحياة"),
      col("executionStatus", "حالة التنفيذ"),
      col("progress", "التقدم", "percent"),
      col("hijriStart", "البداية (هـ)"),
      col("hijriEnd", "النهاية (هـ)"),
      col("evidenceCount", "الشواهد", "number"),
      col("delayed", "التأخر"),
      col("editedAfterApproval", "عُدّل بعد الاعتماد"),
    ],
    filters: ["search", "status", "domain", "owner", "program", "progressRange"],
  },
  {
    key: "programs-by-domain-summary",
    category: "plan",
    label: "ملخص البرامج حسب المجال",
    description: "أعداد البرامج لكل مجال مع متوسط الإنجاز — الملخص الرقمي المرافق للتقرير التفصيلي",
    permission: "plan.read",
    columns: [col("domain", "المجال"), col("count", "عدد البرامج", "number"), col("avgProgress", "متوسط الإنجاز", "percent"), col("closedCount", "المغلقة", "number")],
  },
  {
    key: "programs-by-owner",
    category: "plan",
    label: "البرامج حسب المسؤول",
    description:
      "برامج كل مسؤول تنفيذ بالاسم والمجال والحالة والتقدم والتواريخ والشواهد — الصفوف متجاورة لكل مسؤول، ويقبل مسؤولاً واحداً أو عدة مسؤولين أو الكل (§5.5)",
    permission: "plan.read",
    source: "programs",
    modes: ["detailed", "grouped", "summary", "exception"],
    groupBy: ["owner", "domain", "approval", "lifecycle", "executionStatus"],
    columns: [
      col("owner", "مسؤول التنفيذ"),
      col("seq", "م", "number"),
      col("name", "البرنامج"),
      col("domain", "المجال"),
      col("approval", "الاعتماد"),
      col("lifecycle", "دورة الحياة"),
      col("executionStatus", "حالة التنفيذ"),
      col("progress", "التقدم", "percent"),
      col("hijriStart", "البداية (هـ)"),
      col("hijriEnd", "النهاية (هـ)"),
      col("evidenceCount", "الشواهد", "number"),
      col("delayed", "التأخر"),
      col("editedAfterApproval", "عُدّل بعد الاعتماد"),
    ],
    filters: ["search", "status", "owner", "domain", "program", "progressRange"],
  },
  {
    key: "programs-by-owner-summary",
    category: "plan",
    label: "ملخص البرامج حسب المسؤول",
    description: "أعداد البرامج لكل مسؤول تنفيذ مع متوسط الإنجاز — الملخص الرقمي المرافق للتقرير التفصيلي",
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
    // v2.5.0 §6.1: هذا التقرير عرضٌ للقراءة فوق مصدر الشاشة التشغيلية نفسه. لا «تقدم
    // أسبوع» بعد اليوم — أُزيل الإدخال اليدوي، والتقدم المعروض هو المعتمد على البرنامج.
    key: "plan-followups",
    category: "plan",
    label: "المتابعة الأسبوعية",
    description:
      "حالة كل برنامج معتمد في الأسبوع المختار — البيانات نفسها التي تعرضها شاشة «المتابعة الأسبوعية» حرفياً، مع فصل حالة الأسبوع عن الحالة الجارية وعن التقدم المعتمد",
    permission: "plan.read",
    source: "weekly-followup",
    modes: ["detailed", "grouped", "summary", "exception"],
    groupBy: ["domain", "owner", "weekStatus", "group"],
    columns: [
      col("seq", "م", "number"),
      col("programName", "البرنامج"),
      col("domain", "المجال"),
      col("owner", "المسؤول"),
      col("weekKey", "الأسبوع"),
      col("weekStatus", "حالة الأسبوع"),
      col("group", "التجميع الأسبوعي"),
      col("executionStatus", "الحالة الجارية"),
      col("currentProgress", "التقدم المعتمد", "percent"),
      col("lifecycle", "دورة الحياة"),
      col("lastFollowup", "آخر متابعة", "date"),
      col("evidenceCount", "الشواهد", "number"),
      col("note", "ملاحظات الأسبوع"),
      col("completedWork", "ما أُنجز"),
      col("obstacles", "العوائق"),
      col("requiredAction", "الإجراء المطلوب"),
      col("nextStep", "الخطوة التالية"),
      col("interventionNeeded", "يحتاج تدخّلاً"),
    ],
    filters: ["search", "week", "domain", "owner", "program", "status"],
  },
  {
    key: "plan-followup-log",
    category: "plan",
    label: "سجل المتابعات الأسبوعية",
    description: "كل ملاحظات المتابعة الأسبوعية تاريخياً بحالة كل أسبوع وسرده",
    permission: "plan.read",
    source: "weekly-followup",
    columns: [
      col("weekKey", "الأسبوع"),
      col("programName", "البرنامج"),
      col("executionStatus", "حالة الأسبوع"),
      col("note", "الملاحظة"),
      col("completedWork", "ما أُنجز"),
      col("obstacles", "العوائق"),
      col("requiredAction", "الإجراء المطلوب"),
      col("nextStep", "الخطوة التالية"),
      col("createdAt", "التاريخ", "date"),
    ],
    filters: ["search", "dateRange", "status", "program"],
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
    source: "budget",
    modes: ["detailed", "summary", "exception"],
    groupBy: ["itemName", "supplier", "allocationState"],
    category: "finance",
    label: "سجل المصروفات",
    description: "كل المصروفات مع مبلغها وبندها ورقم فاتورتها ومورّدها والمتبقي من مخصص البند قبل كل عملية وبعدها",
    permission: "budget.read",
    columns: [col("amount", "المبلغ", "money"), col("expenseDate", "التاريخ", "date"), col("itemName", "البند"), col("paymentReference", "رقم الفاتورة"), col("supplier", "المورّد"), col("hasInvoice", "فاتورة مرفقة"), col("remainingBefore", "متبقي البند قبل العملية", "money"), col("remainingAfter", "متبقي البند بعد العملية", "money"), col("allocationState", "حال المخصص")],
    filters: ["search", "dateRange", "item", "amountRange"],
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
    key: "allocation-utilization",
    category: "finance",
    label: "استغلال المخصصات",
    description:
      "لكل بند: المخصص والإيراد والمنصرف والمتبقي ونسبة الصرف وحاله — يقبل بنداً واحداً أو عدة بنود أو الكل، ومدى نسبة صرف (§11.2)",
    permission: "budget.read",
    source: "budget",
    modes: ["detailed", "summary", "exception"],
    groupBy: ["state"],
    columns: [
      col("name", "البند"),
      col("allocated", "المخصص", "money"),
      col("income", "الإيراد", "money"),
      col("expenses", "المنصرف", "money"),
      col("remaining", "المتبقي", "money"),
      col("spentPercent", "نسبة الصرف", "percent"),
      col("state", "الحال"),
    ],
    filters: ["item", "progressRange"],
  },
  {
    key: "missing-allocation",
    category: "finance",
    label: "بنود بلا مخصص",
    description:
      "البنود التي لم يُحدَّد لها مخصص بعد — المتبقي غير قابل للاحتساب فيها، ويُقال ذلك صراحةً بدل عرضها «ضمن المخصص» (§11.2)",
    permission: "budget.read",
    source: "budget",
    columns: [
      col("name", "البند"),
      col("income", "الإيراد", "money"),
      col("expenses", "المنصرف", "money"),
      col("state", "الحال"),
    ],
    filters: ["item"],
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
    description: "الإيرادات والمصروفات في سجل واحد مرتّب زمنياً مع المتبقي من مخصص البند قبل كل مصروف وبعده",
    permission: "budget.read",
    columns: [col("kind", "النوع"), col("amount", "المبلغ", "money"), col("date", "التاريخ", "date"), col("itemName", "البند"), col("description", "البيان"), col("hasInvoice", "فاتورة"), col("remainingBefore", "متبقي البند قبل العملية", "money"), col("remainingAfter", "متبقي البند بعد العملية", "money")],
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
    description:
      "جلسات التقييم المنتصفية والنهائية وحالاتها ونتائجها — يتطلب صلاحية الاطلاع على الأداء الفردي (D-013)",
    // v2.4.1 §5 (D-048): يحمل عمود «النتيجة» لكل موظف مسمّى، وهو تفصيل أداء فردي.
    // كان معلَناً بـ`performance.read` وحدها التي يملكها «مسؤول النظام»، فكان يفتح من
    // مركز التقارير ما أغلقه D-013 على صفحة المنسوب وما أغلقه D-044 على وثائق الأداء.
    permission: "performance.individual.read",
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
  /* ── الأداء الوظيفي (v2.5.0 §7) ─────────────────────────────── */
  {
    key: "perf-results",
    category: "performance",
    label: "نتائج الأداء التفصيلية",
    description:
      "نتيجة كل موظف في كل دورة بالاسم والنوع والمسمى والنموذج وعدد المعايير المقيَّمة والفئة — يقبل المعلمين وحدهم أو الإداريين وحدهم أو الجميع، وموظفاً واحداً أو عدة أو الكل (§7.2)",
    // D-013/D-048: التقرير يحمل اسم الموظف مع نتيجته — الصلاحية الفردية شرط، لا
    // `performance.read` العامة. مركز التقارير لا يفتح ما أُغلق في الصفحات.
    permission: "performance.individual.read",
    sensitive: true,
    source: "perf-results",
    modes: ["detailed", "grouped", "statistical", "incomplete"],
    groupBy: ["employeeType", "yearKey", "band", "department"],
    columns: [
      col("personName", "الموظف"),
      col("employeeType", "نوع الموظف"),
      col("jobTitle", "المسمى الوظيفي"),
      col("department", "القسم"),
      col("yearKey", "الدورة"),
      col("modelName", "النموذج"),
      col("criteriaCount", "عدد المعايير", "number"),
      col("ratedCount", "المعايير المقيَّمة", "number"),
      col("resultPercent", "النتيجة", "percent"),
      col("band", "الفئة"),
      col("cycleStatus", "حالة الدورة"),
      col("missingReason", "سبب غياب النتيجة"),
      col("lowPerformer", "أقل من العتبة"),
    ],
    filters: ["search", "employeeType", "person", "cycle", "jobTitle", "department", "status", "scoreRange"],
  },
  {
    key: "perf-low-performers",
    category: "performance",
    label: "الأداء المنخفض بالأسماء",
    description:
      "الموظفون الذين جاءت نتيجتهم أقل من العتبة — بالاسم والنوع والنتيجة والفئة والمعايير الضعيفة وجوانب التحسين والتوصية. العتبة الافتراضية 70٪ وقابلة للتعديل (§7.5)",
    permission: "performance.individual.read",
    sensitive: true,
    source: "perf-results",
    modes: ["detailed", "grouped"],
    groupBy: ["employeeType", "department"],
    columns: [
      col("personName", "الموظف"),
      col("employeeType", "نوع الموظف"),
      col("jobTitle", "المسمى الوظيفي"),
      col("yearKey", "الدورة"),
      col("resultPercent", "النتيجة", "percent"),
      col("band", "الفئة"),
      col("weakCriteria", "المعايير الضعيفة"),
      col("weaknesses", "جوانب التحسين"),
      col("recommendations", "التوصيات"),
      col("threshold", "العتبة المستعملة", "percent"),
    ],
    filters: ["search", "employeeType", "person", "cycle", "jobTitle", "department", "scoreRange"],
  },
  {
    key: "perf-strengths-weaknesses",
    category: "performance",
    label: "نقاط القوة وجوانب التحسين",
    description:
      "ما سُجّل فعلاً في جلسات التقييم من نقاط قوة وجوانب تحسين وتوصيات، لكل موظف ودورة — بالأسماء لا بنسب مجرّدة (§7.6)",
    permission: "performance.individual.read",
    sensitive: true,
    source: "perf-results",
    modes: ["detailed", "grouped"],
    groupBy: ["employeeType", "yearKey"],
    columns: [
      col("personName", "الموظف"),
      col("employeeType", "نوع الموظف"),
      col("yearKey", "الدورة"),
      col("strengths", "نقاط القوة"),
      col("weaknesses", "جوانب التحسين"),
      col("weakCriteria", "المعايير الضعيفة"),
      col("recommendations", "التوصيات"),
    ],
    filters: ["search", "employeeType", "person", "cycle", "jobTitle", "department", "scoreRange"],
  },
  {
    key: "perf-distribution",
    category: "performance",
    label: "توزيع نتائج الأداء",
    description: "أعداد الموظفين في كل شريحة نتيجة، ومتوسط كل نوع — التقرير الإحصائي المرافق للتقارير التفصيلية",
    permission: "performance.read",
    source: "perf-results",
    modes: ["statistical"],
    columns: [
      col("band", "الشريحة"),
      col("count", "عدد الموظفين", "number"),
      col("teachers", "معلمون", "number"),
      col("admins", "إداريون", "number"),
    ],
    filters: ["employeeType", "cycle", "department"],
  },
  /* ── المجالس واللجان: ثلاثة تقارير متمايزة (v2.5.0 §9.1) ────────── */
  {
    key: "committee-summary",
    category: "committees",
    label: "الملخص الإحصائي للمجالس واللجان",
    description:
      "أعداد فقط: اللجان والأعضاء والاجتماعات والمهام والمنجز منها والمتبقي — بلا أسماء. للأسماء والتفاصيل: «السجل التفصيلي» (§9.1)",
    permission: "committees.read",
    source: "committees",
    modes: ["summary", "statistical"],
    columns: [
      col("nameAr", "المجلس أو اللجنة"),
      col("kind", "النوع"),
      col("status", "الحالة"),
      col("memberCount", "الأعضاء", "number"),
      col("meetingCount", "الاجتماعات", "number"),
      col("taskCount", "المهام", "number"),
      col("completedTasks", "المنجزة", "number"),
      col("pendingTasks", "غير المنجزة", "number"),
      col("unsetTasks", "بلا حالة محددة", "number"),
    ],
    filters: ["search", "committee", "status"],
  },
  {
    key: "committee-registry-detailed",
    category: "committees",
    label: "السجل التفصيلي للمجالس واللجان",
    description:
      "صف مستقل لكل عضو ولكل مهمة — العضو والصفة والمهمة وحالة التنفيذ، وصفوف كل لجنة متجاورة تحت اسمها. لا خلايا مدموجة ولا قوائم أعضاء مختلطة (§9.3/§9.4)",
    permission: "committees.read",
    source: "committees",
    modes: ["detailed", "grouped", "exception"],
    groupBy: ["committeeName", "kind", "committeeStatus", "taskStatus"],
    columns: [
      col("committeeName", "المجلس أو اللجنة"),
      col("kind", "النوع"),
      col("committeeStatus", "حالة اللجنة"),
      col("personName", "العضو"),
      col("role", "الصفة"),
      col("taskText", "المهمة"),
      col("taskStatus", "حالة التنفيذ"),
      col("taskNotes", "ملاحظات المهمة"),
      col("meetingCount", "اجتماعات اللجنة", "number"),
    ],
    filters: ["search", "committee", "status"],
  },
  {
    key: "meetings-registry-detailed",
    category: "meetings",
    label: "سجل الاجتماعات التفصيلي",
    description:
      "صف لكل اجتماع: اللجنة ورقمه ونوعه وتاريخه ومكانه وجدول أعماله ومناقشته وقراراته وتوصياته ومالكيها وتواريخها المستهدفة وحالة تنفيذها والمحضر والمرفقات (§9.6)",
    permission: "committees.read",
    source: "meetings",
    modes: ["detailed", "grouped"],
    groupBy: ["committeeName", "status", "meetingType"],
    columns: [
      col("committeeName", "المجلس أو اللجنة"),
      col("meetingNumber", "رقم الاجتماع", "number"),
      col("title", "العنوان"),
      col("meetingType", "نوع الاجتماع"),
      col("meetingDate", "التاريخ", "date"),
      col("status", "الحالة"),
      col("location", "المكان"),
      col("agenda", "جدول الأعمال"),
      col("discussion", "المناقشة"),
      col("decisions", "القرارات"),
      col("recommendations", "التوصيات"),
      col("notes", "ملاحظات"),
      col("owners", "مسؤول التنفيذ"),
      col("targetDates", "التاريخ المستهدف"),
      col("executionStatus", "حالة التنفيذ"),
      col("minutesSigned", "المحضر الموقّع"),
      col("attachmentCount", "المرفقات", "number"),
    ],
    filters: ["search", "committee", "status", "dateRange"],
  },
  {
    key: "committee-register",
    category: "committees",
    // v2.4.1 §1: تسمية تميّزه صراحةً عن «سجل المجالس واللجان التفصيلي» — هذا عام بالأعداد
    label: "سجل اللجان العام",
    description:
      "سطر واحد لكل لجنة: نوعها وحالتها وعدد أعضائها واجتماعاتها — أعداد لا أسماء. للأعضاء وأدوارهم ومهامهم وحالة كل مهمة استخدم «سجل المجالس واللجان التفصيلي»",
    permission: "committees.read",
    columns: [col("nameAr", "اللجنة"), col("kind", "النوع"), col("status", "الحالة"), col("memberCount", "الأعضاء", "number"), col("meetingCount", "الاجتماعات", "number")],
    filters: ["search", "status"],
  },
  {
    key: "committee-members",
    category: "committees",
    label: "سجل المجالس واللجان التفصيلي",
    description:
      "الموصى به حين تحتاج الأعضاء وأدوارهم ومهامهم وحالاتها: صف مستقل لكل عضو بدوره ومهامه المسندة وحالة كل مهمة وفترة عضويته ونوع اللجنة وحالتها (v2.4)",
    permission: "committees.read",
    columns: [
      col("committeeName", "اللجنة/المجلس"),
      col("kind", "النوع"),
      col("committeeStatus", "حالة اللجنة"),
      // v2.4.1 §1.5: ترويسة الجدول التي أقرّها المدير — العضو / الصفة / المهمة / حالة التنفيذ
      col("personName", "العضو"),
      col("role", "الصفة"),
      col("position", "المسمى الوظيفي"),
      col("membership", "العضوية"),
      col("tasks", "المهمة"),
      col("taskStatuses", "حالة التنفيذ"),
    ],
    filters: ["search", "person"],
  },
  {
    key: "committee-tasks",
    category: "committees",
    label: "مهام اللجان",
    description: "المهام الموزّعة على أعضاء اللجان مع دور المكلَّف وحالة تنفيذ كل مهمة (v2.4)",
    permission: "committees.read",
    columns: [
      col("committeeName", "اللجنة"),
      col("personName", "العضو"),
      col("role", "الصفة"),
      col("taskText", "المهمة"),
      col("status", "حالة التنفيذ"),
      col("notes", "ملاحظات"),
    ],
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
    source: "maintenance",
    modes: ["detailed", "grouped", "exception"],
    groupBy: ["status", "priority", "category", "location"],
    category: "building",
    label: "بلاغات الصيانة",
    description:
      "بلاغات الصيانة برمزها وموقعها وتصنيفها وأولويتها وحالتها وأثرها على السلامة والتشغيل والإجراء المطلوب ومسؤولها واعتمادها وإصدار وثيقتها — كل ملاحظة فحص بلاغ مستقل (§10)",
    permission: "maintenance.read",
    columns: [
      col("code", "رقم البلاغ"),
      col("title", "البلاغ"),
      col("location", "الموقع"),
      col("category", "التصنيف"),
      col("priority", "الأولوية"),
      col("status", "الحالة"),
      col("safetyImpact", "أثر السلامة"),
      col("operationalImpact", "الأثر التشغيلي"),
      col("requestedAction", "الإجراء المطلوب"),
      col("owner", "المسؤول"),
      col("approved", "الاعتماد"),
      col("sentTo", "الجهة المستلمة"),
      col("sentAt", "تاريخ الإرسال", "date"),
      col("issued", "الوثيقة"),
      col("source", "المصدر"),
      col("closedAt", "تاريخ الإغلاق", "date"),
      col("createdAt", "تاريخ البلاغ", "date"),
    ],
    filters: ["search", "status", "dateRange", "category", "priority", "location", "person"],
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
    description: "صف مستقل لكل عضوية: المنسوب واللجنة والدور وحالة العضوية — لا دمج في خلية واحدة (v2.4)",
    permission: "people.read",
    columns: [
      col("fullName", "الاسم"),
      col("committeeName", "اللجنة/المجلس"),
      col("kind", "النوع"),
      col("role", "الدور"),
      col("membership", "العضوية"),
      col("committeeCount", "إجمالي لجانه القائمة", "number"),
    ],
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

/** الفئات المنتمية لقسم مجالي واحد (§14) — بالترتيب المعلَن في السجل */
export function categoriesInSection(section: SectionKey): ReportCategory[] {
  return REPORT_CATEGORIES.filter((c) => c.section === section);
}

/** التقارير التي يقبلها منشئ التقارير (§4.1) — ما أعلن مصدر بيانات */
export function builderReports(): ReportDefinition[] {
  return REPORTS.filter((r) => r.source !== undefined);
}

/** أنماط العرض المتاحة لتقرير ما — «تفصيلي» دائماً متاح */
export function modesFor(reportKey: string): ReportModeName[] {
  return reportByKey(reportKey)?.modes ?? ["detailed"];
}

/** هل هذا العمود مسموح للتجميع في هذا التقرير؟ قائمة بيضاء كالترتيب تماماً */
export function isGroupableColumn(reportKey: string, column: string): boolean {
  return reportByKey(reportKey)?.groupBy?.includes(column) ?? false;
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

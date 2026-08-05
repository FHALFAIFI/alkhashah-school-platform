/**
 * إطار الترشيح الموحّد (v2.5.0 §3) — وحدة خالصة بلا وصول لقاعدة البيانات.
 *
 * مصدر واحد لتعريف المرشّحات وقراءتها من عنوان URL وكتابتها إليه ووصفها بالعربية. يستعمله:
 *   • صفحة مركز التقارير (العرض على الشاشة)،
 *   • مسار التصدير (PDF/CSV/Excel/Word) — فتنطبق **المرشّحات نفسها** على المُصدَّر،
 *   • منشئ التقارير وقوالبه المحفوظة،
 *   • الشاشات التشغيلية التي تشارك التقارير مصدر بياناتها (المتابعة الأسبوعية مثلاً).
 *
 * ثلاث قواعد تحكم التصميم:
 *  1. **قائمة بيضاء دائماً.** لا يمر مفتاح مرشّح ولا عمود ترتيب ولا اسم عمود من عنوان URL
 *     إلى استعلام. ما ليس في السجل يُسقَط بصمت بدل أن يُمرَّر.
 *  2. **الفراغ يعني الكل.** غياب المرشّح ومصفوفته الفارغة سواء: كل السجلات. «تحديد الكل»
 *     في الواجهة يكافئ «بلا تحديد» فلا يتضخّم العنوان بمئة معرّف.
 *  3. **كل مرشّح فعّال يُقال صراحةً** — شريحة على الشاشة وسطر في ترويسة التقرير المولَّد.
 *     تقرير فارغ بسبب مرشّح قديم يجب أن يشرح نفسه، لا أن يبدو كغياب بيانات.
 */

import { EMPLOYEE_TYPES } from "@/lib/employee-type";

/* ─────────────────────────── مفاتيح المرشّحات ─────────────────────────── */

/**
 * كل بُعد ترشيح تدعمه المنصة. التقرير يعلن ما يعنيه منها فقط، فلا يظهر للمستخدم مرشّح
 * لا أثر له على نتيجته.
 */
export const FILTER_KEYS = [
  "search",
  "dateRange",
  "status",
  "person",
  "item",
  "domain",
  "owner",
  "committee",
  "program",
  "employeeType",
  "jobTitle",
  "department",
  "cycle",
  "week",
  "academicYear",
  "scoreRange",
  "amountRange",
  "progressRange",
  "flags",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/** الشكل الذي تُعرض به المرشّحة في الواجهة */
export type FilterKind = "text" | "dateRange" | "multi" | "numberRange" | "single" | "toggles";

export type FilterDef = {
  key: FilterKey;
  labelAr: string;
  kind: FilterKind;
  /** أسماء معاملات URL التي تحملها هذه المرشّحة */
  params: string[];
  /** تلميح يظهر تحت الحقل حين يحتاج المستخدم تفسيراً */
  hintAr?: string;
};

export const FILTER_DEFS: Readonly<Record<FilterKey, FilterDef>> = {
  search: { key: "search", labelAr: "بحث", kind: "text", params: ["search"] },
  dateRange: { key: "dateRange", labelAr: "المدة", kind: "dateRange", params: ["dateFrom", "dateTo"] },
  status: { key: "status", labelAr: "الحالة", kind: "multi", params: ["status"] },
  person: { key: "person", labelAr: "الموظف", kind: "multi", params: ["personId"] },
  item: { key: "item", labelAr: "بند الصرف", kind: "multi", params: ["itemId"] },
  domain: { key: "domain", labelAr: "المجال", kind: "multi", params: ["domain"] },
  owner: { key: "owner", labelAr: "مسؤول التنفيذ", kind: "multi", params: ["owner"] },
  committee: { key: "committee", labelAr: "المجلس أو اللجنة", kind: "multi", params: ["committeeId"] },
  program: { key: "program", labelAr: "البرنامج", kind: "multi", params: ["programId"] },
  employeeType: { key: "employeeType", labelAr: "نوع الموظف", kind: "multi", params: ["empType"] },
  jobTitle: { key: "jobTitle", labelAr: "المسمى الوظيفي", kind: "multi", params: ["jobTitle"] },
  department: { key: "department", labelAr: "القسم", kind: "multi", params: ["dept"] },
  cycle: { key: "cycle", labelAr: "دورة التقييم", kind: "multi", params: ["cycleId"] },
  week: { key: "week", labelAr: "الأسبوع", kind: "single", params: ["week"] },
  academicYear: { key: "academicYear", labelAr: "العام الدراسي", kind: "single", params: ["year"] },
  scoreRange: {
    key: "scoreRange",
    labelAr: "مدى النتيجة (٪)",
    kind: "numberRange",
    params: ["minScore", "maxScore"],
    hintAr: "نتيجة التقييم النهائية كنسبة مئوية",
  },
  amountRange: { key: "amountRange", labelAr: "مدى المبلغ", kind: "numberRange", params: ["minAmount", "maxAmount"] },
  progressRange: { key: "progressRange", labelAr: "مدى الإنجاز (٪)", kind: "numberRange", params: ["minProgress", "maxProgress"] },
  flags: { key: "flags", labelAr: "حالات خاصة", kind: "toggles", params: ["flag"] },
};

/* ─────────────────────────── العلامات (flags) ─────────────────────────── */

/**
 * مرشّحات منطقية معدودة مسبقاً. كل علامة سؤال «نعم/لا» على السجل، وتُعرّف مرة واحدة هنا
 * ليستعملها التقرير والمُصدِّر والقالب المحفوظ بالمعنى نفسه.
 */
export const FILTER_FLAGS = {
  delayed: "المتأخرة فقط",
  notUpdated: "بلا تحديث هذا الأسبوع",
  needsIntervention: "تحتاج تدخلاً",
  hasEvidence: "لها شواهد",
  noEvidence: "بلا شواهد",
  approved: "المعتمدة فقط",
  notApproved: "غير المعتمدة",
  editedAfterApproval: "عُدّلت بعد الاعتماد",
  overspent: "المتجاوزة للمخصص",
  missingAllocation: "بلا مخصص",
  hasTasks: "لها مهام",
  noTasks: "بلا مهام",
  hasMeetings: "لها اجتماعات",
  noMeetings: "بلا اجتماعات",
  incompleteTasks: "مهام غير مكتملة",
  incomplete: "التقييمات غير المكتملة",
  lowPerformers: "أقل من العتبة",
  openOnly: "المفتوحة فقط",
  closedOnly: "المغلقة فقط",
  issued: "الصادرة رسمياً",
  notIssued: "غير الصادرة",
  safetyImpact: "ذات أثر على السلامة",
} as const;

export type FilterFlag = keyof typeof FILTER_FLAGS;

export function isFilterFlag(value: string): value is FilterFlag {
  return Object.prototype.hasOwnProperty.call(FILTER_FLAGS, value);
}

/* ─────────────────────────── نموذج المرشّحات ─────────────────────────── */

export type ReportMode = "detailed" | "summary" | "statistical" | "grouped" | "card" | "exception" | "incomplete";

export const REPORT_MODES: Readonly<Record<ReportMode, string>> = {
  detailed: "تفصيلي",
  summary: "ملخّص",
  statistical: "إحصائي",
  grouped: "مجمَّع",
  card: "بطاقة سجل",
  exception: "تقرير استثناءات",
  incomplete: "بيانات ناقصة",
};

export function isReportMode(value: string): value is ReportMode {
  return Object.prototype.hasOwnProperty.call(REPORT_MODES, value);
}

/**
 * المرشّحات الموحّدة. كل الحقول اختيارية، والمصفوفة الفارغة تعني «الكل».
 *
 * `status` و`personId` و`itemId` المفردة باقية لأن الروابط العميقة المحفوظة عند المدير
 * منذ v2.2 تستعملها؛ القارئ يوحّدها مع نظيرتها المتعدّدة فلا يوجد مساران للمعنى نفسه.
 */
export type ReportFilters = {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  statuses?: string[];
  personId?: string;
  personIds?: string[];
  itemId?: string;
  itemIds?: string[];
  domains?: string[];
  owners?: string[];
  committeeIds?: string[];
  programIds?: string[];
  employeeTypes?: string[];
  jobTitles?: string[];
  departments?: string[];
  cycleIds?: string[];
  week?: string;
  academicYear?: string;
  minScore?: number;
  maxScore?: number;
  minAmount?: number;
  maxAmount?: number;
  minProgress?: number;
  maxProgress?: number;
  flags?: FilterFlag[];
  /** عتبة الأداء المنخفض القابلة للتعديل (§7.5) — الافتراضي 70 */
  lowThreshold?: number;
  sort?: string;
  dir?: "asc" | "desc";
  /** مفتاح التجميع — مقيَّد بأعمدة التقرير نفسه */
  group?: string;
  /** الأعمدة المختارة للعرض — مقيَّدة بأعمدة التقرير نفسه؛ الفراغ يعني كلها */
  columns?: string[];
  mode?: ReportMode;
  page?: number;
  pageSize?: number;
};

/** عتبة الأداء المنخفض الافتراضية (§7.5) — «أقل من 70٪» */
export const DEFAULT_LOW_THRESHOLD = 70;

/* ─────────────────────────── القراءة من العنوان ─────────────────────────── */

/** مصدر معاملات مقروء: `URLSearchParams` أو خريطة `searchParams` في Next */
export type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function readAll(source: ParamSource, name: string): string[] {
  if (source instanceof URLSearchParams) return source.getAll(name).filter((v) => v.trim() !== "");
  const raw = source[name];
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((v) => typeof v === "string" && v.trim() !== "");
}

function readOne(source: ParamSource, name: string): string | undefined {
  return readAll(source, name)[0];
}

/** عدد ضمن مدى — أي شيء آخر يُسقَط بدل أن يصل إلى استعلام */
function readNumber(source: ParamSource, name: string, min: number, max: number): number | undefined {
  const raw = readOne(source, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

/** تاريخ ISO فقط — «2026-08-05». أي صيغة أخرى تُسقَط. */
function readIsoDate(source: ParamSource, name: string): string | undefined {
  const raw = readOne(source, name);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime()) ? undefined : raw;
}

/** حد أعلى لعدد القيم في مرشّح متعدّد — يمنع عنواناً مُلفَّقاً بآلاف المعرّفات */
const MAX_MULTI_VALUES = 200;
/** حد أعلى لطول نص البحث — يمنع نمط `ILIKE` عملاقاً */
const MAX_SEARCH_LENGTH = 120;

function readMulti(source: ParamSource, name: string): string[] | undefined {
  const values = [...new Set(readAll(source, name).map((v) => v.trim()))].slice(0, MAX_MULTI_VALUES);
  return values.length ? values : undefined;
}

/**
 * قراءة المرشّحات من عنوان URL — مُطهَّرة بالكامل.
 *
 * `allowedSort` و`allowedColumns` تُمرَّران من تعريف التقرير، فلا يمكن لعنوان مُلفَّق أن
 * يطلب ترتيباً بعمود غير معلَن ولا يُظهر عموداً لم يُعرَّف.
 */
export function parseReportFilters(
  source: ParamSource,
  opts?: {
    allowedSort?: (key: string) => boolean;
    allowedColumns?: readonly string[];
  },
): ReportFilters {
  const search = readOne(source, "search")?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined;
  const statuses = readMulti(source, "status");
  const personIds = readMulti(source, "personId");
  const itemIds = readMulti(source, "itemId");
  const sortRaw = readOne(source, "sort");
  const groupRaw = readOne(source, "group");
  const modeRaw = readOne(source, "mode");
  const columnsRaw = readMulti(source, "col");
  const allowed = opts?.allowedColumns;

  return {
    search,
    dateFrom: readIsoDate(source, "dateFrom"),
    dateTo: readIsoDate(source, "dateTo"),
    // القيمة المفردة تبقى مضبوطة للروابط القديمة، والمتعدّدة هي المصدر
    status: statuses?.length === 1 ? statuses[0] : undefined,
    statuses,
    personId: personIds?.length === 1 ? personIds[0] : undefined,
    personIds,
    itemId: itemIds?.length === 1 ? itemIds[0] : undefined,
    itemIds,
    domains: readMulti(source, "domain"),
    owners: readMulti(source, "owner"),
    committeeIds: readMulti(source, "committeeId"),
    programIds: readMulti(source, "programId"),
    employeeTypes: readMulti(source, "empType")?.filter((t) => (EMPLOYEE_TYPES as readonly string[]).includes(t)),
    jobTitles: readMulti(source, "jobTitle"),
    departments: readMulti(source, "dept"),
    cycleIds: readMulti(source, "cycleId"),
    week: readOne(source, "week"),
    academicYear: readOne(source, "year"),
    minScore: readNumber(source, "minScore", 0, 100),
    maxScore: readNumber(source, "maxScore", 0, 100),
    minAmount: readNumber(source, "minAmount", 0, Number.MAX_SAFE_INTEGER),
    maxAmount: readNumber(source, "maxAmount", 0, Number.MAX_SAFE_INTEGER),
    minProgress: readNumber(source, "minProgress", 0, 100),
    maxProgress: readNumber(source, "maxProgress", 0, 100),
    flags: readMulti(source, "flag")?.filter(isFilterFlag),
    lowThreshold: readNumber(source, "lowThreshold", 0, 100),
    sort: sortRaw && (opts?.allowedSort?.(sortRaw) ?? false) ? sortRaw : undefined,
    dir: readOne(source, "dir") === "desc" ? "desc" : "asc",
    group: groupRaw && allowed?.includes(groupRaw) ? groupRaw : undefined,
    columns: allowed ? columnsRaw?.filter((c) => allowed.includes(c)) : undefined,
    mode: modeRaw && isReportMode(modeRaw) ? modeRaw : undefined,
    page: readNumber(source, "page", 1, 10_000),
    pageSize: readNumber(source, "pageSize", 1, 500),
  };
}

/* ─────────────────────────── الكتابة إلى العنوان ─────────────────────────── */

/** المعاملات المتعدّدة القيم — تُكتب مكرَّرة لا مفصولة بفواصل */
const MULTI_PARAMS: [keyof ReportFilters, string][] = [
  ["statuses", "status"],
  ["personIds", "personId"],
  ["itemIds", "itemId"],
  ["domains", "domain"],
  ["owners", "owner"],
  ["committeeIds", "committeeId"],
  ["programIds", "programId"],
  ["employeeTypes", "empType"],
  ["jobTitles", "jobTitle"],
  ["departments", "dept"],
  ["cycleIds", "cycleId"],
  ["flags", "flag"],
  ["columns", "col"],
];

const SCALAR_PARAMS: [keyof ReportFilters, string][] = [
  ["search", "search"],
  ["dateFrom", "dateFrom"],
  ["dateTo", "dateTo"],
  ["week", "week"],
  ["academicYear", "year"],
  ["minScore", "minScore"],
  ["maxScore", "maxScore"],
  ["minAmount", "minAmount"],
  ["maxAmount", "maxAmount"],
  ["minProgress", "minProgress"],
  ["maxProgress", "maxProgress"],
  ["lowThreshold", "lowThreshold"],
  ["sort", "sort"],
  ["group", "group"],
  ["mode", "mode"],
  ["page", "page"],
  ["pageSize", "pageSize"],
];

/** كتابة المرشّحات في `URLSearchParams` — الشكل نفسه الذي يقرأه `parseReportFilters` */
export function serializeReportFilters(filters: ReportFilters, base?: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(base);
  for (const [, param] of [...MULTI_PARAMS, ...SCALAR_PARAMS]) sp.delete(param);
  sp.delete("dir");

  for (const [field, param] of MULTI_PARAMS) {
    const values = filters[field] as string[] | undefined;
    for (const v of values ?? []) sp.append(param, v);
  }
  for (const [field, param] of SCALAR_PARAMS) {
    const value = filters[field];
    if (value !== undefined && value !== null && String(value) !== "") sp.set(param, String(value));
  }
  if (filters.dir === "desc") sp.set("dir", "desc");
  return sp;
}

/**
 * تمثيل قابل للتخزين في `jsonb` — **خريطة إلى مصفوفات**، لا إلى نصوص مفردة.
 *
 * السبب دقيق ويستحق الذكر: `Object.fromEntries(searchParams.entries())` يُسقط كل قيمة
 * مكرّرة عدا الأخيرة، فقالبٌ محفوظ بثلاث لجان يعود بلجنة واحدة — وهو فقدان صامت لا
 * يُلاحَظ إلا حين يقرأ المدير تقريراً ناقصاً. المصفوفة تحفظ التكرار صراحةً.
 */
export type StoredFilters = Record<string, string[]>;

export function filtersToStored(filters: ReportFilters): StoredFilters {
  const sp = serializeReportFilters(filters);
  const out: StoredFilters = {};
  for (const key of new Set(sp.keys())) out[key] = sp.getAll(key);
  return out;
}

/** العكس — يقبل الشكل القديم (نص مفرد) كي لا ينكسر صفّ مخزَّن قبل هذا التمثيل */
export function storedToParams(stored: unknown): URLSearchParams {
  const sp = new URLSearchParams();
  if (!stored || typeof stored !== "object") return sp;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (Array.isArray(value)) for (const v of value) sp.append(key, String(v));
    else if (value !== null && value !== undefined) sp.append(key, String(value));
  }
  return sp;
}

/* ─────────────────────────── الوصف بالعربية ─────────────────────────── */

/** جداول أسماء تحوّل المعرّفات إلى أسماء مقروءة في الشرائح وترويسة التقرير */
export type FilterLabelMaps = {
  people?: Map<string, string>;
  items?: Map<string, string>;
  committees?: Map<string, string>;
  programs?: Map<string, string>;
  cycles?: Map<string, string>;
};

export type FilterChip = { key: string; label: string; value: string };

function namesOf(ids: string[] | undefined, map: Map<string, string> | undefined, allLabel = "الكل"): string | null {
  if (!ids || ids.length === 0) return null;
  const names = ids.map((id) => map?.get(id) ?? id);
  return names.length ? names.join("، ") : allLabel;
}

/**
 * وصف كل مرشّح فعّال بالعربية.
 *
 * يُستعمل في ثلاثة مواضع بالنص نفسه: شرائح الشاشة، وترويسة التقرير المولَّد، وسطر
 * «لا نتائج مطابقة» الذي يشرح سبب الفراغ بدل تركه غامضاً.
 */
export function describeFilters(filters: ReportFilters, maps: FilterLabelMaps = {}): FilterChip[] {
  const chips: FilterChip[] = [];
  const push = (key: string, label: string, value: string | null) => {
    if (value) chips.push({ key, label, value });
  };

  push("search", "بحث", filters.search ?? null);
  if (filters.dateFrom || filters.dateTo) {
    push(
      "dateRange",
      "الفترة",
      `${filters.dateFrom ?? "البداية"} → ${filters.dateTo ?? "النهاية"}`,
    );
  }
  push("status", "الحالة", filters.statuses?.join("، ") ?? null);
  push("person", "الموظف", namesOf(filters.personIds, maps.people));
  push("item", "بند الصرف", namesOf(filters.itemIds, maps.items));
  push("domain", "المجال", filters.domains?.join("، ") ?? null);
  push("owner", "مسؤول التنفيذ", filters.owners?.join("، ") ?? null);
  push("committee", "المجلس أو اللجنة", namesOf(filters.committeeIds, maps.committees));
  push("program", "البرنامج", namesOf(filters.programIds, maps.programs));
  push("employeeType", "نوع الموظف", filters.employeeTypes?.join("، ") ?? null);
  push("jobTitle", "المسمى الوظيفي", filters.jobTitles?.join("، ") ?? null);
  push("department", "القسم", filters.departments?.join("، ") ?? null);
  push("cycle", "دورة التقييم", namesOf(filters.cycleIds, maps.cycles));
  push("week", "الأسبوع", filters.week ?? null);
  push("academicYear", "العام الدراسي", filters.academicYear ?? null);
  push("scoreRange", "مدى النتيجة", rangeText(filters.minScore, filters.maxScore, "٪"));
  push("amountRange", "مدى المبلغ", rangeText(filters.minAmount, filters.maxAmount, " ريال"));
  push("progressRange", "مدى الإنجاز", rangeText(filters.minProgress, filters.maxProgress, "٪"));
  push("flags", "حالات خاصة", filters.flags?.map((f) => FILTER_FLAGS[f]).join("، ") ?? null);
  if (filters.lowThreshold !== undefined && filters.lowThreshold !== DEFAULT_LOW_THRESHOLD) {
    push("lowThreshold", "عتبة الأداء المنخفض", `أقل من ${filters.lowThreshold}٪`);
  }
  push("mode", "نمط العرض", filters.mode ? REPORT_MODES[filters.mode] : null);
  push("group", "التجميع حسب", filters.group ?? null);
  return chips;
}

function rangeText(min: number | undefined, max: number | undefined, unit: string): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) return `${min}${unit} — ${max}${unit}`;
  if (min !== undefined) return `${min}${unit} فأكثر`;
  return `حتى ${max}${unit}`;
}

/** هل يوجد أي مرشّح فعّال؟ الترتيب والصفحة ليسا مرشّحات. */
export function hasActiveFilters(filters: ReportFilters): boolean {
  return describeFilters(filters).length > 0;
}

/** أزواج «التسمية: القيمة» لترويسة التقرير المُصدَّر (§3.4) */
export function filterHeaderLines(filters: ReportFilters, maps: FilterLabelMaps = {}): [string, string][] {
  return describeFilters(filters, maps).map((c) => [c.label, c.value]);
}

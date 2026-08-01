/**
 * حسابات مالية المدرسة (v2.2 §B5) — **مصدر الحقيقة الوحيد** لكل رقم مالي في المنصة.
 *
 * تستعمله لوحة المالية والتفاصيل والتقارير وتصدير Word/Excel/CSV وشاشات الطباعة، فلا
 * يوجد حساب ثانٍ يتفرّع عنه ولا رقم يُحسب على العميل.
 *
 * وحدة خالصة: بلا وصول لقاعدة البيانات وبلا React، فتُختبر وحدوياً بالكامل.
 *
 * ── تعريفات محسومة ──────────────────────────────────────────────────────────
 * • المبلغ الفارغ ليس صفراً: `amount = null` يعني «لم يُدخل مبلغ» ويُعرض «—». لا يسهم
 *   في أي مجموع، ويُعدّ ضمن `missingAmountCount` حتى لا يختفي النقص خلف رقم صفري.
 * • السجل المؤرشف يخرج من كل المجاميع الجارية ويبقى متاحاً لتقارير الأرشيف.
 * • الإيراد «ملغى» لا يُحتسب إطلاقاً. «متوقع» يُتابَع منفصلاً ولا يدخل الرصيد النقدي.
 *   «مستلم» وحده هو الإيراد الفعلي.
 * • المتبقي من المخصص = المخصص − مصروفات البند. يُحسب فقط حين للبند مخصص مُدخل؛
 *   وإلا فالنتيجة `null` وتُعرض «—» لا صفراً ولا رقماً سالباً مضلِّلاً.
 * • الرصيد النقدي للمدرسة = إجمالي الإيراد المستلم − إجمالي المصروف.
 * • لا تطبيع: المصروف يبقى كما هو بعد تجاوز المخصص ويُعلَّم `overspent` بدل تعديل رقم.
 * • لا احتساب مزدوج: نسبة المصروف للبند تأتي من `financialItemId` وحده؛ عمود «البند»
 *   النصي القديم مرجع تاريخي لا يدخل الحساب.
 */

/** الحد الذي يُعدّ عنده البند «قارب على استنفاد مخصصه» */
export const NEAR_EXHAUSTION_PERCENT = 90;

/** تحويل قيمة مُدخلة إلى عدد منتهٍ أو `null` — لا NaN ولا صفر مُختلق أبداً */
export function amountOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/*
 * v2.4 §4: حساب عشري آمن — المبالغ بالريال تُحوَّل داخلياً إلى هللات صحيحة قبل أي جمع أو
 * طرح، فلا تتسرب أخطاء الفاصلة العائمة (0.1 + 0.2 ≠ 0.3) إلى أي رصيد معروض أو مطبوع.
 * الواجهة الخارجية للدوال تبقى بالريال كما هي.
 */
/** ريال → هللات صحيحة (تقريب نصفي) */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}
/** هللات → ريال */
export function fromMinor(minor: number): number {
  return minor / 100;
}
/** فرق دقيق بين مبلغين بالريال */
export function moneySubtract(a: number, b: number): number {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** مجموع null-safe بدقة الهللة: القيم الفارغة تُتجاهل ولا تُحوَّل إلى صفر */
function sum(values: (number | null)[]): number {
  let totalMinor = 0;
  for (const v of values) if (v !== null) totalMinor += toMinor(v);
  return fromMinor(totalMinor);
}

/** حالات الإيراد المعتمدة */
export const INCOME_RECEIVED = "مستلم";
export const INCOME_EXPECTED = "متوقع";
export const INCOME_CANCELLED = "ملغى";

export type FinanceRecord = {
  id: string;
  /** `null` = لم يُدخل مبلغ (ليس صفراً) */
  amount: number | null;
  financialItemId: string | null;
  archivedAt: Date | null;
  /** تاريخ العملية بصيغة ISO — قد يكون فارغاً (كل الحقول اختيارية) */
  date: string | null;
  /** هل للعملية فاتورة/إيصال مرفق؟ معلوماتي لا إلزامي */
  hasInvoice: boolean;
  /** للإيراد فقط: متوقع | مستلم | ملغى */
  status?: string;
  /** وقت الإدخال — مرجع ترتيب احتياطي للعمليات بلا تاريخ مُدخل */
  createdAt?: Date | null;
};

/** مفتاح ترتيب زمني للعملية: تاريخها المُدخل أولاً، ثم وقت إدخالها، ثم لا شيء */
function operationSortKey(r: FinanceRecord): string {
  if (r.date) return r.date;
  if (r.createdAt) {
    const d = r.createdAt;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return "";
}

export type FinancialItemInput = {
  id: string;
  name: string | null;
  allocated: number | null;
  archivedAt: Date | null;
  sortOrder: number;
  color: string | null;
};

/** آخر عملية مالية على البند — للبطاقات («آخر عملية مالية» و«قيمة آخر عملية») */
export type LastOperation = {
  kind: "إيراد" | "مصروف";
  /** تاريخ العملية المُدخل أو تاريخ الإدخال إن غاب */
  date: string | null;
  amount: number | null;
};

export type FinancialItemLine = {
  id: string;
  name: string | null;
  color: string | null;
  sortOrder: number;
  archived: boolean;
  /** هل للبند مخصص مُدخل؟ عند false يُعرض المتبقي و«٪» بحالة محايدة «—» */
  hasAllocation: boolean;
  allocated: number | null;
  income: number;
  expenses: number;
  /** المخصص − المصروف؛ `null` حين لا مخصص (لا صفر مضلِّل) */
  remaining: number | null;
  /** نسبة الإنفاق من المخصص؛ `null` حين لا مخصص */
  spentPercent: number | null;
  overspent: boolean;
  /** بلغ أو تجاوز عتبة الاقتراب من استنفاد المخصص */
  nearExhaustion: boolean;
  operationCount: number;
  /** آخر عملية على البند (إيراد مستلم أو مصروف) — `null` حين لا عمليات */
  lastOperation: LastOperation | null;
};

/** السجلات الجارية فقط — المؤرشف يخرج من كل مجموع جارٍ */
const isActive = (r: FinanceRecord) => r.archivedAt === null;
/** الإيراد الفعلي: «مستلم» فقط — «متوقع» لم يُقبض و«ملغى» لا يُحتسب */
const isReceived = (r: FinanceRecord) => r.status === INCOME_RECEIVED;

/**
 * خطوط البنود المالية — لكل بند: المخصص والإيراد والمصروف والمتبقي، مستقلاً تماماً
 * عن أي بند آخر ولا يشترك معه في وعاء واحد.
 *
 * لأن المصروف مجموع حيّ مفتاحه `financialItemId`، فإن إنشاء عملية أو تعديلها أو حذفها أو
 * نقلها إلى بند آخر يعيد حساب البنود المتأثرة وحدها تلقائياً — بلا تسرّب بين البنود.
 */
export function financialItemLines(
  items: FinancialItemInput[],
  income: FinanceRecord[],
  expenses: FinanceRecord[],
): FinancialItemLine[] {
  const activeIncome = income.filter((r) => isActive(r) && isReceived(r));
  const activeExpenses = expenses.filter(isActive);

  const incomeByItem = new Map<string, number[]>();
  const expensesByItem = new Map<string, number[]>();
  const countByItem = new Map<string, number>();
  const lastByItem = new Map<string, { key: string; op: LastOperation }>();

  const push = (map: Map<string, number[]>, r: FinanceRecord, kind: LastOperation["kind"]) => {
    if (!r.financialItemId) return; // عملية بلا بند لا تُنسب لأي بند
    const list = map.get(r.financialItemId) ?? [];
    if (r.amount !== null) list.push(r.amount);
    map.set(r.financialItemId, list);
    countByItem.set(r.financialItemId, (countByItem.get(r.financialItemId) ?? 0) + 1);
    // آخر عملية على البند — بالتاريخ المُدخل ثم وقت الإدخال احتياطاً
    const key = operationSortKey(r);
    const prev = lastByItem.get(r.financialItemId);
    if (!prev || key >= prev.key) {
      lastByItem.set(r.financialItemId, { key, op: { kind, date: key || null, amount: r.amount } });
    }
  };
  for (const r of activeIncome) push(incomeByItem, r, "إيراد");
  for (const r of activeExpenses) push(expensesByItem, r, "مصروف");

  return items
    .map((item) => {
      const itemIncome = sum(incomeByItem.get(item.id) ?? []);
      const itemExpenses = sum(expensesByItem.get(item.id) ?? []);
      const hasAllocation = item.allocated !== null;
      const remaining = hasAllocation ? moneySubtract(item.allocated as number, itemExpenses) : null;
      const spentPercent =
        hasAllocation && (item.allocated as number) > 0
          ? Math.round((itemExpenses / (item.allocated as number)) * 100)
          : null;
      return {
        id: item.id,
        name: item.name,
        color: item.color,
        sortOrder: item.sortOrder,
        archived: item.archivedAt !== null,
        hasAllocation,
        allocated: item.allocated,
        income: itemIncome,
        expenses: itemExpenses,
        remaining,
        spentPercent,
        overspent: remaining !== null && remaining < 0,
        nearExhaustion: spentPercent !== null && spentPercent >= NEAR_EXHAUSTION_PERCENT,
        operationCount: countByItem.get(item.id) ?? 0,
        lastOperation: lastByItem.get(item.id)?.op ?? null,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.name ?? "").localeCompare(b.name ?? "", "ar"));
}

export type SchoolFinanceSummary = {
  /** الإيراد المستلم فعلياً */
  totalIncome: number;
  /** الإيراد المتوقع (لم يُقبض) — خارج الرصيد النقدي */
  totalExpectedIncome: number;
  totalExpenses: number;
  /** الرصيد الحالي = الإيراد المستلم − المصروف */
  cashBalance: number;
  /** مجموع مخصصات البنود غير المؤرشفة */
  totalAllocated: number;
  /** مجموع المتبقي من البنود ذات المخصص فقط */
  totalRemaining: number;
  /** عدد العمليات المالية الجارية (إيراد + مصروف) */
  operationCount: number;
  incomeCount: number;
  expenseCount: number;
  /** عدد العمليات التي أُرفقت لها فاتورة/إيصال */
  withInvoiceCount: number;
  /** عدد العمليات بلا فاتورة مرفقة — معلوماتي لا إلزامي */
  withoutInvoiceCount: number;
  /** عدد البنود التي تجاوز مصروفها مخصصها */
  overAllocationCount: number;
  /** عدد البنود التي قاربت استنفاد مخصصها دون تجاوزه */
  nearExhaustionCount: number;
  /** عدد العمليات المسجّلة بلا مبلغ — نقص ظاهر لا يختفي خلف صفر */
  missingAmountCount: number;
  /** عدد العمليات بلا بند مالي */
  unassignedCount: number;
};

/** الملخّص المالي المدرسي الشامل — يبني على خطوط البنود نفسها فلا رقم يُحسب مرتين */
export function summarizeSchoolFinance(
  items: FinancialItemInput[],
  income: FinanceRecord[],
  expenses: FinanceRecord[],
): SchoolFinanceSummary {
  const activeIncome = income.filter(isActive);
  const activeExpenses = expenses.filter(isActive);
  const receivedIncome = activeIncome.filter(isReceived);
  const expectedIncome = activeIncome.filter((r) => r.status === INCOME_EXPECTED);

  const totalIncome = sum(receivedIncome.map((r) => r.amount));
  const totalExpenses = sum(activeExpenses.map((r) => r.amount));

  const lines = financialItemLines(items, income, expenses);
  const liveLines = lines.filter((l) => !l.archived);
  const totalAllocated = sum(liveLines.map((l) => l.allocated));
  const totalRemaining = sum(liveLines.map((l) => l.remaining));

  // العمليات المحتسبة في مؤشرات الفواتير والنقص: الإيراد الفعلي والمتوقع والمصروف،
  // دون الملغى (لا يمثّل عملية قائمة).
  const operations = [...activeIncome.filter((r) => r.status !== INCOME_CANCELLED), ...activeExpenses];

  return {
    totalIncome,
    totalExpectedIncome: sum(expectedIncome.map((r) => r.amount)),
    totalExpenses,
    cashBalance: moneySubtract(totalIncome, totalExpenses),
    totalAllocated,
    totalRemaining,
    operationCount: operations.length,
    incomeCount: activeIncome.filter((r) => r.status !== INCOME_CANCELLED).length,
    expenseCount: activeExpenses.length,
    withInvoiceCount: operations.filter((r) => r.hasInvoice).length,
    withoutInvoiceCount: operations.filter((r) => !r.hasInvoice).length,
    overAllocationCount: liveLines.filter((l) => l.overspent).length,
    nearExhaustionCount: liveLines.filter((l) => l.nearExhaustion && !l.overspent).length,
    missingAmountCount: operations.filter((r) => r.amount === null).length,
    unassignedCount: operations.filter((r) => !r.financialItemId).length,
  };
}

/**
 * تحذير تجاوز المخصص (v2.2 §B7) — **تحذير فقط، لا يمنع الحفظ ولا يطلب إقراراً**.
 *
 * يعيد مقدار التجاوز المتوقع لصياغة الرسالة العربية. لا يوجد مربع اختيار ولا حقل إلزامي،
 * ولا يُصبغ أي حقل بالأحمر لعدم «الإقرار» — التحذير معلوماتي بحت.
 */
export function overrunWarning(opts: {
  allocated: number | null;
  spentSoFar: number;
  newAmount: number | null;
}): { willOverrun: boolean; overrunBy: number; remainingAfter: number | null } {
  // بلا مخصص مُدخل لا يوجد تجاوز يُقاس
  if (opts.allocated === null) return { willOverrun: false, overrunBy: 0, remainingAfter: null };
  const remainingAfter = fromMinor(
    toMinor(opts.allocated) - toMinor(opts.spentSoFar) - toMinor(opts.newAmount ?? 0),
  );
  return {
    willOverrun: remainingAfter < 0,
    overrunBy: remainingAfter < 0 ? Math.abs(remainingAfter) : 0,
    remainingAfter,
  };
}

/* ── تفصيل البند والنشاط الحديث (v2.3 §6) ────────────────────────────────── */

/** سطر في دفتر عمليات مُدمج (إيراد + مصروف) مع رصيد جارٍ */
export type LedgerLine = {
  id: string;
  kind: "إيراد" | "مصروف";
  /** مفتاح الترتيب الزمني المعروض (تاريخ العملية أو تاريخ الإدخال) */
  date: string | null;
  amount: number | null;
  /** الرصيد الجاري بعد هذه العملية: الإيراد المستلم يضيف والمصروف يخصم */
  runningBalance: number;
  /**
   * v2.4 §4: المتبقي من مخصص البند قبل هذه العملية وبعدها — للمصروفات فقط
   * (الإيراد لا يغير المتبقي من المخصص). `null` حين لا مخصص للبند أو للإيراد.
   */
  remainingBefore: number | null;
  remainingAfter: number | null;
};

/** مقارنة حتمية للعمليات: التاريخ ثم وقت الإدخال ثم المعرف — لا يتأرجح ترتيب اليوم الواحد */
function compareOperations(a: { r: FinanceRecord }, b: { r: FinanceRecord }): number {
  const byDate = operationSortKey(a.r).localeCompare(operationSortKey(b.r));
  if (byDate !== 0) return byDate;
  const aT = a.r.createdAt?.getTime() ?? 0;
  const bT = b.r.createdAt?.getTime() ?? 0;
  if (aT !== bT) return aT - bT;
  return a.r.id.localeCompare(b.r.id);
}

/**
 * دفتر عمليات مُدمج بترتيب زمني تصاعدي مع رصيد جارٍ.
 * الإيراد المحتسب في الرصيد هو «مستلم» فقط — «متوقع» يظهر في الدفتر دون أثر على
 * الرصيد (تمييزاً لا إخفاءً)، و«ملغى» لا يظهر. المؤرشف خارج الدفتر.
 * عند تمرير مخصص البند يُحسب لكل مصروف المتبقي من المخصص قبل العملية وبعدها.
 */
export function ledgerWithRunningBalance(
  income: FinanceRecord[],
  expenses: FinanceRecord[],
  opts?: { allocated?: number | null },
): LedgerLine[] {
  const allocated = opts?.allocated ?? null;
  const rows: { r: FinanceRecord; kind: "إيراد" | "مصروف" }[] = [
    ...income.filter((r) => isActive(r) && r.status !== INCOME_CANCELLED).map((r) => ({ r, kind: "إيراد" as const })),
    ...expenses.filter(isActive).map((r) => ({ r, kind: "مصروف" as const })),
  ];
  rows.sort(compareOperations);
  let balanceMinor = 0;
  let spentMinor = 0;
  return rows.map(({ r, kind }) => {
    let remainingBefore: number | null = null;
    let remainingAfter: number | null = null;
    if (kind === "مصروف" && allocated !== null) {
      remainingBefore = fromMinor(toMinor(allocated) - spentMinor);
    }
    if (r.amount !== null) {
      if (kind === "إيراد" && isReceived(r)) balanceMinor += toMinor(r.amount);
      if (kind === "مصروف") {
        balanceMinor -= toMinor(r.amount);
        spentMinor += toMinor(r.amount);
      }
    }
    if (kind === "مصروف" && allocated !== null) {
      remainingAfter = fromMinor(toMinor(allocated) - spentMinor);
    }
    return {
      id: r.id,
      kind,
      date: operationSortKey(r) || null,
      amount: r.amount,
      runningBalance: fromMinor(balanceMinor),
      remainingBefore,
      remainingAfter,
    };
  });
}

/** البنود الأعلى صرفاً — غير المؤرشفة، تنازلياً بالمصروف، مع استبعاد بند بلا أي صرف */
export function topSpendingItems(lines: FinancialItemLine[], limit = 5): FinancialItemLine[] {
  return lines
    .filter((l) => !l.archived && l.expenses > 0)
    .sort((a, b) => b.expenses - a.expenses)
    .slice(0, limit);
}

/** البنود القريبة من النفاد (بلغت العتبة دون تجاوز) — قائمة لا مجرد عدد */
export function nearExhaustionItems(lines: FinancialItemLine[]): FinancialItemLine[] {
  return lines.filter((l) => !l.archived && l.nearExhaustion && !l.overspent);
}

/** البنود المتجاوزة لمخصصها — قائمة */
export function overspentItems(lines: FinancialItemLine[]): FinancialItemLine[] {
  return lines.filter((l) => !l.archived && l.overspent);
}

/** أحدث العمليات المالية (إيراد + مصروف) تنازلياً — للوحات «النشاط المالي الأخير» */
export function recentOperations(
  income: FinanceRecord[],
  expenses: FinanceRecord[],
  limit = 8,
): { id: string; kind: "إيراد" | "مصروف"; date: string | null; amount: number | null; financialItemId: string | null }[] {
  const rows = [
    ...income.filter((r) => isActive(r) && r.status !== INCOME_CANCELLED).map((r) => ({ r, kind: "إيراد" as const })),
    ...expenses.filter(isActive).map((r) => ({ r, kind: "مصروف" as const })),
  ];
  rows.sort((a, b) => operationSortKey(b.r).localeCompare(operationSortKey(a.r)));
  return rows.slice(0, limit).map(({ r, kind }) => ({
    id: r.id,
    kind,
    date: operationSortKey(r) || null,
    amount: r.amount,
    financialItemId: r.financialItemId,
  }));
}

/** مجموع شهري لرسم الاتجاه — المفتاح «YYYY-MM»، والعمليات بلا تاريخ تُستثنى بوضوح */
export function monthlyTotals(records: FinanceRecord[]): { month: string; total: number; count: number }[] {
  const byMonth = new Map<string, { totalMinor: number; count: number }>();
  for (const r of records) {
    if (!isActive(r) || !r.date) continue;
    const month = r.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue; // تاريخ مشوّه لا يُفسَّر ولا يُسقط الحساب
    const cur = byMonth.get(month) ?? { totalMinor: 0, count: 0 };
    if (r.amount !== null) cur.totalMinor += toMinor(r.amount);
    cur.count += 1;
    byMonth.set(month, cur);
  }
  return [...byMonth.entries()]
    .map(([month, v]) => ({ month, total: fromMinor(v.totalMinor), count: v.count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

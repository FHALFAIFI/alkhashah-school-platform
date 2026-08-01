import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears } from "@/db/schema";
import { formatMoney, orDash, orFallback } from "@/lib/format";
import { PageHeader, Card, Badge, Table, EmptyState, LinkButton } from "@/components/ui";
import { getSchoolFinance } from "@/lib/finance/service";
import { NEAR_EXHAUSTION_PERCENT } from "@/lib/finance/calc";
import { evidenceForEntity } from "@/lib/evidence";
import { EvidencePanel } from "@/components/evidence-panel";
import {
  AddIncomeForm,
  AddExpenseForm,
  FinancialItemForm,
  CreateDefaultItemsButton,
  ItemRowActions,
  RecordRowActions,
  type ItemLine,
} from "./budget-ui";
import { Stat } from "./stat";
import { Tutorial } from "@/components/tutorial";

export const metadata = { title: "المالية المدرسية" };
export const dynamic = "force-dynamic";

/**
 * لوحة المالية المدرسية (v2.2 §B6).
 *
 * كل رقم معروض يأتي من خدمة الحساب الموحّدة على الخادم (`@/lib/finance/calc`) — لا حساب
 * على العميل ولا مسار حساب ثانٍ. القيم الفارغة تُعرض «—» لا صفراً مضلِّلاً.
 *
 * لا ارتباط تشغيلي ببرنامج أو تصنيف أو مجال (§B1): التبويب الوحيد هو «بند الصرف».
 */

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const user = await requirePermission("budget.read");
  const canWrite = user.permissions.has("budget.write");
  const canWriteEvidence = user.permissions.has("evidence.write");
  const sp = await searchParams;

  const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة")).orderBy(desc(planYears.createdAt)).limit(1);
  if (!activeYear) {
    return (
      <div>
        <PageHeader title="المالية المدرسية" subtitle="متتبّع مالي للمدرسة — لا نظام محاسبي كامل" />
        <EmptyState title="لا سنة تخطيطية نشطة" hint="أنشئ سنة تخطيطية أولاً من الخطة التشغيلية" />
      </div>
    );
  }

  // المالية على مستوى المدرسة: السنة فترة محاسبية للترشيح الزمني لا ارتباط ببرنامج.
  const finance = await getSchoolFinance({ planYearId: activeYear.id });
  const { summary, items, lines, income, expenses } = finance;

  const liveLines = lines.filter((l) => !l.archived);
  const archivedLines = lines.filter((l) => l.archived);

  // نموذج البنود لواجهة الإدخال — الأرقام محسوبة على الخادم ومُمرَّرة كما هي
  const itemOptions: ItemLine[] = liveLines.map((l) => ({
    id: l.id,
    name: l.name,
    allocated: l.allocated,
    income: l.income,
    expenses: l.expenses,
    remaining: l.remaining,
    hasAllocation: l.hasAllocation,
  }));

  const activeIncome = income.filter((r) => !r.archivedAt);
  const activeExpenses = expenses.filter((r) => !r.archivedAt);
  const archivedCount = income.length - activeIncome.length + (expenses.length - activeExpenses.length);

  // لوحة الإيصال/الفاتورة للسجل المحدد (D-026) — تتيح إرفاق إيصال بسجل **محفوظ مسبقاً**
  // أو ربط شاهد قائم بلا رفع مكرر. الرفع عند الإنشاء لا يغني عنها: كثيراً ما تصل الفاتورة
  // بعد تسجيل العملية.
  const selIncomeId = sp["إيراد"];
  const selExpenseId = sp["مصروف"];
  let receipt:
    | { entityType: "budget_income" | "budget_expense"; id: string; title: string; items: Awaited<ReturnType<typeof evidenceForEntity>> }
    | null = null;
  if (selIncomeId) {
    const inc = income.find((i) => i.id === selIncomeId);
    if (inc) receipt = { entityType: "budget_income", id: inc.id, title: `إيراد: ${orFallback(inc.source, "بدون مصدر")}`, items: await evidenceForEntity("budget_income", inc.id) };
  } else if (selExpenseId) {
    const exp = expenses.find((e) => e.id === selExpenseId);
    if (exp) receipt = { entityType: "budget_expense", id: exp.id, title: `مصروف: ${orFallback(exp.category, formatMoney(exp.amount))}`, items: await evidenceForEntity("budget_expense", exp.id) };
  }
  // الوسم: «فاتورة» للمصروف و«إيصال» للإيراد (D-026)
  const isExpenseReceipt = receipt?.entityType === "budget_expense";
  const receiptWord = isExpenseReceipt ? "الفاتورة" : "الإيصال";

  return (
    <div className="space-y-6">
      <PageHeader
        title="المالية المدرسية"
        subtitle={`${activeYear.nameAr} — الإيرادات والمصروفات وبنود الصرف على مستوى المدرسة`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href="/reports?category=finance" variant="secondary">تقارير القسم</LinkButton>
            <Badge value={activeYear.status} />
          </div>
        }
      />

      <Tutorial
        id="budget"
        title="سير العمل المالي"
        steps={[
          "أنشئ بنود الصرف وحدد المبلغ المعتمد لكل بند (اختياري).",
          "سجّل الإيرادات والمصروفات بتاريخها ورقم فاتورتها ومرفقها — كل الحقول اختيارية.",
          "انقر بطاقة البند لكامل تفاصيله: العمليات والرصيد الجاري وسجل التعديل.",
          "تجاوز المخصص تنبيه معلوماتي فقط — لا يمنع الحفظ ولا يتطلب إقراراً.",
          "الرصيد النقدي = الإيراد المستلم − المصروف، ومخصصات البنود مفهوم مستقل عنه.",
        ]}
      />

      {/* لوحة الإيصال/الفاتورة للسجل المحدد — رفع مباشر أو ربط شاهد قائم */}
      {receipt && (
        <div id="receipt" className="scroll-mt-20">
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-brand-900">{receiptWord}/شاهد — {receipt.title}</h2>
              <Link href="/budget" className="text-xs text-gray-500 hover:underline">إغلاق</Link>
            </div>
            <p className="mb-3 text-xs text-gray-400">
              {isExpenseReceipt ? "إرفاق الفاتورة اختياري" : "الإيصال اختياري"} ولا يُطلب رفعه مكرراً إن كان الشاهد نفسه موجوداً في السجل الموحّد.
            </p>
            <EvidencePanel
              entityType={receipt.entityType}
              entityId={receipt.id}
              items={receipt.items.map((e) => ({ id: e.item.id, title: e.item.title, kind: e.item.kind, role: e.item.role, fileId: e.item.fileId }))}
              canWrite={canWriteEvidence}
            />
          </Card>
        </div>
      )}

      {/* ── المؤشرات العليا ───────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-bold text-gray-600">الملخّص المالي</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Stat label="إجمالي الإيرادات" value={formatMoney(summary.totalIncome)} tone="good" href="/reports?category=finance&report=income-register" />
          <Stat label="إجمالي المصروفات" value={formatMoney(summary.totalExpenses)} href="/reports?category=finance&report=expense-register" />
          <Stat
            label="الرصيد الحالي"
            value={formatMoney(summary.cashBalance)}
            tone={summary.cashBalance < 0 ? "bad" : "good"}
            hint="الإيراد المستلم − المصروف"
          />
          <Stat label="إجمالي المخصصات" value={formatMoney(summary.totalAllocated)} href="/reports?category=finance&report=item-allocations" />
          <Stat label="إجمالي المتبقي" value={formatMoney(summary.totalRemaining)} tone={summary.totalRemaining < 0 ? "bad" : "plain"} />
          <Stat label="عدد العمليات المالية" value={String(summary.operationCount)} href="/reports?category=finance&report=all-operations" />
          <Stat label="عدد الفواتير المرفقة" value={String(summary.withInvoiceCount)} href="/reports?category=finance&report=invoice-register" />
          <Stat
            label="عدد العمليات بدون فاتورة"
            value={String(summary.withoutInvoiceCount)}
            tone={summary.withoutInvoiceCount > 0 ? "warn" : "good"}
            href="/reports?category=finance&report=missing-invoice"
          />
          <Stat
            label="عدد البنود المتجاوزة للمخصص"
            value={String(summary.overAllocationCount)}
            tone={summary.overAllocationCount > 0 ? "bad" : "good"}
            href="/reports?category=finance&report=over-budget"
          />
          {/* v2.4 §4: مؤشرا الاقتراب من الاستنفاد والعمليات بلا مبلغ كانا يُحسبان دون عرض */}
          <Stat
            label="بنود قاربت الاستنفاد"
            value={String(summary.nearExhaustionCount)}
            tone={summary.nearExhaustionCount > 0 ? "warn" : "good"}
            hint={`بلغت ${NEAR_EXHAUSTION_PERCENT}٪ من مخصصها دون تجاوزه`}
            href="/reports?category=finance&report=item-allocations"
          />
          <Stat
            label="عمليات بلا مبلغ مُدخل"
            value={String(summary.missingAmountCount)}
            tone={summary.missingAmountCount > 0 ? "warn" : "good"}
            hint="نقص ظاهر لا يختفي خلف صفر"
          />
          <Stat
            label="الإيراد المتوقع"
            value={formatMoney(summary.totalExpectedIncome)}
            hint="لم يُقبض — خارج الرصيد"
          />
        </div>
      </section>

      {/* ── بطاقات البنود (v2.3 §6): بطاقة تشغيلية لكل بند تنقر فتفتح تفصيله ── */}
      {liveLines.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold text-gray-600">بطاقات البنود — انقر البطاقة لكامل التفاصيل</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveLines.map((l) => (
              <Link
                key={l.id}
                href={`/budget/items/${l.id}`}
                className="block rounded-xl border border-sand-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-bold text-brand-900">{orFallback(l.name, "بند بدون اسم")}</span>
                  {l.overspent ? <Badge value="تجاوز" /> : l.nearExhaustion ? <Badge value="قارب الاستنفاد" /> : null}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-gray-500">المبلغ المعتمد</dt>
                  <dd className="tabular-nums">{l.hasAllocation ? formatMoney(l.allocated) : "—"}</dd>
                  <dt className="text-gray-500">المصروف</dt>
                  <dd className="tabular-nums">{formatMoney(l.expenses)}</dd>
                  <dt className="text-gray-500">المتبقي</dt>
                  <dd className={`tabular-nums ${l.overspent ? "text-red-700" : ""}`}>
                    {l.remaining === null ? "—" : formatMoney(l.remaining)}
                  </dd>
                  <dt className="text-gray-500">نسبة الاستخدام</dt>
                  <dd className="tabular-nums">{l.spentPercent === null ? "—" : `${l.spentPercent}٪`}</dd>
                  <dt className="text-gray-500">عدد العمليات</dt>
                  <dd className="tabular-nums">{l.operationCount}</dd>
                  <dt className="text-gray-500">آخر عملية</dt>
                  <dd className="tabular-nums">
                    {l.lastOperation?.date ?? "—"}
                    {l.lastOperation && l.lastOperation.amount !== null
                      ? ` (${formatMoney(l.lastOperation.amount)})`
                      : ""}
                  </dd>
                </dl>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── بنود الصرف ───────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-600">بنود الصرف</h2>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              {items.length === 0 && <CreateDefaultItemsButton />}
              <FinancialItemForm />
            </div>
          )}
        </div>
        {liveLines.length === 0 ? (
          <EmptyState
            title="لا توجد بنود صرف بعد"
            hint="أنشئ بنداً، أو استعمل «إنشاء البندين الأساسيين» لإضافة المستلزمات والنشاط."
          />
        ) : (
          <Table headers={["البند", "المخصص", "الإيراد", "المصروف", "المتبقي", "٪ الإنفاق", "العمليات", "الحالة", ""]}>
            {liveLines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 font-medium">
                  <Link href={`/budget/items/${l.id}`} className="text-brand-800 hover:underline">
                    {orFallback(l.name, "بند بدون اسم")}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">{formatMoney(l.allocated)}</td>
                <td className="px-3 py-2 tabular-nums">{formatMoney(l.income)}</td>
                <td className="px-3 py-2 tabular-nums">{formatMoney(l.expenses)}</td>
                <td className={`px-3 py-2 tabular-nums ${l.overspent ? "text-red-700" : ""}`}>{formatMoney(l.remaining)}</td>
                <td className="px-3 py-2 tabular-nums">{l.spentPercent === null ? "—" : `${l.spentPercent}٪`}</td>
                <td className="px-3 py-2 tabular-nums">{l.operationCount}</td>
                <td className="px-3 py-2">
                  {l.overspent ? <Badge value="تجاوز" /> : l.nearExhaustion ? <Badge value="قارب الاستنفاد" /> : null}
                </td>
                <td className="px-3 py-2">{canWrite && <ItemRowActions id={l.id} archived={false} />}</td>
              </tr>
            ))}
          </Table>
        )}

        {archivedLines.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-gray-500">بنود مؤرشفة ({archivedLines.length})</summary>
            <div className="mt-2">
              <Table headers={["البند", "المخصص", "المصروف", ""]}>
                {archivedLines.map((l) => (
                  <tr key={l.id} className="text-gray-500">
                    <td className="px-3 py-2">{orFallback(l.name, "بند بدون اسم")}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(l.allocated)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(l.expenses)}</td>
                    <td className="px-3 py-2">{canWrite && <ItemRowActions id={l.id} archived />}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </details>
        )}
      </section>

      {/* ── الإيرادات ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-600">الإيرادات ({activeIncome.length})</h2>
          {canWrite && <AddIncomeForm planYearId={activeYear.id} items={itemOptions} />}
        </div>
        {activeIncome.length === 0 ? (
          <EmptyState title="لا إيرادات مسجّلة" />
        ) : (
          <Table headers={["المصدر", "المبلغ", "التاريخ", "البند", "الحالة", "الإيصال", ""]}>
            {activeIncome.map((r) => (
              <tr key={r.id} className={selIncomeId === r.id ? "bg-brand-50" : undefined}>
                <td className="px-3 py-2">{orFallback(r.source, "بدون مصدر")}</td>
                <td className="px-3 py-2 tabular-nums">{formatMoney(r.amount)}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{orDash(r.incomeDate)}</td>
                <td className="px-3 py-2 text-xs">{r.itemName ? orFallback(r.itemName, "بند بدون اسم") : "—"}</td>
                <td className="px-3 py-2"><Badge value={r.status} /></td>
                <td className="px-3 py-2 text-xs"><ReceiptCell hasReceipt={r.hasInvoice} href={`/budget?إيراد=${r.id}#receipt`} label="الإيصال" /></td>
                <td className="px-3 py-2">{canWrite && <RecordRowActions kind="income" id={r.id} archived={false} />}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {/* ── المصروفات ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-gray-600">المصروفات ({activeExpenses.length})</h2>
          {canWrite && <AddExpenseForm planYearId={activeYear.id} items={itemOptions} />}
        </div>
        {activeExpenses.length === 0 ? (
          <EmptyState title="لا مصروفات مسجّلة" />
        ) : (
          <Table headers={["المبلغ", "التاريخ", "البند", "رقم الفاتورة", "المورّد", "الفاتورة", ""]}>
            {activeExpenses.map((r) => (
              <tr key={r.id} className={selExpenseId === r.id ? "bg-brand-50" : undefined}>
                <td className="px-3 py-2 tabular-nums">{formatMoney(r.amount)}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{orDash(r.expenseDate)}</td>
                <td className="px-3 py-2 text-xs">
                  {r.itemName ? (
                    orFallback(r.itemName, "بند بدون اسم")
                  ) : r.items ? (
                    // «البند» النصي القديم — مرجع تاريخي لا يدخل الحساب الجديد
                    <span className="text-gray-400" title="بند نصي تاريخي — قبل اعتماد بنود الصرف">{r.items} (تاريخي)</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{orDash(r.paymentReference)}</td>
                <td className="px-3 py-2 text-xs">{orDash(r.supplier)}</td>
                <td className="px-3 py-2 text-xs"><ReceiptCell hasReceipt={r.hasInvoice} href={`/budget?مصروف=${r.id}#receipt`} label="الفاتورة" /></td>
                <td className="px-3 py-2">{canWrite && <RecordRowActions kind="expense" id={r.id} archived={false} />}</td>
              </tr>
            ))}
          </Table>
        )}
        {archivedCount > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            يوجد {archivedCount} سجل مؤرشف — يظهر في تقارير الأرشيف ولا يدخل المجاميع الجارية.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * خلية الإيصال/الفاتورة — تعرض حالة الإرفاق وتفتح لوحة الشواهد للسجل نفسه.
 * وجودها يسمح بإرفاق إيصال بسجل محفوظ مسبقاً، لا عند الإنشاء فقط (D-026).
 */
function ReceiptCell({ hasReceipt, href, label }: { hasReceipt: boolean; href: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {hasReceipt ? <Badge value="مرفق" /> : <span className="text-gray-400">—</span>}
      <Link href={href} className="text-brand-700 hover:underline">{label}</Link>
    </span>
  );
}

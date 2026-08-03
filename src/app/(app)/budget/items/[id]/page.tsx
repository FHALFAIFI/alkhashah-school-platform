import { asc, desc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, financialItems } from "@/db/schema";
import { PageHeader, Card, Table, Badge, EmptyState } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { formatMoney, orDash, orFallback } from "@/lib/format";
import { dualNumericCell } from "@/lib/dates";
import { getItemFinanceDetail } from "@/lib/finance/service";
import {
  ALLOCATION_NONE_HINT,
  ALLOCATION_NONE_VALUE,
  REMAINING_UNAVAILABLE,
  ZERO_ALLOCATION_WARNING,
} from "@/lib/finance/allocation";
import { Stat } from "../../stat";
import { SetAllocationForm } from "../../allocation-ui";
import { EditIncomeForm, EditExpenseForm, DeleteOperationButton } from "./item-detail-ui";

export const metadata = { title: "تفصيل بند مالي" };
export const dynamic = "force-dynamic";

/**
 * صفحة تفصيل البند المالي (v2.3 §6) — النقر على بطاقة البند يفتح كامل عملياته:
 * إيرادات ومصروفات، رقم الفاتورة، التاريخ (مزدوج التقويم)، الوصف، المبلغ، المرفق،
 * مُدخِل العملية وسجل الإنشاء والتعديل، والرصيد الجاري.
 *
 * كل الأرقام من خدمة الحساب الوحيدة (`lib/finance/calc`) — لا حساب ثانٍ هنا.
 */
export default async function FinancialItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("budget.read");
  const canWrite = user.permissions.has("budget.write");
  const { id } = await params;

  const [activeYear] = await db
    .select()
    .from(planYears)
    .where(eq(planYears.status, "نشطة"))
    .orderBy(desc(planYears.createdAt))
    .limit(1);
  if (!activeYear) notFound();

  const detail = await getItemFinanceDetail(id, { planYearId: activeYear.id });
  if (!detail) notFound();
  const { line, income, expenses, ledger, userNames } = detail;

  // كل البنود الحيّة — نموذج التعديل يسمح بنقل العملية إلى بند آخر (يعيد حساب البندين تلقائياً)
  const liveItems = await db
    .select({ id: financialItems.id, name: financialItems.nameAr })
    .from(financialItems)
    .where(isNull(financialItems.archivedAt))
    .orderBy(asc(financialItems.sortOrder));
  const itemOptions = liveItems;

  const usagePercent = line.spentPercent === null ? "—" : `${line.spentPercent}٪`;
  const lastOp = line.lastOperation;

  return (
    <div>
      <div className="mb-3 print:hidden">
        <BackButton fallbackHref="/budget" label="عودة إلى المالية" />
      </div>
      <PageHeader
        title={orFallback(line.name, "بند بدون اسم")}
        subtitle="تفصيل كامل لعمليات البند — الأرقام من مصدر الحساب الموحّد نفسه المستعمل في اللوحة والتقارير"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {line.overspent ? (
              <Badge value="تجاوز" />
            ) : line.nearExhaustion ? (
              <Badge value="قارب الاستنفاد" />
            ) : null}
            {/* تصحيح المخصص متاح دائماً للمخوَّل — لا يقتصر على حالة «لا مخصص» (§4.5) */}
            {canWrite && line.allocationState !== "none" && (
              <SetAllocationForm
                itemId={id}
                itemName={orFallback(line.name, "بند بدون اسم")}
                currentAllocation={line.allocated}
                spent={line.expenses}
                compact
              />
            )}
          </div>
        }
      />

      {/* v2.4.1 §4.1: البند بلا مخصص لا يعرض «—» مجرداً — يشرح السبب ويقدّم الإجراء المصحّح */}
      {line.allocationState === "none" && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-900">{ALLOCATION_NONE_HINT}</p>
              <p className="mt-1 text-xs text-amber-800">
                المصروف مسجَّل ومحسوب ({formatMoney(line.expenses)})، لكن {REMAINING_UNAVAILABLE}. مخصصات
                «بنود الميزانية» في الخطة التشغيلية سجلٌّ سنوي منفصل ولا تُنقل تلقائياً إلى بنود الصرف
                المدرسية — حدّد المخصص هنا ليظهر المتبقي في البطاقة والدفتر والتقارير.
              </p>
            </div>
            {canWrite && (
              <SetAllocationForm
                itemId={id}
                itemName={orFallback(line.name, "بند بدون اسم")}
                currentAllocation={line.allocated}
                spent={line.expenses}
              />
            )}
          </div>
        </Card>
      )}

      {/* §4.2: الصرف على بند مخصصه صفر حالة مستقلة عن «لا مخصص» */}
      {line.zeroAllocationSpending && (
        <Card className="mb-4 border-red-300 bg-red-50">
          <p className="text-sm font-medium text-red-900">{ZERO_ALLOCATION_WARNING}</p>
        </Card>
      )}

      {/* بطاقة البند الكاملة (§6): المعتمد/المصروف/المتبقي/النسبة/العمليات/آخر عملية */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="المبلغ المعتمد"
          value={line.hasAllocation ? formatMoney(line.allocated as number) : ALLOCATION_NONE_VALUE}
          hint={line.hasAllocation ? undefined : ALLOCATION_NONE_HINT}
        />
        <Stat label="المصروف" value={formatMoney(line.expenses)} />
        <Stat
          label="المتبقي"
          value={line.remaining === null ? ALLOCATION_NONE_VALUE : formatMoney(line.remaining)}
          hint={line.remaining === null ? REMAINING_UNAVAILABLE : undefined}
          tone={line.overspent ? "bad" : line.nearExhaustion ? "warn" : "good"}
        />
        <Stat label="نسبة الاستخدام" value={usagePercent} />
        <Stat label="عدد العمليات" value={String(line.operationCount)} />
        <Stat label="الإيراد المنسوب للبند" value={formatMoney(line.income)} />
        <Stat
          label="آخر عملية مالية"
          value={lastOp?.date ? dualNumericCell(lastOp.date) : "—"}
          hint={lastOp ? lastOp.kind : "لا عمليات بعد"}
        />
        <Stat label="قيمة آخر عملية" value={lastOp && lastOp.amount !== null ? formatMoney(lastOp.amount) : "—"} />
      </div>

      {/* الدفتر المُدمج بالرصيد الجاري + المتبقي من المخصص قبل/بعد كل مصروف (v2.4 §4) */}
      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-bold text-brand-900">دفتر عمليات البند (بالرصيد الجاري)</h2>
        {/* v2.4.1 §4.1: اختفاء عمودَي «المتبقي قبل/بعد» يُشرح بدل أن يحدث صامتاً */}
        {line.allocationState === "none" && ledger.length > 0 && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            عمودا «المتبقي قبل العملية» و«المتبقي بعد العملية» لا يظهران لأن {ALLOCATION_NONE_HINT} —
            الرصيد النقدي الجاري يظهر كما هو.
          </p>
        )}
        {ledger.length === 0 ? (
          <EmptyState title="لا عمليات على هذا البند بعد" hint="تُسجَّل العمليات من لوحة المالية مع اختيار هذا البند" />
        ) : (
          <Table
            headers={
              line.hasAllocation
                ? ["التاريخ", "النوع", "المتبقي قبل العملية", "المبلغ", "المتبقي بعد العملية", "الرصيد النقدي الجاري"]
                : ["التاريخ", "النوع", "المبلغ", "الرصيد النقدي الجاري"]
            }
          >
            {ledger.map((l) => (
              <tr key={`${l.kind}-${l.id}`}>
                <td className="px-3 py-2 text-xs tabular-nums">{l.date ? dualNumericCell(l.date) : "—"}</td>
                <td className="px-3 py-2"><Badge value={l.kind} /></td>
                {line.hasAllocation && (
                  <td className="px-3 py-2 tabular-nums text-gray-500">
                    {l.remainingBefore === null ? "—" : formatMoney(l.remainingBefore)}
                  </td>
                )}
                <td className="px-3 py-2 tabular-nums">{l.amount === null ? "—" : formatMoney(l.amount)}</td>
                {line.hasAllocation && (
                  <td className={`px-3 py-2 tabular-nums ${l.remainingAfter !== null && l.remainingAfter < 0 ? "text-red-700" : ""}`}>
                    {l.remainingAfter === null ? "—" : formatMoney(l.remainingAfter)}
                  </td>
                )}
                <td className={`px-3 py-2 tabular-nums ${l.runningBalance < 0 ? "text-red-700" : ""}`}>{formatMoney(l.runningBalance)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* الإيرادات التفصيلية */}
      <Card className="mb-4">
        <h2 className="mb-2 text-sm font-bold text-brand-900">إيرادات البند ({income.length})</h2>
        {income.length === 0 ? (
          <EmptyState title="لا إيرادات منسوبة لهذا البند" />
        ) : (
          <Table headers={["المصدر", "المبلغ", "التاريخ", "رقم الفاتورة", "الحالة", "الإيصال", "أدخلها", "آخر تعديل", ""]}>
            {income.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium">{orFallback(r.source, "بدون مصدر")}</td>
                <td className="px-3 py-2 tabular-nums">{r.amount === null ? "—" : formatMoney(Number(r.amount))}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{r.incomeDate ? dualNumericCell(r.incomeDate) : "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{orDash(r.paymentReference)}</td>
                <td className="px-3 py-2"><Badge value={r.status} /></td>
                <td className="px-3 py-2 text-xs">
                  {r.hasInvoice ? (
                    <a href={`/budget?إيراد=${r.id}#receipt`} className="text-brand-700 underline">مرفق</a>
                  ) : (
                    <a href={`/budget?إيراد=${r.id}#receipt`} className="text-gray-400 underline">إرفاق</a>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.createdBy ? userNames.get(r.createdBy) ?? "—" : "—"}
                  <div className="text-gray-400 tabular-nums">{dualNumericCell(r.createdAt)}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.updatedBy ? (
                    <>
                      {userNames.get(r.updatedBy) ?? "—"}
                      <div className="text-gray-400 tabular-nums">{dualNumericCell(r.updatedAt)}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {canWrite && (
                    <div className="flex flex-wrap items-start gap-1">
                      <EditIncomeForm
                        income={{
                          id: r.id,
                          source: r.source,
                          amount: r.amount,
                          incomeDate: r.incomeDate,
                          purpose: r.purpose,
                          financialItemId: r.financialItemId,
                          status: r.status,
                          paymentReference: r.paymentReference,
                          notes: r.notes,
                        }}
                        items={itemOptions}
                      />
                      <DeleteOperationButton kind="إيراد" id={r.id} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* المصروفات التفصيلية */}
      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">مصروفات البند ({expenses.length})</h2>
        {expenses.length === 0 ? (
          <EmptyState title="لا مصروفات منسوبة لهذا البند" />
        ) : (
          <Table headers={["المبلغ", "التاريخ", "رقم الفاتورة", "المورّد", "الوصف", "الفاتورة", "أدخلها", "آخر تعديل", ""]}>
            {expenses.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 tabular-nums">{r.amount === null ? "—" : formatMoney(Number(r.amount))}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{r.expenseDate ? dualNumericCell(r.expenseDate) : "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{orDash(r.paymentReference)}</td>
                <td className="px-3 py-2 text-xs">{orDash(r.supplier)}</td>
                <td className="px-3 py-2 text-xs">{orDash(r.category ?? r.notes)}</td>
                <td className="px-3 py-2 text-xs">
                  {r.hasInvoice ? (
                    <a href={`/budget?مصروف=${r.id}#receipt`} className="text-brand-700 underline">مرفقة</a>
                  ) : (
                    <a href={`/budget?مصروف=${r.id}#receipt`} className="text-gray-400 underline">إرفاق</a>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.createdBy ? userNames.get(r.createdBy) ?? "—" : "—"}
                  <div className="text-gray-400 tabular-nums">{dualNumericCell(r.createdAt)}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.updatedBy ? (
                    <>
                      {userNames.get(r.updatedBy) ?? "—"}
                      <div className="text-gray-400 tabular-nums">{dualNumericCell(r.updatedAt)}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {canWrite && (
                    <div className="flex flex-wrap items-start gap-1">
                      <EditExpenseForm
                        expense={{
                          id: r.id,
                          amount: r.amount,
                          expenseDate: r.expenseDate,
                          financialItemId: r.financialItemId,
                          category: r.category,
                          supplier: r.supplier,
                          paymentReference: r.paymentReference,
                          notes: r.notes,
                        }}
                        items={itemOptions}
                      />
                      <DeleteOperationButton kind="مصروف" id={r.id} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

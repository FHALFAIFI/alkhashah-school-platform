import { asc, desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { planYears, programs } from "@/db/schema";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { getBudgetOverview } from "@/lib/budget/service";
import { AddIncomeForm, AddExpenseForm, DeleteButton, AcknowledgeOverspendForm } from "./budget-ui";

export const metadata = { title: "الميزانية والمصروفات" };
export const dynamic = "force-dynamic";

const money = (n: number) => n.toLocaleString("ar-SA", { maximumFractionDigits: 2 });

export default async function BudgetPage() {
  const user = await requirePermission("budget.read");
  const canWrite = user.permissions.has("budget.write");

  const [activeYear] = await db.select().from(planYears).where(eq(planYears.status, "نشطة")).orderBy(desc(planYears.createdAt)).limit(1);
  if (!activeYear) {
    return (
      <div>
        <PageHeader title="الميزانية والمصروفات" subtitle="متتبّع ميزانية وشواهد للمدرسة — لا نظام محاسبي كامل" />
        <EmptyState title="لا سنة تخطيطية نشطة" hint="أنشئ سنة تخطيطية أولاً من الخطة التشغيلية" />
      </div>
    );
  }

  const excluded = await getExcludedIdSets();
  const [overview, programRows] = await Promise.all([
    getBudgetOverview(activeYear.id),
    db
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(notSynthetic(programs.id, excluded.programs))
      .orderBy(asc(programs.seq)),
  ]);
  const { summary, income, expenses, programLines } = overview;
  const lineByProgram = new Map(programLines.map((l) => [l.programId, l]));
  const programOptions = programRows.map((p) => {
    const line = lineByProgram.get(p.id);
    return { id: p.id, name: p.name, allocated: line?.allocated ?? 0, spent: line?.spent ?? 0 };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="الميزانية والمصروفات"
        subtitle="متتبّع ميزانية وشواهد للمدرسة — الإيصالات تُربط من سجل الشواهد الموحّد وتظهر في الميزانية والخطة دون رفع مكرر"
      />

      {/* الملخص */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="إجمالي الإيرادات المستلمة" value={money(summary.totalIncomeReceived)} />
        <Stat label="إجمالي المصروفات" value={money(summary.totalExpenses)} />
        <Stat label="الرصيد المتاح" value={money(summary.availableBalance)} tone={summary.availableBalance < 0 ? "bad" : "good"} />
        <Stat label="نسبة الإنفاق" value={`${summary.spendingPercent}٪`} />
        <Stat label="إيرادات متوقعة" value={money(summary.totalIncomeExpected)} />
        <Stat label="مصروفات غير مرتبطة" value={`${summary.unlinkedExpenseCount}`} tone={summary.unlinkedExpenseCount > 0 ? "warn" : "good"} />
        <Stat label="مصروفات بلا إيصال" value={`${summary.missingReceiptCount}`} tone={summary.missingReceiptCount > 0 ? "warn" : "good"} />
        <Stat label="تجاوزات غير مُقَرّة" value={`${summary.unacknowledgedOverspendCount}`} tone={summary.unacknowledgedOverspendCount > 0 ? "bad" : "good"} />
      </div>

      {/* مقارنة المخطط بالفعلي لكل برنامج */}
      {programLines.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold text-brand-900">المخطط مقابل الفعلي (حسب البرنامج)</h2>
          <Table headers={["البرنامج", "المخصص", "المنفَق", "المتبقي", "٪ الإنفاق", ""]}>
            {programLines.map((l) => (
              <tr key={l.programId} className={l.overspent ? "bg-red-50" : ""}>
                <td className="px-3 py-2 font-medium">{l.programName}</td>
                <td className="px-3 py-2 tabular-nums">{money(l.allocated)}</td>
                <td className="px-3 py-2 tabular-nums">{money(l.spent)}</td>
                <td className={`px-3 py-2 tabular-nums ${l.remaining < 0 ? "text-red-600" : ""}`}>{money(l.remaining)}</td>
                <td className="px-3 py-2 tabular-nums">{l.spentPercent}٪</td>
                <td className="px-3 py-2">{l.overspent && <Badge value="تجاوز" />}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* الإيرادات */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">الإيرادات والتمويل ({income.length})</h2>
          {canWrite && <AddIncomeForm planYearId={activeYear.id} programs={programOptions} />}
        </div>
        {income.length === 0 ? (
          <p className="text-sm text-gray-400">لا إيرادات مسجّلة بعد</p>
        ) : (
          <Table headers={["المصدر", "المبلغ", "التاريخ", "الغرض", "الحالة", ""]}>
            {income.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2 font-medium">{i.source}</td>
                <td className="px-3 py-2 tabular-nums">{money(Number(i.amount))}</td>
                <td className="px-3 py-2 text-xs">{i.incomeDate ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{i.purpose ?? "—"}</td>
                <td className="px-3 py-2"><Badge value={i.status} /></td>
                <td className="px-3 py-2">{canWrite && <DeleteButton kind="income" id={i.id} />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* المصروفات */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-brand-900">المصروفات ({expenses.length})</h2>
          {canWrite && <AddExpenseForm planYearId={activeYear.id} programs={programOptions} />}
        </div>
        {expenses.length === 0 ? (
          <p className="text-sm text-gray-400">لا مصروفات مسجّلة بعد</p>
        ) : (
          <Table headers={["التاريخ", "المبلغ", "التصنيف", "البرنامج", "الإيصال", "المسؤول", ""]}>
            {expenses.map((e) => (
              <tr key={e.id} className={e.overspendAcknowledged ? "bg-amber-50" : ""}>
                <td className="px-3 py-2 text-xs">{e.expenseDate ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{money(Number(e.amount))}</td>
                <td className="px-3 py-2 text-xs">{e.category ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{e.programName ?? <span className="text-amber-600">غير مرتبط</span>}</td>
                <td className="px-3 py-2 text-xs">{e.hasReceipt ? <Badge value="مرفق" /> : <span className="text-red-600">ناقص</span>}</td>
                <td className="px-3 py-2 text-xs">{e.responsibleName ?? "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.overspendAcknowledged ? (
                      <Badge value="تجاوز مُقَر" />
                    ) : (
                      canWrite && <AcknowledgeOverspendForm expenseId={e.id} />
                    )}
                    {canWrite && <DeleteButton kind="expense" id={e.id} />}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-gray-400">
          لربط إيصال أو شاهد بمصروف: افتح المصروف من سجل الشواهد الموحّد واربطه بنوع «مصروف ميزانية» — الشاهد نفسه
          يمكن ربطه بالبرنامج والنشاط أيضاً دون رفع مكرر.
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-brand-900";
  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

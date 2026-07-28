import { and, asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people, importBatches } from "@/db/schema";
import { PageHeader, Table, Badge, LinkButton, EmptyState, Card } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { employeeTypeOf } from "@/lib/employee-type";
import { orFallback } from "@/lib/format";
import { SectionReportsLink } from "@/components/section-reports-link";

export const metadata = { title: "سجل المعلمين والموظفين" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ فئة?: string; دفعة?: string }> }) {
  await requirePermission("people.read");
  const params = await searchParams;
  const filter = params["فئة"];
  const batchId = params["دفعة"] && UUID_RE.test(params["دفعة"]) ? params["دفعة"] : undefined;

  const excluded = await getExcludedIdSets();
  const all = batchId
    ? await db
        .select()
        .from(people)
        .where(and(eq(people.importBatchId, batchId), notSynthetic(people.id, excluded.people)))
        .orderBy(asc(people.fullName))
    : await db.select().from(people).where(notSynthetic(people.id, excluded.people)).orderBy(asc(people.fullName));
  const batch = batchId
    ? (await db.select().from(importBatches).where(eq(importBatches.id, batchId)))[0]
    : undefined;
  // النوع المعتمد يُشتق من العمود الجديد أو من التصنيف المصدري — لا صف يُستثنى
  const typed = all.map((p) => ({ ...p, employeeTypeAr: employeeTypeOf(p) }));
  const filtered = filter ? typed.filter((p) => p.employeeTypeAr === filter) : typed;
  const teachers = typed.filter((p) => p.employeeTypeAr === "معلم").length;
  const staff = typed.filter((p) => p.employeeTypeAr === "موظف إداري").length;

  // يبني رابط تصفية يحافظ على تصفية الدفعة إن وجدت
  const filterHref = (employeeType?: string) => {
    const qs = new URLSearchParams();
    if (batchId) qs.set("دفعة", batchId);
    if (employeeType) qs.set("فئة", employeeType);
    const s = qs.toString();
    return s ? `/people?${s}` : "/people";
  };

  return (
    <div>
      <PageHeader
        title="سجل المعلمين والموظفين"
        subtitle={`${all.length} منسوباً — ${teachers} معلماً و${staff} موظفاً إدارياً`}
        actions={
          <>
            <SectionReportsLink category="employees" />
            <LinkButton href="/people/new" variant="secondary">إضافة شخص</LinkButton>
            <LinkButton href="/imports/new?type=people">استيراد من ملف فارس</LinkButton>
          </>
        }
      />
      {batchId && (
        <Card className="mb-4 border-brand-200 bg-brand-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-brand-900">
              تعرض الموظفين المستوردين من دفعة «{batch?.sourceFileName ?? "غير معروفة"}»
            </p>
            <LinkButton href="/people" variant="secondary">عرض الكل — إزالة التصفية</LinkButton>
          </div>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <LinkButton href={filterHref()} variant={!filter ? "primary" : "secondary"}>الكل</LinkButton>
        <LinkButton href={filterHref("معلم")} variant={filter === "معلم" ? "primary" : "secondary"}>المعلمون</LinkButton>
        <LinkButton href={filterHref("موظف إداري")} variant={filter === "موظف إداري" ? "primary" : "secondary"}>الموظفون الإداريون</LinkButton>
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          title="لا يوجد أشخاص بعد"
          hint="استخدم «استيراد من ملف فارس» لاستيراد بيانات الموظفين مع المعاينة والمراجعة، أو أضف شخصاً يدوياً"
        />
      ) : (
        <Table headers={["الاسم", "نوع الموظف", "الوظيفة", "السلك/الكادر", "الحالة الوظيفية", "رقم الوظيفة", "الحالة", ""]}>
          {filtered.map((p) => (
            <tr key={p.id} className={!p.active ? "opacity-50" : ""}>
              <td className="px-3 py-2 font-medium">{orFallback(p.fullName)}</td>
              <td className="px-3 py-2"><Badge value={p.employeeTypeAr} /></td>
              <td className="px-3 py-2">{p.jobTitle ?? "—"}</td>
              <td className="px-3 py-2">{p.cadre ?? "—"}</td>
              <td className="px-3 py-2">{p.employmentStatus ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums">{p.jobNumber ?? "—"}</td>
              <td className="px-3 py-2">{p.active ? <Badge value="نشط" /> : <Badge value="موقوف" />}</td>
              <td className="px-3 py-2"><LinkButton href={`/people/${p.id}`} variant="secondary">عرض</LinkButton></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

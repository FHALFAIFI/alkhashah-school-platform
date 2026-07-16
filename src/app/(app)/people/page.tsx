import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people, importBatches } from "@/db/schema";
import { PageHeader, Table, Badge, LinkButton, EmptyState, Card } from "@/components/ui";

export const metadata = { title: "سجل المعلمين والموظفين" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ فئة?: string; دفعة?: string }> }) {
  await requirePermission("people.read");
  const params = await searchParams;
  const filter = params["فئة"];
  const batchId = params["دفعة"] && UUID_RE.test(params["دفعة"]) ? params["دفعة"] : undefined;

  const all = batchId
    ? await db.select().from(people).where(eq(people.importBatchId, batchId)).orderBy(asc(people.fullName))
    : await db.select().from(people).orderBy(asc(people.fullName));
  const batch = batchId
    ? (await db.select().from(importBatches).where(eq(importBatches.id, batchId)))[0]
    : undefined;
  const filtered = filter ? all.filter((p) => p.category === filter) : all;
  const teachers = all.filter((p) => p.category === "معلم").length;
  const staff = all.filter((p) => p.category === "موظف").length;

  // يبني رابط تصفية يحافظ على تصفية الدفعة إن وجدت
  const filterHref = (category?: string) => {
    const qs = new URLSearchParams();
    if (batchId) qs.set("دفعة", batchId);
    if (category) qs.set("فئة", category);
    const s = qs.toString();
    return s ? `/people?${s}` : "/people";
  };

  return (
    <div>
      <PageHeader
        title="سجل المعلمين والموظفين"
        subtitle={`${all.length} شخصاً — ${teachers} معلماً و${staff} موظفاً`}
        actions={
          <>
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
        <LinkButton href={filterHref("موظف")} variant={filter === "موظف" ? "primary" : "secondary"}>الموظفون</LinkButton>
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          title="لا يوجد أشخاص بعد"
          hint="استخدم «استيراد من ملف فارس» لاستيراد بيانات الموظفين مع المعاينة والمراجعة، أو أضف شخصاً يدوياً"
        />
      ) : (
        <Table headers={["الاسم", "الفئة", "الوظيفة", "السلك/الكادر", "الحالة الوظيفية", "رقم الوظيفة", "الحالة", ""]}>
          {filtered.map((p) => (
            <tr key={p.id} className={!p.active ? "opacity-50" : ""}>
              <td className="px-3 py-2 font-medium">{p.fullName}</td>
              <td className="px-3 py-2"><Badge value={p.category} /></td>
              <td className="px-3 py-2">{p.jobTitle ?? "—"}</td>
              <td className="px-3 py-2">{p.cadre ?? "—"}</td>
              <td className="px-3 py-2">{p.employmentStatus ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums">{p.jobNumber ?? "—"}</td>
              <td className="px-3 py-2">{p.active ? <Badge value="نشطة" /> : <Badge value="ملغاة" />}</td>
              <td className="px-3 py-2"><LinkButton href={`/people/${p.id}`} variant="secondary">عرض</LinkButton></td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

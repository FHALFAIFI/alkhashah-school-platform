import { asc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PageHeader, Table, Badge, LinkButton, EmptyState, Card } from "@/components/ui";

export const metadata = { title: "سجل المعلمين والموظفين" };
export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ فئة?: string }> }) {
  await requirePermission("people.read");
  const params = await searchParams;
  const filter = params["فئة"];

  const all = await db.select().from(people).orderBy(asc(people.fullName));
  const filtered = filter ? all.filter((p) => p.category === filter) : all;
  const teachers = all.filter((p) => p.category === "معلم").length;
  const staff = all.filter((p) => p.category === "موظف").length;

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
      <div className="mb-4 flex gap-2">
        <LinkButton href="/people" variant={!filter ? "primary" : "secondary"}>الكل</LinkButton>
        <LinkButton href="/people?فئة=معلم" variant={filter === "معلم" ? "primary" : "secondary"}>المعلمون</LinkButton>
        <LinkButton href="/people?فئة=موظف" variant={filter === "موظف" ? "primary" : "secondary"}>الموظفون</LinkButton>
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

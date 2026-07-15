import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata = { title: "الفحص والجاهزية" };

export default async function Page() {
  await requirePermission("inspections.read");
  return (
    <div>
      <PageHeader title="الفحص والجاهزية" />
      <EmptyState title="هذه الوحدة قيد الإنشاء ضمن مرحلة لاحقة من خطة البناء" hint="ستتوفر تلقائياً بعد اكتمال مرحلتها" />
    </div>
  );
}

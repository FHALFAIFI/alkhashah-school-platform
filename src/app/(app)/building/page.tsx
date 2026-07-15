import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata = { title: "مخطط المبنى" };

export default async function Page() {
  await requirePermission("building.read");
  return (
    <div>
      <PageHeader title="مخطط المبنى" />
      <EmptyState title="هذه الوحدة قيد الإنشاء ضمن مرحلة لاحقة من خطة البناء" hint="ستتوفر تلقائياً بعد اكتمال مرحلتها" />
    </div>
  );
}

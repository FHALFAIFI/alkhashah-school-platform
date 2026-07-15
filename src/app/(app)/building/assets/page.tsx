import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata = { title: "العهدة والأصول" };

export default async function Page() {
  await requirePermission("assets.read");
  return (
    <div>
      <PageHeader title="العهدة والأصول" />
      <EmptyState title="هذه الوحدة قيد الإنشاء ضمن مرحلة لاحقة من خطة البناء" hint="ستتوفر تلقائياً بعد اكتمال مرحلتها" />
    </div>
  );
}

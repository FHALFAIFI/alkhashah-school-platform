import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata = { title: "نماذج الأداء" };

export default async function Page() {
  await requirePermission("performance.models.manage");
  return (
    <div>
      <PageHeader title="نماذج الأداء" />
      <EmptyState title="هذه الوحدة قيد الإنشاء ضمن مرحلة لاحقة من خطة البناء" hint="ستتوفر تلقائياً بعد اكتمال مرحلتها" />
    </div>
  );
}

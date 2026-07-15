import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata = { title: "وحدة الأداء الوظيفي" };

export default async function Page() {
  await requirePermission("performance.read");
  return (
    <div>
      <PageHeader title="وحدة الأداء الوظيفي" />
      <EmptyState title="هذه الوحدة قيد الإنشاء ضمن مرحلة لاحقة من خطة البناء" hint="ستتوفر تلقائياً بعد اكتمال مرحلتها" />
    </div>
  );
}

import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui";

export const metadata = { title: "التقرير التنفيذي الشامل" };

export default async function Page() {
  await requirePermission("reports.executive");
  return (
    <div>
      <PageHeader title="التقرير التنفيذي الشامل" />
      <EmptyState title="هذه الوحدة قيد الإنشاء ضمن مرحلة لاحقة من خطة البناء" hint="ستتوفر تلقائياً بعد اكتمال مرحلتها" />
    </div>
  );
}

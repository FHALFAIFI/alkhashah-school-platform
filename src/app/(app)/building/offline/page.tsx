import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { OfflineInspection } from "./offline-ui";

export const metadata = { title: "الفحص دون اتصال" };

export default async function OfflinePage() {
  await requirePermission("inspections.write");
  return (
    <div>
      <PageHeader
        title="الفحص الميداني دون اتصال"
        subtitle="حمل البيانات وأنت متصل، ثم نفذ الفحص والتقط الصور في أي مكان بالمبنى — تزامن التغييرات مرة واحدة دون تكرار عند عودة الاتصال. الاعتمادات والتقارير الرسمية تتطلب اتصالاً."
      />
      <OfflineInspection />
    </div>
  );
}

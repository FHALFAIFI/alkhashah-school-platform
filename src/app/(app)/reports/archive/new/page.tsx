import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { INSTANCE_TYPES } from "@/lib/reports/instances/types";
import { BASE_TEMPLATES } from "@/lib/reports/instances/base-templates";
import { REPORTS, categoryByKey, reportByKey } from "@/lib/reports/catalog";
import { NewInstanceForm } from "./new-ui";

export const metadata = { title: "تقرير جديد" };
export const dynamic = "force-dynamic";

/**
 * إنشاء تقرير محفوظ (v2.6 §A): النوع ثم — للمفرد — التقرير المصدر، ثم العنوان والفترة
 * والقالب. الأنواع المركّبة تُعرض بأقسامها المعلَنة، ولا يُعرض نوع أو تقرير لا يملك
 * المستخدم صلاحية كل أقسامه.
 */
export default async function NewInstancePage() {
  const user = await requirePermission("reports.read", "reports.builder");

  const types = INSTANCE_TYPES.filter((t) =>
    t.key === "single"
      ? true
      : t.sections.every((s) => {
          const def = reportByKey(s.reportKey);
          return def ? user.permissions.has(def.permission) : true;
        }),
  ).map((t) => ({
    key: t.key,
    label: t.labelAr,
    description: t.description,
    sectionLabels: t.sections.map((s) => s.labelAr ?? reportByKey(s.reportKey)?.label ?? s.key),
  }));

  const reportChoices = REPORTS.filter((r) => user.permissions.has(r.permission)).map((r) => ({
    key: r.key,
    label: r.label,
    category: categoryByKey(r.category)?.label ?? r.category,
  }));

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports/archive" label="عودة إلى أرشيف التقارير" />
      </div>
      <PageHeader
        title="تقرير جديد"
        subtitle="أنشئ مسودة تقرير محفوظ — تُعدَّل وتُعاين بحرية، ثم تُعتمد برقم لا يتكرر ولقطة لا تتغير"
      />
      <Card>
        <NewInstanceForm
          types={types}
          reportChoices={reportChoices}
          templates={BASE_TEMPLATES.map((t) => ({ key: t.key, label: t.labelAr }))}
        />
      </Card>
    </div>
  );
}

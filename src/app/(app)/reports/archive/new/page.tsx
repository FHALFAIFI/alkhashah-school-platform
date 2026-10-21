import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { INSTANCE_TYPES } from "@/lib/reports/instances/types";
import { templateChoices } from "@/lib/reports/instances/style-templates";
import { REPORTS, categoryByKey, reportByKey } from "@/lib/reports/catalog";
import { listTemplates, templateRunHref } from "@/lib/reports/templates";
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

  const savedSettings = await listTemplates(user);
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
      {savedSettings.length > 0 ? (
        <Card>
          <h2 className="mb-1 text-sm font-bold text-brand-900">أو ابدأ من إعداد محفوظ</h2>
          <p className="mb-2 text-xs text-gray-500">
            قوالب الإعدادات المحفوظة في منشئ التقارير — يفتحها المنشئ بمرشّحاتها وأعمدتها، ومنه «حفظ كتقرير محفوظ».
          </p>
          <ul className="space-y-1 text-sm">
            {savedSettings.map((t) => (
              <li key={t.id}>
                <a className="text-brand-700 underline" href={`/reports/builder?report=${t.reportKey}&${new URL(templateRunHref(t), "http://x").searchParams.toString()}`}>
                  {t.name}
                </a>{" "}
                <span className="text-xs text-gray-400">— {t.reportLabel}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <NewInstanceForm
          types={types}
          reportChoices={reportChoices}
          templates={await templateChoices()}
        />
      </Card>
    </div>
  );
}

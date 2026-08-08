import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { BASE_TEMPLATES } from "@/lib/reports/instances/base-templates";
import {
  listStyleTemplates,
  templateChoices,
  defaultsOverview,
} from "@/lib/reports/instances/style-templates";
import { CreateCopyForm, EditCopyForm, ArchiveRestoreButtons, DefaultTemplateForm, type StyleConfigShape } from "./styles-ui";

export const metadata = { title: "قوالب إخراج التقارير" };
export const dynamic = "force-dynamic";

/**
 * قوالب إخراج التقارير (v2.6 §E — D-058).
 *
 * الأساسية الخمسة سجلّ في الشيفرة: تُعرض للقراءة ولا تُحذف ولا تُعدَّل — يُنسخ عنها.
 * النسخة المخصصة تُحرَّر بحقول معدودة (لونان، غلاف، فهرس، اعتماد، نصّان، كثافة) —
 * لا مصمم قوالب حر ولا HTML/CSS مفتوح.
 */
export default async function ReportStylesPage() {
  const user = await requirePermission("reports.read", "reports.builder");
  const [custom, choices, defaults] = await Promise.all([
    listStyleTemplates({ includeArchived: true }),
    templateChoices(),
    defaultsOverview(),
  ]);
  const active = custom.filter((c) => !c.archived);
  const archived = custom.filter((c) => c.archived);
  const choiceLabels = new Map(choices.map((c) => [c.key, c.label]));

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports/archive" label="عودة إلى أرشيف التقارير" />
      </div>
      <PageHeader
        title="قوالب إخراج التقارير"
        subtitle="القوالب الأساسية محمية ولا تُعدَّل — انسخ عنها نسخة مخصصة، وحدّد قالباً افتراضياً لكل نوع تقرير"
      />

      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">القوالب الأساسية — محمية</h2>
        <div className="space-y-2">
          {BASE_TEMPLATES.map((t) => (
            <div key={t.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-200 p-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900">
                  {t.labelAr} <Badge value="قالب أساسي — محمي" />
                </p>
                <p className="mt-1 text-xs text-gray-500">{t.description}</p>
              </div>
              <CreateCopyForm baseKey={t.key} baseLabel={t.labelAr} />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">النسخ المخصصة</h2>
        {active.length === 0 ? (
          <EmptyState title="لا نسخ مخصصة بعد" hint="أنشئ نسخة من أي قالب أساسي أعلاه ثم عدّل ألوانها وترويستها" />
        ) : (
          <div className="space-y-4">
            {active.map((c) => (
              <div key={c.id} className="rounded-lg border border-sand-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-brand-900">
                    {c.name} <span className="text-xs text-gray-400">(نسخة من {c.baseLabel})</span>
                  </p>
                  <ArchiveRestoreButtons templateId={c.id} archived={false} />
                </div>
                <EditCopyForm templateId={c.id} name={c.name} config={c.config as unknown as StyleConfigShape} />
              </div>
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-4 border-t border-sand-100 pt-3">
            <h3 className="mb-2 text-xs font-bold text-gray-600">النسخ المؤرشفة</h3>
            <div className="space-y-2">
              {archived.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-sand-300 p-2 text-sm">
                  <span className="text-gray-600">
                    {c.name} <Badge value="مؤرشف" />
                  </span>
                  <ArchiveRestoreButtons templateId={c.id} archived />
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold text-brand-900">القالب الافتراضي لكل نوع تقرير</h2>
        <p className="mb-3 text-xs text-gray-500">
          يُستعمل حين لا يختار التقرير قالباً صراحةً. ترتيب الحلّ: اختيار التقرير ← الافتراضي هنا ← قالب النوع المعلَن.
        </p>
        <div className="space-y-3">
          {defaults.map((d) => (
            <DefaultTemplateForm
              key={d.typeKey}
              typeKey={d.typeKey}
              typeLabel={d.typeLabel}
              current={choiceLabels.has(d.templateKey) ? d.templateKey : choices[0]?.key ?? d.templateKey}
              choices={choices}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

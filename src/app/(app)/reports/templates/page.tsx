import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Table, EmptyState, LinkButton, Badge } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { listTemplates, templateRunHref } from "@/lib/reports/templates";
import { describeFilters } from "@/lib/reports/filters";
import { dualNumericCell } from "@/lib/dates";
import { TemplateRowActions } from "./templates-ui";

export const metadata = { title: "قوالب التقارير المحفوظة" };
export const dynamic = "force-dynamic";

/**
 * القوالب المحفوظة (v2.5.0 §4.5).
 *
 * الصفحة تشرح الفرق الذي يخلط بين أربعة أشياء متقاربة الاسم (§25): القالب وصفة تُشغَّل
 * فتقرأ البيانات الحالية؛ التقرير الصادر وثيقة مرقّمة بلقطة مجمّدة؛ تعريف التقرير مبنيّ
 * في المنصة ولا يُحذف؛ والعرض المرشَّح حالة عابرة في العنوان.
 */
export default async function TemplatesPage() {
  const user = await requirePermission("reports.read", "reports.builder");
  const templates = await listTemplates(user);

  const mine = templates.filter((t) => t.isOwner);
  const shared = templates.filter((t) => !t.isOwner);

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <BackButton fallbackHref="/reports" label="عودة إلى مركز التقارير" />
      </div>
      <PageHeader
        title="قوالب التقارير المحفوظة"
        subtitle="إعدادات تقارير محفوظة بأسمائها — شغّلها كما هي أو عدّلها أو انسخها"
        actions={<LinkButton href="/reports/builder">منشئ التقارير</LinkButton>}
      />

      <Card>
        <h2 className="mb-2 text-sm font-bold text-brand-900">ما هو القالب؟</h2>
        <ul className="space-y-1 text-xs text-gray-600">
          <li>• <strong>قالب محفوظ</strong> — إعداد يُشغَّل متى شئت فيقرأ البيانات <em>الحالية</em>. حذفه لا يمسّ أي بيانات ولا أي تقرير صدر منه.</li>
          <li>• <strong>تقرير صادر</strong> — وثيقة مرقّمة بلقطة مجمّدة لحظة إصدارها، لا تتغيّر بعدها. مكانها «سجل الوثائق».</li>
          <li>• <strong>تقرير جاهز</strong> — مبنيّ في المنصة داخل مركز التقارير، لا يملكه أحد ولا يُحذف.</li>
          <li>• <strong>عرض مرشَّح</strong> — ما تراه على الشاشة الآن؛ يبقى للجلسة ولا يُحفظ في القاعدة.</li>
        </ul>
      </Card>

      <TemplateSection title="قوالبي" templates={mine} emptyHint="احفظ أول قالب من «منشئ التقارير»" />
      <TemplateSection
        title="قوالب مشتركة وعامة"
        templates={shared}
        emptyHint="لا قوالب شاركها آخرون معك — أو لا تملك صلاحية تقاريرها"
      />
    </div>
  );
}

function TemplateSection({
  title,
  templates,
  emptyHint,
}: {
  title: string;
  templates: Awaited<ReturnType<typeof listTemplates>>;
  emptyHint: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold text-gray-600">{title} ({templates.length})</h2>
      {templates.length === 0 ? (
        <EmptyState title="لا قوالب" hint={emptyHint} />
      ) : (
        <Table headers={["القالب", "التقرير", "المرشّحات المحفوظة", "النطاق", "آخر تحديث", ""]}>
          {templates.map((t) => {
            const chips = describeFilters(t.filters);
            return (
              <tr key={t.id}>
                <td className="px-3 py-2">
                  <div className="text-sm font-medium">{t.name}</div>
                  {t.description && <div className="text-xs text-gray-500">{t.description}</div>}
                </td>
                <td className="px-3 py-2 text-xs">{t.reportLabel}</td>
                <td className="max-w-72 px-3 py-2 text-xs text-gray-600">
                  {chips.length === 0 ? "بلا مرشّحات — كل السجلات" : chips.map((c) => `${c.label}: ${c.value}`).join(" · ")}
                  {t.columns.length > 0 && <div className="mt-0.5 text-gray-400">أعمدة مختارة: {t.columns.length}</div>}
                </td>
                <td className="px-3 py-2"><Badge value={t.visibility} /></td>
                <td className="px-3 py-2 text-xs tabular-nums">{dualNumericCell(t.updatedAt.toISOString().slice(0, 10))}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <LinkButton href={templateRunHref(t)} variant="secondary">تشغيل</LinkButton>
                    {t.canEdit && (
                      <LinkButton href={`/reports/builder?report=${t.reportKey}&template=${t.id}`} variant="secondary">
                        تعديل
                      </LinkButton>
                    )}
                    <TemplateRowActions templateId={t.id} name={t.name} canEdit={t.canEdit} />
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </section>
  );
}

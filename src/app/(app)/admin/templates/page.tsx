import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, Badge, Table, EmptyState } from "@/components/ui";
import { orFallback } from "@/lib/format";
import { dualDisplay } from "@/lib/dates";
import { listTemplates, getTemplate, configOf } from "@/lib/templates/service";
import { DOC_TYPE_LABELS, TEMPLATE_DOC_TYPES, type TemplateDocType } from "@/lib/templates/schema";
import { placeholdersFor } from "@/lib/templates/placeholders";
import { templateDocTypeOptions } from "./actions";
import {
  CreateTemplateForm,
  TemplateActions,
  TemplateEditor,
  VersionActions,
  ImportConfigForm,
  ExportConfigButton,
} from "./template-ui";

export const metadata = { title: "إدارة القوالب" };
export const dynamic = "force-dynamic";

/**
 * «إدارة القوالب» (v2.2 §E1).
 *
 * القوالب تحكم شكل الوثائق والتقارير المولّدة فقط — لا صفحات التطبيق ولا قوائمه ولا سمته.
 *
 * التفويض على حدود الخادم: العرض يتطلب `documents.read`، والتحرير `admin.settings`.
 * لا يُعتمد على إخفاء الأزرار: كل إجراء يعيد فحص صلاحيته بنفسه.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const user = await requirePermission("documents.read");
  const canManage = user.permissions.has("admin.settings");
  const sp = await searchParams;

  const templates = await listTemplates({ includeArchived: true });
  const active = templates.filter((t) => !t.archivedAt);
  const archived = templates.filter((t) => t.archivedAt);

  // القالب المفتوح للتحرير — يُتحقق أنه موجود فعلاً قبل أي عرض
  const selected = sp.template ? await getTemplate(sp.template) : null;
  const docTypes = await templateDocTypeOptions();

  // الأنواع التي ليس لها قالب بعد — تستعمل الإعداد الافتراضي عند الإصدار
  const typesWithTemplate = new Set(active.map((t) => t.docType));
  const typesWithout = TEMPLATE_DOC_TYPES.filter((t) => !typesWithTemplate.has(t));

  return (
    <div className="space-y-6">
      <PageHeader
        title="إدارة القوالب"
        subtitle="قوالب الوثائق والتقارير المولّدة — العناوين والنصوص والتنسيق والتوقيع. لا تمسّ صفحات التطبيق ولا قوائمه."
        actions={canManage ? <CreateTemplateForm docTypes={docTypes} /> : undefined}
      />

      <Card className="border-sand-300 bg-sand-50">
        <p className="text-sm text-gray-700">
          <span className="font-medium">التاريخ محفوظ:</span> تعديل قالب يُنشئ نسخة جديدة ولا يغيّر أي
          وثيقة صدرت سابقاً — لكل وثيقة لقطتها الثابتة وقت إصدارها.
        </p>
      </Card>

      {active.length === 0 ? (
        <EmptyState
          title="لا قوالب بعد"
          hint="الوثائق تصدر حالياً بالإعداد الافتراضي. أنشئ قالباً لتخصيص شكلها."
        />
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-bold text-gray-600">القوالب ({active.length})</h2>
          <Table headers={["النوع", "الاسم", "الحالة", "النسخة المنشورة", "عدد النسخ", "وثائق صادرة", "آخر تعديل", ""]}>
            {active.map((t) => {
              const d = dualDisplay(t.updatedAt, "employee");
              return (
                <tr key={t.id} className={selected?.template.id === t.id ? "bg-brand-50" : undefined}>
                  <td className="px-3 py-2 text-xs">{DOC_TYPE_LABELS[t.docType as TemplateDocType] ?? t.docType}</td>
                  <td className="px-3 py-2 font-medium">
                    <a href={`/admin/templates?template=${t.id}`} className="text-brand-700 hover:underline">
                      {orFallback(t.nameAr, "قالب بدون اسم")}
                    </a>
                  </td>
                  <td className="px-3 py-2">{t.isDefault ? <Badge value="افتراضي" /> : <Badge value="بديل" />}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {t.currentVersion ? `نسخة ${t.currentVersion.versionNumber}` : "لم تُنشر بعد"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{t.versionCount}</td>
                  <td className="px-3 py-2 tabular-nums">{t.issuedDocumentCount}</td>
                  <td className="px-3 py-2 text-xs">{d ? d.primary : "—"}</td>
                  <td className="px-3 py-2">
                    {canManage && (
                      <TemplateActions
                        templateId={t.id}
                        archived={false}
                        isDefault={t.isDefault}
                        canSetDefault={Boolean(t.currentVersionId)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </section>
      )}

      {typesWithout.length > 0 && (
        <Card>
          <h3 className="text-sm font-bold text-gray-600">أنواع بلا قالب ({typesWithout.length})</h3>
          <p className="mt-1 text-xs text-gray-500">
            تصدر هذه الأنواع بالإعداد الافتراضي — وهذا سلوك صحيح لا نقص: لا يتوقّف إصدار الوثائق
            لعدم وجود قالب.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {typesWithout.map((t) => (
              <span key={t} className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-gray-600">
                {DOC_TYPE_LABELS[t]}
              </span>
            ))}
          </div>
        </Card>
      )}

      {selected && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-brand-900">
              تحرير: {orFallback(selected.template.nameAr, DOC_TYPE_LABELS[selected.template.docType as TemplateDocType])}
            </h2>
            {canManage && (
              <div className="flex flex-wrap items-center gap-3">
                <ExportConfigButton config={configOf(selected.current)} label="القالب" />
                <ImportConfigForm templateId={selected.template.id} />
              </div>
            )}
          </div>

          {canManage ? (
            <TemplateEditor
              templateId={selected.template.id}
              docType={selected.template.docType as TemplateDocType}
              initialConfig={configOf(selected.current ?? selected.versions[0])}
              placeholders={placeholdersFor(selected.template.docType as TemplateDocType)}
            />
          ) : (
            <Card>
              <p className="text-sm text-gray-600">لديك صلاحية العرض فقط — تحرير القوالب يتطلب صلاحية إدارة الإعدادات.</p>
            </Card>
          )}

          <section>
            <h3 className="mb-2 text-sm font-bold text-gray-600">سجل النسخ ({selected.versions.length})</h3>
            <p className="mb-2 text-xs text-gray-500">
              النسخة المنشورة لا تُعدَّل أبداً. الاستعادة تنشئ نسخة جديدة وتُبقي التاريخ كاملاً.
            </p>
            <Table headers={["النسخة", "الحالة", "ملاحظة التغيير", "تاريخ الإنشاء", "تاريخ النشر", ""]}>
              {selected.versions.map((v) => {
                const created = dualDisplay(v.createdAt, "employee");
                const published = v.publishedAt ? dualDisplay(v.publishedAt, "employee") : null;
                const isCurrent = v.id === selected.template.currentVersionId;
                return (
                  <tr key={v.id}>
                    <td className="px-3 py-2 tabular-nums">
                      {v.versionNumber}
                      {isCurrent && <span className="ms-2 text-xs text-emerald-700">(المستعملة)</span>}
                    </td>
                    <td className="px-3 py-2"><Badge value={v.status} /></td>
                    <td className="px-3 py-2 text-xs">{orFallback(v.changeNote, "—")}</td>
                    <td className="px-3 py-2 text-xs">{created ? created.primary : "—"}</td>
                    <td className="px-3 py-2 text-xs">{published ? published.primary : "—"}</td>
                    <td className="px-3 py-2">
                      {canManage && <VersionActions versionId={v.id} status={v.status} referenced={false} />}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </section>
        </section>
      )}

      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">قوالب مؤرشفة ({archived.length})</summary>
          <div className="mt-2">
            <Table headers={["النوع", "الاسم", "عدد النسخ", ""]}>
              {archived.map((t) => (
                <tr key={t.id} className="text-gray-500">
                  <td className="px-3 py-2 text-xs">{DOC_TYPE_LABELS[t.docType as TemplateDocType] ?? t.docType}</td>
                  <td className="px-3 py-2">{orFallback(t.nameAr, "قالب بدون اسم")}</td>
                  <td className="px-3 py-2 tabular-nums">{t.versionCount}</td>
                  <td className="px-3 py-2">
                    {canManage && <TemplateActions templateId={t.id} archived isDefault={false} canSetDefault={false} />}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </details>
      )}
    </div>
  );
}

import { desc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { PageHeader, Table, EmptyState } from "@/components/ui";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import { EmailDocumentButton } from "@/components/integrations-ui";
import { SectionReportsLink } from "@/components/section-reports-link";
import { DOC_TYPE_LABELS, type TemplateDocType } from "@/lib/templates/schema";

export const metadata = { title: "الوثائق الصادرة" };
export const dynamic = "force-dynamic";

/**
 * v2.4 §15: التسميات من سجل أنواع الوثائق المركزي — لا قائمة موازية ناقصة تعرض
 * مفاتيح إنجليزية خاماً. الأنواع التاريخية غير المسجلة تحتفظ بتسمية محلية.
 */
const LEGACY_TYPE_LABELS: Record<string, string> = {
  committee_formation: "قرار تشكيل",
};
function docTypeLabel(docType: string): string {
  return DOC_TYPE_LABELS[docType as TemplateDocType] ?? LEGACY_TYPE_LABELS[docType] ?? docType;
}

export default async function DocumentsPage() {
  await requirePermission("documents.read");
  const excluded = await getExcludedIdSets();
  const docs = await db.select().from(documents).where(notSynthetic(documents.id, excluded.documents)).orderBy(desc(documents.issuedAt));
  return (
    <div>
      <PageHeader title="الوثائق الصادرة" subtitle="لكل وثيقة رقم فريد ورمز تحقق ولقطة ثابتة لا تتغير" actions={<SectionReportsLink category="documents" />}
      />
      {docs.length === 0 ? (
        <EmptyState title="لا وثائق صادرة بعد" />
      ) : (
        <Table headers={["رقم الوثيقة", "النوع", "العنوان", "رمز التحقق", "تاريخ الإصدار", "توقيع/ختم", "تنزيل"]}>
          {docs.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 font-medium tabular-nums">{d.docNumber}</td>
              <td className="px-3 py-2 text-xs">{docTypeLabel(d.docType)}</td>
              <td className="px-3 py-2">{d.title}</td>
              <td className="px-3 py-2 tabular-nums">{d.verificationCode}</td>
              <td className="px-3 py-2 text-xs tabular-nums">
                {d.issuedAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
              </td>
              <td className="px-3 py-2 text-xs">
                {d.withSignature ? "توقيع" : ""}{d.withSignature && d.withStamp ? " + " : ""}{d.withStamp ? "ختم" : ""}
                {!d.withSignature && !d.withStamp ? "—" : ""}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {d.pdfFileId && <a href={`/api/files/${d.pdfFileId}`} className="text-xs text-brand-700 underline">PDF</a>}
                  <EmailDocumentButton docId={d.id} docNumber={d.docNumber} pdfFileId={d.pdfFileId} />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

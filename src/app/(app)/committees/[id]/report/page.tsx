import { notFound } from "next/navigation";
import { desc, and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { committees, documents } from "@/db/schema";
import { PageHeader, Card, SubmitButton, Table } from "@/components/ui";
import { ReportActions } from "@/components/report-actions";
import { generateCommitteeReport } from "@/lib/reports/committee-report";
import { COMMITTEE_CARD_LABEL } from "@/lib/committees/report-labels";

export const dynamic = "force-dynamic";

export default async function CommitteeReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("reports.generate");
  const { id } = await params;
  const [committee] = await db.select().from(committees).where(eq(committees.id, id));
  if (!committee) notFound();

  const issued = await db
    .select()
    .from(documents)
    .where(and(eq(documents.entityType, "committee"), eq(documents.entityId, id)))
    .orderBy(desc(documents.issuedAt));

  async function issueReport() {
    "use server";
    const u = await requirePermission("reports.generate");
    await generateCommitteeReport({ committeeId: id, issuedBy: u.id });
    revalidatePath(`/committees/${id}/report`);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={`${COMMITTEE_CARD_LABEL}: ${committee.nameAr}`} subtitle="طباعة لجنة أو مجلس واحد مستقلاً — لقطة ثابتة برقم وثيقة ورمز تحقق، بأعضائها ومهامها وحالاتها واجتماعاتها ونتائجها" />
      <Card>
        <form action={issueReport} className="space-y-3">
          <SubmitButton>{COMMITTEE_CARD_LABEL} (PDF)</SubmitButton>
          <p className="text-xs text-gray-400">يشمل التقرير التشكيل والأعضاء والاجتماعات ونتائجها (قرارات/توصيات/ملاحظات) والإجراءات المرتبطة.</p>
        </form>
        <div className="mt-3 border-t border-sand-100 pt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">إجراءات التقرير</p>
          <ReportActions
            wordHref={`/api/export/committee-docx/${id}`}
            excelHref={`/api/export/committee-xlsx/${id}`}
            latestDoc={issued[0] ? { id: issued[0].id, docNumber: issued[0].docNumber, pdfFileId: issued[0].pdfFileId } : null}
          />
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الإصدارات السابقة</h2>
        {issued.length === 0 ? (
          <p className="text-sm text-gray-400">لم يصدر تقرير بعد</p>
        ) : (
          <Table headers={["رقم الوثيقة", "رمز التحقق", "تاريخ الإصدار", "تنزيل"]}>
            {issued.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2 font-medium tabular-nums">{d.docNumber}</td>
                <td className="px-3 py-2 tabular-nums">{d.verificationCode}</td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {d.issuedAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="px-3 py-2">
                  {d.pdfFileId && <a href={`/api/files/${d.pdfFileId}`} className="text-xs text-brand-700 underline">PDF</a>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

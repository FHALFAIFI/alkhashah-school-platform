import { desc, and, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { PageHeader, Card, SubmitButton, Table } from "@/components/ui";
import { ReportActions } from "@/components/report-actions";
import { generateBuildingReport } from "@/lib/reports/building-report";

export const dynamic = "force-dynamic";

export default async function BuildingReportPage() {
  await requirePermission("building.read", "reports.generate");
  const issued = await db
    .select()
    .from(documents)
    .where(and(eq(documents.docType, "building_report")))
    .orderBy(desc(documents.issuedAt));

  async function issueReport() {
    "use server";
    const u = await requirePermission("building.read", "reports.generate");
    await generateBuildingReport({ issuedBy: u.id });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="تقرير المبنى المدرسي"
        subtitle="مجمع البنين — الغرف والأبعاد والأصول والفحوص والجاهزية والصيانة (مخطط تشغيلي وليس رسماً هندسياً معتمداً)"
      />
      <Card>
        <form action={issueReport} className="space-y-3">
          <SubmitButton>إصدار تقرير المبنى (PDF)</SubmitButton>
          <p className="text-xs text-gray-400">يشمل الغرف وأبعادها، الأصول، الفحوص والجاهزية، وبلاغات الصيانة المفتوحة والمكتملة.</p>
        </form>
        <div className="mt-3 border-t border-sand-100 pt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">إجراءات التقرير</p>
          <ReportActions
            wordHref="/api/export/building-docx"
            excelHref="/api/export/building-xlsx"
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
                <td className="px-3 py-2 text-xs tabular-nums">{d.issuedAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="px-3 py-2">{d.pdfFileId && <a href={`/api/files/${d.pdfFileId}`} className="text-xs text-brand-700 underline">PDF</a>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

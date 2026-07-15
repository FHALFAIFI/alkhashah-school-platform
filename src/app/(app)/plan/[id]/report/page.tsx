import { notFound, redirect } from "next/navigation";
import { desc, and, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { programs, documents } from "@/db/schema";
import { PageHeader, Card, SubmitButton, Table } from "@/components/ui";
import { generateProgramReport } from "@/lib/reports/program-report";
import { getSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default async function ProgramReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("reports.generate");
  const { id } = await params;
  const [program] = await db.select().from(programs).where(eq(programs.id, id));
  if (!program) notFound();

  const issued = await db
    .select()
    .from(documents)
    .where(and(eq(documents.entityType, "program"), eq(documents.entityId, id)))
    .orderBy(desc(documents.issuedAt));

  const defaultSig = await getSetting("branding.signature_default", false);
  const defaultStamp = await getSetting("branding.stamp_default", false);
  const canBrand = user.permissions.has("branding.use");

  async function issueReport(formData: FormData) {
    "use server";
    const u = await requirePermission("reports.generate");
    const withSignature = formData.get("withSignature") === "on" && u.permissions.has("branding.use");
    const withStamp = formData.get("withStamp") === "on" && u.permissions.has("branding.use");
    await generateProgramReport({ programId: id, withSignature, withStamp, issuedBy: u.id });
    revalidatePath(`/plan/${id}/report`);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={`تقرير برنامج: ${program.name}`} subtitle="إصدار تقرير رسمي بلقطة ثابتة ورقم وثيقة ورمز تحقق" />
      <Card>
        <form action={issueReport} className="space-y-3">
          {canBrand && (
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="withSignature" defaultChecked={defaultSig} />
                إدراج توقيع المدير
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="withStamp" defaultChecked={defaultStamp} />
                إدراج ختم المدرسة
              </label>
            </div>
          )}
          <SubmitButton>إصدار تقرير PDF جديد</SubmitButton>
          <p className="text-xs text-gray-400">يتضمن التقرير مضمون الشواهد (صور، أول صفحة PDF، نصوص، معاينات جداول) وليس أسماء الملفات فقط.</p>
        </form>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الإصدارات السابقة</h2>
        {issued.length === 0 ? (
          <p className="text-sm text-gray-400">لم يصدر تقرير بعد</p>
        ) : (
          <Table headers={["رقم الوثيقة", "رمز التحقق", "تاريخ الإصدار", "توقيع", "ختم", "تنزيل"]}>
            {issued.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2 font-medium tabular-nums">{d.docNumber}</td>
                <td className="px-3 py-2 tabular-nums">{d.verificationCode}</td>
                <td className="px-3 py-2 text-xs tabular-nums">
                  {d.issuedAt.toLocaleString("ar-SA-u-nu-latn", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="px-3 py-2">{d.withSignature ? "نعم" : "لا"}</td>
                <td className="px-3 py-2">{d.withStamp ? "نعم" : "لا"}</td>
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

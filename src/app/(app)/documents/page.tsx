import { desc } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { PageHeader, Table, EmptyState } from "@/components/ui";

export const metadata = { title: "الوثائق الصادرة" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  program_report: "تقرير برنامج",
  meeting_minutes: "محضر اجتماع",
  performance_report: "تقرير أداء",
  executive_report: "تقرير تنفيذي",
  committee_formation: "قرار تشكيل",
};

export default async function DocumentsPage() {
  await requirePermission("documents.read");
  const docs = await db.select().from(documents).orderBy(desc(documents.issuedAt));
  return (
    <div>
      <PageHeader title="الوثائق الصادرة" subtitle="لكل وثيقة رقم فريد ورمز تحقق ولقطة ثابتة لا تتغير" />
      {docs.length === 0 ? (
        <EmptyState title="لا وثائق صادرة بعد" />
      ) : (
        <Table headers={["رقم الوثيقة", "النوع", "العنوان", "رمز التحقق", "تاريخ الإصدار", "توقيع/ختم", "تنزيل"]}>
          {docs.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 font-medium tabular-nums">{d.docNumber}</td>
              <td className="px-3 py-2 text-xs">{TYPE_LABELS[d.docType] ?? d.docType}</td>
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
                {d.pdfFileId && <a href={`/api/files/${d.pdfFileId}`} className="text-xs text-brand-700 underline">PDF</a>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

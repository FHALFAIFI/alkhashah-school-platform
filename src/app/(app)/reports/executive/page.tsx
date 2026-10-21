import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { PageHeader, Card, SubmitButton, Table } from "@/components/ui";
import { generateExecutiveReport } from "@/lib/reports/executive-report";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "التقرير التنفيذي الشامل" };
export const dynamic = "force-dynamic";

export default async function ExecutiveReportPage() {
  const user = await requirePermission("reports.executive");
  const canIndividual = user.permissions.has("performance.individual.read");
  const canBrand = user.permissions.has("branding.use");
  const defaultSig = await getSetting("branding.signature_default", false);
  const defaultStamp = await getSetting("branding.stamp_default", false);

  const issued = await db
    .select()
    .from(documents)
    .where(eq(documents.docType, "executive_report"))
    .orderBy(desc(documents.issuedAt));

  async function issue(formData: FormData) {
    "use server";
    const u = await requirePermission("reports.executive");
    const period = (String(formData.get("period") ?? "شهري") as "شهري" | "فصلي" | "سنوي");
    const includeIndividual =
      formData.get("includeIndividual") === "on" && u.permissions.has("performance.individual.read");
    await generateExecutiveReport({
      period,
      includeIndividual,
      withSignature: formData.get("withSignature") === "on" && u.permissions.has("branding.use"),
      withStamp: formData.get("withStamp") === "on" && u.permissions.has("branding.use"),
      issuedBy: u.id,
    });
    /*
     * D-053 قاعدة 4: الإجراء ينتهي بانتقال فلا يحتاج تحديثاً.
     *
     * كان ينتهي بلا شيء: الوثيقة تصدر فعلاً برقمها، والصفحة لا تُعاد فلا يظهر السطر في
     * «الإصدارات السابقة» — فيظن المدير أن شيئاً لم يحدث ويُصدر ثانيةً، فتتكرر وثيقة رسمية
     * مرقّمة. التحويل إلى الصفحة نفسها يعيد تصييرها بالسطر الجديد.
     */
    redirect("/reports/executive");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="التقرير التنفيذي الشامل"
        subtitle="تقرير موحد عبر الخطة التشغيلية واللجان والمهام والأداء والمبنى — شهري أو فصلي أو سنوي"
      />
      <Card>
        <form action={issue} className="space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">الفترة</label>
              <select name="period" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="شهري">شهري</option>
                <option value="فصلي">فصلي (فصل دراسي)</option>
                <option value="سنوي">سنوي</option>
              </select>
              <p className="mt-1 text-xs text-gray-400">
                الفترة تظهر كعنوان للتقرير فقط — يشمل التقرير الحالة الراهنة لجميع الوحدات
              </p>
            </div>
            {canIndividual && (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="includeIndividual" />
                تضمين تفاصيل الأداء الفردي (سري — لا يطلع عليه غيرك)
              </label>
            )}
            {canBrand && (
              <>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="withSignature" defaultChecked={defaultSig} />
                  التوقيع
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="withStamp" defaultChecked={defaultStamp} />
                  الختم
                </label>
              </>
            )}
          </div>
          <SubmitButton>إصدار التقرير (PDF)</SubmitButton>
        </form>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold text-brand-900">الإصدارات السابقة</h2>
        {issued.length === 0 ? (
          <p className="text-sm text-gray-400">لم يصدر تقرير تنفيذي بعد</p>
        ) : (
          <Table headers={["رقم الوثيقة", "العنوان", "التاريخ", "تنزيل"]}>
            {issued.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2 tabular-nums">{d.docNumber}</td>
                <td className="px-3 py-2">{d.title}</td>
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

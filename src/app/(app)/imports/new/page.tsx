import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, WorkflowSteps } from "@/components/ui";
import { UploadForm } from "./upload-form";

export const metadata = { title: "استيراد جديد" };

export default async function NewImportPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePermission("imports.read");
  const { type } = await searchParams;
  const importType = type === "operational_plan" ? "operational_plan" : "people";

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={importType === "people" ? "استيراد بيانات الموظفين" : "استيراد الخطة التشغيلية"}
        subtitle="الخطوة 1 من 4: رفع الملف المصدر — لن يكتب أي سجل قبل المعاينة والموافقة الصريحة"
      />
      <div className="mb-4 rounded-xl border border-sand-200 bg-white p-4">
        <WorkflowSteps steps={["رفع الملف", "المعاينة والتصحيح", "الموافقة والتنفيذ", "عرض النتيجة"]} current={0} />
      </div>
      {importType === "people" && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <h2 className="mb-2 font-bold text-amber-900">تصغير البيانات — مطبق تلقائياً</h2>
          <p className="text-sm text-amber-900">
            يستورد افتراضياً: الاسم، الوظيفة، السلك/الكادر، حالة الموظف، المرحلة/الجهة، رقم الوظيفة.
            <br />
            لا يستورد إطلاقاً بشكل افتراضي: رقم الهوية، تاريخ الميلاد، هوية المدير المباشر، رقم الجوال.
          </p>
        </Card>
      )}
      <Card>
        <UploadForm importType={importType} />
      </Card>
    </div>
  );
}

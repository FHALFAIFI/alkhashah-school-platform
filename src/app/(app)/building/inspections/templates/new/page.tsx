import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { TemplateEditor } from "../template-editor";
import { createTemplateAction } from "@/app/(app)/building/template-actions";

export const metadata = { title: "إنشاء قالب" };
export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requirePermission("inspections.write");
  return (
    <div className="space-y-4">
      <PageHeader title="إنشاء قالب" subtitle="أضف الأقسام وعناصر الفحص وأنواع الإجابات — يُحفظ القالب مسودةً حتى تفعيله" />
      <Card>
        <TemplateEditor
          action={createTemplateAction}
          initialMeta={{ nameAr: "", roomType: "", purpose: "", instructions: "" }}
          initialSections={[]}
          submitLabel="حفظ المسودة"
        />
      </Card>
    </div>
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { inspectionTemplates } from "@/db/schema";
import { PageHeader, Card } from "@/components/ui";
import { isUuid } from "@/lib/validation";
import { TEMPLATE_STATUS, type TemplateSection } from "@/lib/building/inspection-templates";
import { TemplateEditor } from "../../template-editor";
import { updateTemplateAction } from "@/app/(app)/building/template-actions";

export const metadata = { title: "تعديل القالب" };
export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("inspections.write");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
  if (!t) notFound();

  const isDraft = t.status === TEMPLATE_STATUS.draft;
  const sections = (t.sections as TemplateSection[] | null) ?? [];
  const action = updateTemplateAction.bind(null, id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="تعديل القالب"
        subtitle={
          isDraft
            ? "التعديل يُحفظ في المسودة نفسها"
            : "هذا القالب مُفعّل/مستخدَم — الحفظ سينشئ إصداراً جديداً (مسودة) ولن يغيّر الإصدار الحالي"
        }
      />
      <Card>
        <TemplateEditor
          action={action}
          initialMeta={{
            nameAr: t.nameAr,
            roomType: t.roomType ?? "",
            purpose: t.purpose ?? "",
            instructions: t.instructions ?? "",
          }}
          initialSections={sections}
          submitLabel={isDraft ? "حفظ المسودة" : "حفظ كإصدار جديد"}
          currentId={id}
        />
      </Card>
    </div>
  );
}

import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { AskAssistant } from "@/components/assistant/ask-assistant";

export const metadata = { title: "التقارير" };

export default async function ReportsPage() {
  const user = await requirePermission("reports.read");
  return (
    <div>
      <PageHeader
        title="التقارير"
        subtitle="قسم موحد، وتتوفر تقارير سياقية داخل كل وحدة"
        actions={user.permissions.has("ai.use") ? <AskAssistant type="report" id={user.id} label="التقارير" /> : undefined}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="font-bold text-brand-900">تقارير البرامج</h2>
          <p className="mt-1 text-sm text-gray-500">تقرير رسمي لكل برنامج يشمل البطاقة والمعالم والحزم ومضمون الشواهد</p>
          <div className="mt-3"><LinkButton href="/plan" variant="secondary">من صفحة البرنامج</LinkButton></div>
        </Card>
        <Card>
          <h2 className="font-bold text-brand-900">تقارير الاجتماعات</h2>
          <p className="mt-1 text-sm text-gray-500">محاضر رسمية بأرقام وثائق ورموز تحقق</p>
          <div className="mt-3"><LinkButton href="/committees" variant="secondary">من صفحة اللجنة</LinkButton></div>
        </Card>
        <Card>
          <h2 className="font-bold text-brand-900">تقارير الأداء الوظيفي</h2>
          <p className="mt-1 text-sm text-gray-500">تقارير الجلسات والتقارير السنوية — تفاصيل الأداء الفردي للمدير فقط</p>
          <div className="mt-3"><LinkButton href="/performance" variant="secondary">من صفحة الدورة</LinkButton></div>
        </Card>
        <Card>
          <h2 className="font-bold text-brand-900">التقرير التنفيذي الشامل</h2>
          <p className="mt-1 text-sm text-gray-500">تقرير تنفيذي عبر جميع الوحدات (شهري/فصلي/سنوي)</p>
          <div className="mt-3">
            {user.permissions.has("reports.executive") ? (
              <LinkButton href="/reports/executive">إصدار</LinkButton>
            ) : (
              <span className="text-xs text-gray-400">يتطلب صلاحية التقارير التنفيذية</span>
            )}
          </div>
        </Card>
        <Card>
          <h2 className="font-bold text-brand-900">الوثائق الصادرة</h2>
          <p className="mt-1 text-sm text-gray-500">سجل كل ما صدر بأرقامه ورموز التحقق</p>
          <div className="mt-3"><LinkButton href="/documents" variant="secondary">فتح السجل</LinkButton></div>
        </Card>
      </div>
    </div>
  );
}

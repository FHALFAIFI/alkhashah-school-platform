import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { AskAssistant } from "@/components/assistant/ask-assistant";

export const metadata = { title: "التقارير" };

/**
 * مركز التقارير بثلاثة مستويات (§9):
 *  أ) تقارير الوحدات الرئيسة.
 *  ب) تقرير تفصيلي لكل برنامج تشغيلي (يُصدر من صفحة البرنامج).
 *  ج) التقرير التنفيذي الشامل عبر الوحدات.
 */
export default async function ReportsPage() {
  const user = await requirePermission("reports.read");
  const canExec = user.permissions.has("reports.executive");

  const moduleReports: { title: string; desc: string; href: string; permission?: string; cta: string }[] = [
    { title: "الخطة التشغيلية", desc: "تقرير تفصيلي لكل برنامج: معلومات البرنامج، المسؤول، التواريخ والحالة، التقدم المباشر، المخرجات، الشواهد المرفوعة وعددها، الميزانية والمصروف الفعلي، النتائج والأثر، الملاحظات وسجل المتابعة", href: "/plan", permission: "plan.read", cta: "من صفحة البرنامج" },
    { title: "أداء المعلمين والموظفين", desc: "تقارير الجلسات والتقارير السنوية والتقارير الموقعة — تفاصيل الأداء الفردي للمدير فقط", href: "/performance", permission: "performance.read", cta: "من صفحة الدورة" },
    { title: "المجالس واللجان ومجتمعات التعلم", desc: "نماذج التكليف والمحاضر الرسمية بأرقام وثائق ورموز تحقق ونتائج وأثر", href: "/committees", permission: "committees.read", cta: "من صفحة اللجنة" },
    { title: "المبنى والمرافق والغرف والأصول", desc: "قائمة المرافق، تقارير جاهزية الغرف، بلاغات الصيانة، سجل الأصول", href: "/building/report", permission: "building.read", cta: "تقرير المبنى" },
    { title: "الميزانية والمصروفات", desc: "الملخص المالي، المخطط مقابل الفعلي، المصروفات غير المرتبطة ببرنامج، الإيصالات المرفقة (اختيارية)، التجاوزات المُقَرّة", href: "/budget", permission: "budget.read", cta: "فتح الميزانية" },
    { title: "الوثائق الصادرة والأرشيف", desc: "سجل كل ما صدر بأرقامه ورموز التحقق ولقطاته الثابتة", href: "/documents", permission: "documents.read", cta: "فتح السجل" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="مركز التقارير"
        subtitle="ثلاثة مستويات: تقارير الوحدات، تقرير تفصيلي لكل برنامج، والتقرير التنفيذي الشامل — كل رقم يعود إلى سجله المصدري"
        actions={user.permissions.has("ai.use") ? <AskAssistant type="report" id={user.id} label="التقارير" /> : undefined}
      />

      <section>
        <h2 className="mb-3 text-sm font-bold text-gray-600">أ) تقارير الوحدات الرئيسة</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {moduleReports
            .filter((r) => !r.permission || user.permissions.has(r.permission))
            .map((r) => (
              <Card key={r.title}>
                <h3 className="font-bold text-brand-900">{r.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{r.desc}</p>
                <div className="mt-3"><LinkButton href={r.href} variant="secondary">{r.cta}</LinkButton></div>
              </Card>
            ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold text-gray-600">ب) تقرير تفصيلي لكل برنامج</h2>
        <Card>
          <p className="text-sm text-gray-600">
            لكل برنامج تشغيلي تقرير واحد يجمع معلومات البرنامج والمسؤول والتواريخ والحالة والتقدم المباشر والمخرجات
            والشواهد المرفوعة وعددها الفعلي والميزانية والمصروف الفعلي والنتائج والأثر والملاحظات وسجل المتابعة.
            يُصدر من صفحة البرنامج بلقطة ثابتة قابلة لإعادة التوليد كنسخة جديدة.
          </p>
          <div className="mt-3"><LinkButton href="/plan" variant="secondary">اختر برنامجاً</LinkButton></div>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold text-gray-600">ج) التقرير التنفيذي الشامل</h2>
        <Card>
          <p className="text-sm text-gray-600">
            تقرير موحّد عبر تقدم الخطة، البرامج المتأخرة، الشواهد المسجلة، دورات الأداء، التقارير الموقعة الناقصة،
            أعمال اللجان، نواقص المرافق، بلاغات الأصول، الموقف المالي، المخاطر والإجراءات.
          </p>
          <div className="mt-3">
            {canExec ? (
              <LinkButton href="/reports/executive">إصدار التقرير التنفيذي</LinkButton>
            ) : (
              <span className="text-xs text-gray-400">يتطلب صلاحية التقارير التنفيذية</span>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}

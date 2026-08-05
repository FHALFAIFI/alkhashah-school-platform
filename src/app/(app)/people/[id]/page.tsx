import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { people, perfCycles } from "@/db/schema";
import { CompletenessMeter } from "@/components/completeness-meter";
import { hasValue } from "@/lib/completeness";
import { PageHeader, Card, Badge, SubmitButton, LinkButton } from "@/components/ui";
import { DependencyNotice } from "@/components/dependency-notice";
import { assessDeletion, dependencySummaryAr } from "@/lib/safe-delete";
import { assessPersonDeletion } from "@/lib/lifecycle-delete";
import { PermanentDeletePanel } from "@/components/permanent-delete";
import { employeeTypeOf } from "@/lib/employee-type";
import { orFallback } from "@/lib/format";
import { PersonForm } from "../person-form";
import { deactivatePersonAction, reactivatePersonAction, deletePersonAction, purgePersonAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("people.read");
  const { id } = await params;
  const [person] = await db.select().from(people).where(eq(people.id, id));
  if (!person) notFound();

  const canSeePerformance = user.permissions.has("performance.read");
  const canOpenCycle = user.permissions.has("performance.individual.read");
  const cycles = canSeePerformance
    ? await db.select().from(perfCycles).where(eq(perfCycles.personId, id)).orderBy(desc(perfCycles.createdAt))
    : [];
  // تقييم التبعيات يُعرض دائماً قبل زر الحذف — لا حذف مفاجئ ولا حذف تعاقبي
  const assessment = await assessDeletion("person", id);
  // v2.4.1 §1.3: معاينة أثر الحذف النهائي لدورة الحياة — تُحسب على الخادم قبل عرض الزر
  const canPurge = user.permissions.has("people.delete") && user.permissions.has("performance.individual.read");
  const purgeImpact = canPurge ? await assessPersonDeletion(id, { actorUserId: user.id }) : null;

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title={orFallback(person.fullName)}
        subtitle={`${employeeTypeOf(person)}${person.jobTitle ? ` — ${person.jobTitle}` : ""}`}
        actions={person.active ? <Badge value="نشط" /> : <Badge value="موقوف" />}
      />
      {!person.active && person.deactivateReason && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">سبب الإيقاف: {person.deactivateReason}</p>
        </Card>
      )}
      {person.suggestedModelKey && (
        <Card className="border-purple-200 bg-purple-50">
          <p className="text-sm text-purple-900">
            اقتراح آلي: نموذج الأداء المناسب لهذا المسمى قد يكون «{person.suggestedModelKey}» — الاقتراح يتطلب تأكيد المدير عند إنشاء دورة الأداء ولا يعتمد تلقائياً.
          </p>
        </Card>
      )}
      <Card>
        {/* §12.3/§13: الاسم وحده إلزامي؛ الباقي اختياري ويُقال أثره حين يغيب */}
        <CompletenessMeter
          className="mb-3"
          fields={[
            { label: "الاسم", filled: hasValue(person.fullName), affectsIntegration: true },
            { label: "الرقم الوظيفي", filled: hasValue(person.jobNumber), affectsIntegration: true },
            { label: "نوع الموظف", filled: hasValue(person.employeeType), affectsIntegration: true },
            { label: "المسمى الوظيفي", filled: hasValue(person.jobTitle) },
            { label: "المرتبة", filled: hasValue(person.cadre) },
            { label: "حالة التوظيف", filled: hasValue(person.employmentStatus) },
            { label: "الوحدة التنظيمية", filled: hasValue(person.orgUnit) },
            { label: "البريد الإلكتروني", filled: hasValue(person.email) },
          ]}
        />
        <PersonForm person={person} />
      </Card>
      {canSeePerformance && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-brand-900">دورات الأداء ({cycles.length})</h2>
            <LinkButton href="/performance" variant="secondary">إنشاء دورة أداء</LinkButton>
          </div>
          {cycles.length === 0 ? (
            <p className="text-sm text-gray-400">لا دورات أداء لهذا الشخص بعد</p>
          ) : (
            <ul className="space-y-2">
              {cycles.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-100 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{c.yearKey}</span>
                    <span className="text-xs text-gray-400">({c.cycleType})</span>
                    <Badge value={c.status} />
                  </span>
                  {canOpenCycle ? (
                    <LinkButton href={`/performance/cycles/${c.id}`} variant="secondary">فتح</LinkButton>
                  ) : (
                    <span className="text-xs text-gray-400">مقيد</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Card>
        <h2 className="mb-3 font-bold text-gray-800">إيقاف أو حذف</h2>
        {person.active ? (
          <form action={deactivatePersonAction.bind(null, person.id)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor="reason" className="mb-1 block text-sm text-gray-600">سبب الإيقاف (اختياري)</label>
              <input id="reason" name="reason" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <SubmitButton variant="secondary">إيقاف السجل</SubmitButton>
          </form>
        ) : (
          <form action={reactivatePersonAction.bind(null, person.id)}>
            <SubmitButton variant="secondary">إعادة التفعيل</SubmitButton>
          </form>
        )}
        {/*
          v2.5.0 §8.3: قائمة الارتباطات لم تعد تُعرض كحائط.
          كان السجل المرتبط يُظهر «لا يمكن الحذف — يوجد سجلات مرتبطة: …» ثم يقف، بينما
          «حذف الموظف نهائياً» أسفل الصفحة يعالج تلك السجلات بالضبط. فبدا للمستخدم أن
          الحذف ممنوع. الآن: المسار المختصر يظهر فقط حين يكون هو الصحيح فعلاً (سجل لم
          يُستعمل قط)، وإلا يُحال المستخدم صراحةً إلى لوحة الحذف النهائي أسفل الصفحة.
        */}
        <div className="mt-4 space-y-2">
          {assessment.blocked ? (
            canPurge ? (
              <p className="rounded-lg border border-sand-200 bg-sand-50 p-3 text-xs text-gray-600">
                لهذا الموظف سجلات مرتبطة ({dependencySummaryAr(assessment.dependencies)}). الحذف
                متاح من <strong>«حذف الموظف نهائياً»</strong> أسفل الصفحة: يمحو دورة حياته الوظيفية
                ويُبقي السجلات المؤسسية المشتركة ويفكّ صلتها به.
              </p>
            ) : (
              <DependencyNotice assessment={assessment} />
            )
          ) : (
            <form
              action={async () => {
                "use server";
                await deletePersonAction(person.id);
              }}
            >
              <p className="mb-2 text-xs text-gray-500">لا سجلات مرتبطة بهذا الموظف — الحذف مباشر.</p>
              <SubmitButton variant="danger" confirmText={`حذف «${orFallback(person.fullName)}» نهائياً؟ لا يمكن التراجع.`}>
                حذف نهائي
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>

      {/* v2.4.1 §1.3: الحذف النهائي لدورة الحياة — متاح حتى لمنسوب مستخدَم، وهو ما يميّزه
          عن «حذف نهائي» أعلاه المقصور على سجل بلا أي ارتباط. الصلاحيتان معاً شرط الظهور. */}
      {canPurge && purgeImpact && (
        <Card>
          <PermanentDeletePanel
            action={purgePersonAction.bind(null, person.id)}
            impact={purgeImpact}
            heading="حذف الموظف نهائياً"
            cta="حذف الموظف نهائياً"
            confirmFieldLabel="اسم الموظف"
            intro="يمحو سجل الموظف وكامل دورة حياته الوظيفية (دورات الأداء وجلساتها وتقديراتها وخطط تحسينها ووثائقها وشواهدها الخاصة). السجلات المؤسسية المشتركة — اللجان والبرامج والاجتماعات والمهام — تبقى كما هي وتُفكّ صلتها بالموظف فقط."
          />
        </Card>
      )}
    </div>
  );
}

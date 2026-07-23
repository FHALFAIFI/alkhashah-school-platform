import type { DeleteAssessment } from "@/lib/safe-delete";

/**
 * شرح عربي موحّد لسبب منع الحذف النهائي والبديل المتاح.
 * يُعرض قبل زر الحذف في كل وحدة حتى يعرف المستخدم ما الذي يحمي السجل ولماذا.
 */
export function DependencyNotice({ assessment }: { assessment: DeleteAssessment }) {
  if (!assessment.blocked) {
    return (
      <p className="rounded-lg bg-sand-50 p-3 text-xs text-gray-600">
        لا توجد سجلات مرتبطة بهذا العنصر — الحذف النهائي متاح.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">الحذف النهائي غير متاح — السجل مستخدم.</p>
      <ul className="mt-2 space-y-1 text-xs">
        {assessment.dependencies.map((d) => (
          <li key={d.type} className="flex items-center justify-between gap-2">
            <span>{d.labelAr}</span>
            <span className="tabular-nums font-medium">{d.count}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">{assessment.alternativeAr}</p>
    </div>
  );
}

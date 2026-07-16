/** شارة استحقاق المتابعة الأسبوعية (برنامج معتمد بلا متابعة لأكثر من 14 يوماً) */
export function FollowupDueBadge() {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      متابعة مستحقة
    </span>
  );
}

import { WEEKLY_STATUSES, NO_WEEKLY_UPDATE_LABEL } from "@/lib/plan/followup";
import { ISSUE_STATUSES } from "@/lib/building/maintenance-lifecycle";
import { COMMITTEE_TASK_STATUSES } from "@/lib/committees/task-status";

/**
 * خيارات مرشّح «الحالة» لكل تقرير — **قوائم مغلقة معلَنة**، لا قيم حرة من قاعدة البيانات.
 *
 * السبب أمني وتشغيلي معاً: قيمة حالة قادمة من صف بيانات قد تحمل نصاً غير متوقع يتسرّب
 * إلى عنصر الاختيار، وقيمة مطبوعة خطأً في سجل قديم تصنع خياراً وهمياً يربك المستخدم.
 * القائمة هنا هي المفردات التي يعرفها سير العمل فعلاً.
 *
 * كانت هذه الدالة داخل صفحة التقارير؛ نُقلت إلى وحدة مشتركة (v2.5.0) لأن مسار التصدير
 * ومنشئ التقارير يحتاجانها بالمفردات نفسها.
 */
export function statusOptionsFor(reportKey: string): string[] {
  switch (reportKey) {
    case "programs-active":
    case "programs-by-domain":
    case "programs-by-owner":
      return ["مسودة", "معتمد", "مقفل"];
    case "income-register":
      return ["مستلم", "متوقع", "ملغى"];
    case "committee-register":
    case "committee-registry-detailed":
    case "committee-summary":
      return ["مسودة", "معتمدة", "مقفلة"];
    case "meetings-register":
    case "meetings-registry-detailed":
      return ["مسودة", "مكتمل", "معتمد"];
    case "maintenance-register":
      return [...ISSUE_STATUSES];
    case "import-batches":
      return ["معاينة", "معتمد", "ملغى"];
    case "perf-evaluations":
    case "perf-incomplete":
    case "perf-results":
      return ["مسودة", "مكتملة", "مقفلة"];
    case "plan-followups":
    case "plan-followup-log":
      return [...WEEKLY_STATUSES, NO_WEEKLY_UPDATE_LABEL];
    case "improvement-plans":
      return ["مقترحة", "معتمدة", "منفذة"];
    case "committee-tasks":
      return [...COMMITTEE_TASK_STATUSES];
    default:
      return [];
  }
}

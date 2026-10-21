import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/validation";
import { getInstance, instanceOutputs } from "@/lib/reports/instances/service";
import { latestJob, isStale, JOB_PENDING, JOB_RUNNING } from "@/lib/reports/instances/jobs";

/**
 * حالة مهمة التوليد الخلفي — استعلام JSON خفيف لمؤشّر §I (D-069).
 *
 * كان المؤشّر يستطلع بتحديث كامل للصفحة كل أربع ثوانٍ (`router.refresh`)، فيُطلق مع كل
 * تحديثٍ إعادةَ جلب كل الجلب المسبق لروابط الصفحة — عشرات طلبات RSC تتزاحم على ستّ وصلات
 * HTTP/1.1 وتخنق التحديث الذي يحمل الحالة المرئية. هذا المسار يعيد غرامات معدودة من JSON:
 * الاستطلاع الدوري يقرأه وحده، والتحديث الكامل يقع **مرة واحدة** عند الوصول إلى حالة نهائية.
 *
 * التفويض كمسار التنزيل: جلسة + `reports.read`، و`getInstance` يُخفي الحسّاس عمّن لا
 * يملك صلاحيته الفردية (D-013) — لا يُكشف وجود التقرير ولا حالة مهمته.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.read")) {
    return NextResponse.json({ error: "لا تملك صلاحية قراءة التقارير" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });
  const row = await getInstance(id, user);
  if (!row) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });

  const job = await latestJob(row.id);
  const active = !!job && (job.status === JOB_PENDING || job.status === JOB_RUNNING) && !isStale(job);
  // المخرجات المحفوظة تُعاد مع الحالة النهائية كي يعرضها العميل فوراً دون انتظار تحديث الصفحة
  const outputs = active ? [] : (await instanceOutputs(row.id)).map((o) => ({ format: o.format, size: o.size }));

  return NextResponse.json(
    {
      active,
      job: job ? { status: job.status, attempt: job.attempt, error: job.error } : null,
      outputs,
      instanceStatus: row.status,
      reportNumber: row.reportNumber,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

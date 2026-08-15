import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/validation";
import { getInstance } from "@/lib/reports/instances/service";
import { readSnapshot } from "@/lib/reports/instances/options";
import { buildSnapshot, SnapshotPermissionError } from "@/lib/reports/instances/snapshot";
import { instanceHtml } from "@/lib/reports/instances/render";
import { INSTANCE_DRAFT } from "@/lib/reports/instances/types";

/**
 * معاينة الطباعة (v2.6 §F) — **الـHTML نفسه الذي يولَّد منه PDF حرفياً** (D-060):
 * المتصفّح يعرضه مقسّماً صفحات في معاينة الطباعة، فتطابق المعاينةُ الملفَّ تطابقَ مصدر
 * واحد لا تقريبَ محاكاة. المسودة تحمل ختم «مسودة» العرضي نفسه.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
  if (!user.permissions.has("reports.read")) {
    return NextResponse.json({ error: "لا تملك صلاحية الاطلاع على التقارير" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });
  const row = await getInstance(id, user);
  if (!row) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });

  try {
    const doc =
      row.status === INSTANCE_DRAFT
        ? await buildSnapshot({
            instanceId: row.id,
            typeKey: row.typeKey,
            title: row.title,
            storedFilters: row.filters,
            storedOptions: row.options,
            periodFrom: row.periodFrom,
            periodTo: row.periodTo,
            viewer: user,
          })
        : readSnapshot(row.snapshot);
    if (!doc) return NextResponse.json({ error: "تعذّر قراءة التقرير" }, { status: 500 });

    const html = await instanceHtml(doc, {
      reportNumber: row.reportNumber,
      draftBanner: row.status === INSTANCE_DRAFT,
    });
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // لقطة ثابتة تُعرض كما هي — لا سكربتات فيها أصلاً، والرأس يمنع أي محتوى نشط
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    if (e instanceof SnapshotPermissionError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "تعذّر بناء المعاينة" }, { status: 500 });
  }
}

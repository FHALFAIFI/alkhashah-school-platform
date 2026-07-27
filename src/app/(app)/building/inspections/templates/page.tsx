import Link from "next/link";
import { asc, desc, inArray, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { inspectionTemplates, inspections } from "@/db/schema";
import { PageHeader, Card, Badge, EmptyState, LinkButton } from "@/components/ui";
import { statusLabel, TEMPLATE_STATUS } from "@/lib/building/inspection-templates";
import { orFallback } from "@/lib/format";

export const metadata = { title: "قوالب الفحص" };
export const dynamic = "force-dynamic";

export default async function TemplatesListPage() {
  const user = await requirePermission("inspections.read");
  const canWrite = user.permissions.has("inspections.write");

  const all = await db.select().from(inspectionTemplates).orderBy(asc(inspectionTemplates.code), desc(inspectionTemplates.version));

  // عدد الاستخدام لكل قالب (فحوصات مرتبطة)
  const ids = all.map((t) => t.id);
  const usage = new Map<string, number>();
  if (ids.length > 0) {
    const rows = await db
      .select({ templateId: inspections.templateId, c: sql<number>`count(*)::int` })
      .from(inspections)
      .where(inArray(inspections.templateId, ids))
      .groupBy(inspections.templateId);
    for (const r of rows) if (r.templateId) usage.set(r.templateId, Number(r.c));
  }

  // تجميع حسب العائلة (rootId أو id)
  const families = new Map<string, typeof all>();
  for (const t of all) {
    const root = t.rootId ?? t.id;
    families.set(root, [...(families.get(root) ?? []), t]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="قوالب الفحص"
        subtitle="أنشئ قوالب الفحص وحرّرها وأصدر نسخاً جديدة وفعّلها — القوالب المُفعّلة تظهر في الفحص الميداني. القوالب الافتراضية قوالب نظام مرجعية (ليست نتائج فحص)."
        actions={canWrite ? <LinkButton href="/building/inspections/templates/new">إنشاء قالب</LinkButton> : undefined}
      />

      {families.size === 0 ? (
        <EmptyState title="لا قوالب فحص بعد" hint={canWrite ? "أنشئ قالباً جديداً أو ابذر قوالب النظام الافتراضية" : "لم تُنشأ قوالب بعد"} />
      ) : (
        <div className="space-y-3">
          {[...families.values()].map((versions) => {
            const head = versions[0];
            const active = versions.find((v) => v.status === TEMPLATE_STATUS.active);
            return (
              <Card key={head.rootId ?? head.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-brand-900">{orFallback(active?.nameAr ?? head.nameAr)}</span>
                      <span className="tabular-nums text-xs text-gray-400" dir="ltr">{head.code ?? "—"}</span>
                      {head.isSystem && <span className="rounded bg-sand-100 px-1.5 py-0.5 text-[10px] text-gray-600">قالب نظام</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {head.roomType ? `نوع الغرفة: ${head.roomType} · ` : ""}
                      {head.purpose ? `الغرض: ${head.purpose} · ` : ""}
                      {versions.length} إصدار
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {versions.map((v) => (
                      <Link
                        key={v.id}
                        href={`/building/inspections/templates/${v.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs hover:bg-sand-50"
                      >
                        <span className="tabular-nums" dir="ltr">v{v.version}</span>
                        <Badge value={statusLabel(v.status)} />
                        {(usage.get(v.id) ?? 0) > 0 && <span className="text-gray-400">({usage.get(v.id)} فحص)</span>}
                      </Link>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

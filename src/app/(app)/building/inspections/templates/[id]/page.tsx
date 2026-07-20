import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/db";
import { inspectionTemplates, inspections, rooms } from "@/db/schema";
import { PageHeader, Card, Badge } from "@/components/ui";
import { isUuid } from "@/lib/validation";
import { statusLabel, TEMPLATE_STATUS, type TemplateSection } from "@/lib/building/inspection-templates";
import { TemplatePreview } from "../template-preview";
import {
  ActivateButton,
  DeactivateButton,
  DuplicateButton,
  DeleteDraftButton,
  NewVersionButton,
} from "../template-controls";

export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inspections.read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [t] = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.id, id));
  if (!t) notFound();
  const canWrite = user.permissions.has("inspections.write");
  const canActivate = user.permissions.has("building.publish");

  const rootId = t.rootId ?? t.id;
  const [versions, [{ usageCount }], usageRooms] = await Promise.all([
    db.select().from(inspectionTemplates).where(eq(inspectionTemplates.rootId, rootId)).orderBy(desc(inspectionTemplates.version)),
    db.select({ usageCount: sql<number>`count(*)::int` }).from(inspections).where(eq(inspections.templateId, id)),
    db
      .select({ roomName: rooms.nameAr, date: inspections.inspectionDate, version: inspections.templateVersion })
      .from(inspections)
      .innerJoin(rooms, eq(inspections.roomId, rooms.id))
      .where(eq(inspections.templateId, id))
      .orderBy(desc(inspections.inspectionDate))
      .limit(10),
  ]);

  const sections = (t.sections as TemplateSection[] | null) ?? [];
  const used = Number(usageCount) > 0;
  const isDraft = t.status === TEMPLATE_STATUS.draft;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.nameAr}
        subtitle={`${t.code ?? ""} · إصدار ${t.version} · ${statusLabel(t.status)}${t.isSystem ? " · قالب نظام" : ""}`}
        actions={
          <Link href="/building/inspections/templates" className="text-sm text-brand-700 underline">
            ← كل القوالب
          </Link>
        }
      />

      {canWrite && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft ? (
              <>
                <Link
                  href={`/building/inspections/templates/${id}/edit`}
                  className="inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white"
                >
                  تعديل القالب
                </Link>
                {canActivate && <ActivateButton templateId={id} />}
                {!used && <DeleteDraftButton templateId={id} />}
              </>
            ) : (
              <>
                <NewVersionButton templateId={id} />
                {t.status === TEMPLATE_STATUS.active
                  ? canActivate && <DeactivateButton templateId={id} />
                  : canActivate && <ActivateButton templateId={id} />}
              </>
            )}
            <DuplicateButton templateId={id} />
          </div>
          {used && (
            <p className="mt-2 text-xs text-gray-500">
              استُخدم هذا الإصدار في {Number(usageCount)} فحص — لا يمكن حذفه؛ التعديل ينشئ إصداراً جديداً يحفظ التكامل التاريخي.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">معاينة القالب</h2>
        <TemplatePreview sections={sections} />
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">إصدارات القالب</h2>
        <ul className="space-y-1 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/building/inspections/templates/${v.id}`} className={v.id === id ? "font-bold text-brand-900" : "text-brand-700 underline"}>
                إصدار {v.version}
              </Link>
              <Badge value={statusLabel(v.status)} />
              <span className="text-xs text-gray-400">{v.createdAt.toLocaleDateString("ar-SA-u-nu-latn")}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-brand-900">سجل الاستخدام (هذا الإصدار)</h2>
        {usageRooms.length === 0 ? (
          <p className="text-sm text-gray-400">لم يُستخدم هذا الإصدار في أي فحص بعد.</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-600">
            {usageRooms.map((r, i) => (
              <li key={i}>
                {r.roomName} — {r.date.toLocaleDateString("ar-SA-u-nu-latn")}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

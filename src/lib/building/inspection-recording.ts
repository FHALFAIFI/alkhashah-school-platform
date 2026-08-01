import "server-only";
import { db } from "@/db";
import { inspections, inspectionFindings, inspectionTemplates } from "@/db/schema";
import type { TemplateItem, TemplateSection, Severity } from "./inspection-template-defs";

/**
 * تسجيل الفحص الموحّد (v2.3 §16) — نقطة واحدة للمسارين المتصل وغير المتصل:
 *  - يجمّد نسخة القالب ورقم إصداره في سجل الفحص (كان مسار المزامنة يسقطهما — ثغرة
 *    سلامة تاريخية أُغلقت هنا).
 *  - ينشئ «ملاحظة فحص» لكل بند فاشل بخطورته من القالب، فتُتابَع حتى الإغلاق
 *    أو تتحول إلى بلاغ صيانة.
 */

export type InspectionResultEntry = { key: string; ok: boolean; note?: string };

/** استخراج العناصر الغنية (بالخطورة) من أقسام القالب؛ يسقط إلى العناصر المسطّحة عند غيابها */
export function richTemplateItems(template: {
  items: { key: string; label: string; required: boolean }[];
  sections: unknown[] | null;
}): (TemplateItem | { key: string; label: string; required: boolean })[] {
  if (Array.isArray(template.sections) && template.sections.length > 0) {
    try {
      return (template.sections as TemplateSection[]).flatMap((s) => s.items);
    } catch {
      return template.items;
    }
  }
  return template.items;
}

const CRITICAL_SEVERITY: Severity = "حرج";

export async function recordInspection(opts: {
  roomId: string;
  template: typeof inspectionTemplates.$inferSelect;
  results: InspectionResultEntry[];
  inspectorId: string;
  notes?: string | null;
  photos?: string[];
  clientOpId?: string;
  inspectionDate?: Date;
}): Promise<{ inspectionId: string | null; findingsCount: number }> {
  const inserted = await db
    .insert(inspections)
    .values({
      clientOpId: opts.clientOpId,
      roomId: opts.roomId,
      templateId: opts.template.id,
      inspectionDate: opts.inspectionDate ?? new Date(),
      results: opts.results,
      photos: opts.photos ?? null,
      notes: opts.notes || null,
      inspectorId: opts.inspectorId,
      // تجميد تاريخي: نسخة القالب المستخدَمة الآن — لا تغيّرها تعديلات القالب اللاحقة
      templateSnapshot: opts.template.sections ?? opts.template.items,
      templateVersion: opts.template.version,
    })
    .onConflictDoNothing(opts.clientOpId ? { target: inspections.clientOpId } : undefined)
    .returning({ id: inspections.id });

  if (inserted.length === 0) return { inspectionId: null, findingsCount: 0 }; // مزامن مسبقاً — لا تكرار

  const inspectionId = inserted[0].id;
  const rich = richTemplateItems(opts.template);
  const byKey = new Map(rich.map((i) => [i.key, i]));

  const failed = opts.results.filter((r) => !r.ok);
  if (failed.length > 0) {
    await db.insert(inspectionFindings).values(
      failed.map((r) => {
        const item = byKey.get(r.key);
        const severity =
          item && "severityOnFail" in item && item.severityOnFail ? item.severityOnFail : "متوسط";
        return {
          inspectionId,
          roomId: opts.roomId,
          itemKey: r.key,
          label: item?.label ?? r.key,
          note: r.note || null,
          severity,
          critical: severity === CRITICAL_SEVERITY,
        };
      }),
    );
  }
  return { inspectionId, findingsCount: failed.length };
}

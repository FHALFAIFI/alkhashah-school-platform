import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { evidenceItems, evidenceLinks } from "@/db/schema";
import { entityLabelAr, refHref, resolveEntities, type EntityRef } from "@/lib/entity-registry";
import { assessDeletion, type DeleteAssessment } from "@/lib/safe-delete";

/** السجلات المرتبطة بشاهد، مجمّعة حسب النوع — أساس واجهة «مستخدم في» وحارس الحذف. */
export type EvidenceUsage = {
  entityType: string;
  labelAr: string;
  refs: (Omit<EntityRef, "href"> & { href: string | null; subKey: string })[];
};

/**
 * أين يُستخدم هذا الشاهد. يحقق مبدأ «رفع مرة واحدة، استخدام في كل مكان»: الشاهد الواحد
 * يظهر هنا بكل السجلات التي يخدمها بدل أن يُرفع نسخة لكل وحدة.
 */
export async function evidenceUsage(evidenceId: string): Promise<EvidenceUsage[]> {
  const links = await db
    .select({ entityType: evidenceLinks.entityType, entityId: evidenceLinks.entityId, subKey: evidenceLinks.subKey })
    .from(evidenceLinks)
    .where(eq(evidenceLinks.evidenceId, evidenceId));
  if (links.length === 0) return [];

  const byType = new Map<string, { id: string; subKey: string }[]>();
  for (const l of links) {
    const arr = byType.get(l.entityType) ?? [];
    arr.push({ id: l.entityId, subKey: l.subKey });
    byType.set(l.entityType, arr);
  }

  const out: EvidenceUsage[] = [];
  for (const [entityType, entries] of byType) {
    const refs = await resolveEntities(entityType, [...new Set(entries.map((e) => e.id))]);
    const byId = new Map(refs.map((r) => [r.id, r]));
    out.push({
      entityType,
      labelAr: entityLabelAr(entityType),
      refs: entries
        .map((e) => {
          const ref = byId.get(e.id);
          // سجل محذوف أو غير قابل للحل — يُعرض ولا يُتجاهل بصمت
          const resolved: EntityRef = ref ?? { id: e.id, labelAr: "سجل غير متاح", locked: true };
          return { ...resolved, href: refHref(entityType, resolved), subKey: e.subKey };
        })
        .sort((a, b) => a.labelAr.localeCompare(b.labelAr, "ar")),
    });
  }
  return out.sort((a, b) => a.labelAr.localeCompare(b.labelAr, "ar"));
}

/**
 * قاعدة إلزامية (نطاق المنتج v2): الحذف النهائي للشاهد متاح فقط حين لا يكون مستخدماً
 * في أي سجل. أي ارتباط — بأي نوع، معروف أو غير معروف — يمنع الحذف ويوجّه إلى الأرشفة،
 * فلا يُكسَر أي سجل تاريخي ولا يُحذف رابط بالسلسلة بصمت.
 *
 * fail-closed: نوع ارتباط غير مسجَّل في `entity-registry` يمنع الحذف بدل أن يمر بصمت
 * كما كان يحدث سابقاً.
 */
export async function canDeleteEvidence(evidenceId: string): Promise<{ allowed: boolean; reason?: string; assessment: DeleteAssessment }> {
  const assessment = await assessDeletion("evidence", evidenceId);
  return {
    allowed: !assessment.blocked,
    reason: assessment.blocked ? assessment.messageAr : undefined,
    assessment,
  };
}

export async function linkEvidence(opts: {
  evidenceId: string;
  entityType: string;
  entityId: string;
  subKey?: string;
  linkedBy?: string;
}) {
  await db
    .insert(evidenceLinks)
    .values({
      evidenceId: opts.evidenceId,
      entityType: opts.entityType,
      entityId: opts.entityId,
      subKey: opts.subKey ?? "",
      linkedBy: opts.linkedBy,
    })
    .onConflictDoNothing();
}

/**
 * شواهد سجل معيّن. الشواهد المؤرشفة مستبعدة افتراضاً (الأرشفة إخفاء غير مدمّر)،
 * ويمكن طلبها صراحةً عند الحاجة لعرض السجل التاريخي.
 */
export async function evidenceForEntity(
  entityType: string,
  entityId: string,
  opts: { includeArchived?: boolean } = {},
) {
  const where = opts.includeArchived
    ? and(eq(evidenceLinks.entityType, entityType), eq(evidenceLinks.entityId, entityId))
    : and(
        eq(evidenceLinks.entityType, entityType),
        eq(evidenceLinks.entityId, entityId),
        isNull(evidenceItems.archivedAt),
      );
  return db
    .select({
      link: evidenceLinks,
      item: evidenceItems,
    })
    .from(evidenceLinks)
    .innerJoin(evidenceItems, eq(evidenceLinks.evidenceId, evidenceItems.id))
    .where(where);
}

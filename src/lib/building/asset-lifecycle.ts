import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  maintenanceIssues,
  evidenceLinks,
  documents,
  permissions,
  rolePermissions,
  roles,
} from "@/db/schema";

/**
 * دورة حياة الأصل (Phase 2):
 * - الأرشفة هي الإجراء الافتراضي: إخفاء غير مدمّر مع سبب عربي، يحفظ الفحوصات والصيانة
 *   وسجل الغرفة وهوية رمز QP وسجل التدقيق، وقابل للاستعادة.
 * - الحذف النهائي مشروط: يسمح به فقط للأصل المُنشأ بالخطأ وبلا أي تبعية، وبعد تأكيد
 *   عربي صريح؛ ويُحظر من الخادم عند وجود تبعيات مع بيان أنواعها وأعدادها.
 * لا نحذف أبداً بالسلسلة (cascade) فحوصاً أو صيانة أو شواهد أو وثائق أو سجل تدقيق.
 */

export type AssetDependency = { type: string; labelAr: string; count: number };

/** يجمع كل التبعيات التي تمنع الحذف النهائي — أرقام عربية للعرض. */
export async function getAssetDependencies(assetId: string): Promise<AssetDependency[]> {
  const [mnt, ev, docs] = await Promise.all([
    db.select({ c: count() }).from(maintenanceIssues).where(eq(maintenanceIssues.assetId, assetId)),
    db
      .select({ c: count() })
      .from(evidenceLinks)
      .where(and(eq(evidenceLinks.entityType, "asset"), eq(evidenceLinks.entityId, assetId))),
    db
      .select({ c: count() })
      .from(documents)
      .where(and(eq(documents.entityType, "asset"), eq(documents.entityId, assetId))),
  ]);

  const deps: AssetDependency[] = [];
  const mntC = Number(mnt[0]?.c ?? 0);
  const evC = Number(ev[0]?.c ?? 0);
  const docC = Number(docs[0]?.c ?? 0);
  if (mntC > 0) deps.push({ type: "maintenance", labelAr: "بلاغات صيانة", count: mntC });
  if (evC > 0) deps.push({ type: "evidence", labelAr: "شواهد ومرفقات", count: evC });
  if (docC > 0) deps.push({ type: "documents", labelAr: "وثائق صادرة", count: docC });
  // ملاحظة: لا يوجد ربط مباشر بين الفحص والأصل في المخطط الحالي (الفحص على مستوى الغرفة)،
  // لذا «الفحوصات» لا تشكّل تبعية مباشرة للأصل. تبقى الدالة قابلة للتوسّع إن أضيف الربط.
  return deps;
}

export async function assetIsDeletable(assetId: string): Promise<boolean> {
  return (await getAssetDependencies(assetId)).length === 0;
}

/**
 * ترخيص الحذف النهائي إن لم يُبذر مفتاح assets.delete بعد في قاعدة قائمة (يُبذر تلقائياً
 * في الإنتاج النظيف). idempotent — آمن التكرار. يمنح principal وsysadmin.
 */
export async function seedAssetLifecycleRbac(): Promise<void> {
  await db
    .insert(permissions)
    .values({ key: "assets.delete", nameAr: "حذف الأصول نهائياً", module: "building" })
    .onConflictDoNothing({ target: permissions.key });
  const [perm] = await db.select().from(permissions).where(eq(permissions.key, "assets.delete"));
  if (!perm) return;
  const roleRows = await db.select().from(roles);
  for (const role of roleRows) {
    if (role.key === "principal" || role.key === "sysadmin") {
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    }
  }
}

/** أنواع أحداث سجل الأصل الخاصة بدورة الحياة (للاستخدام في الأفعال والاختبارات). */
export const ASSET_EVENT = {
  archived: "أرشفة",
  restored: "استعادة",
  deleted: "حذف نهائي",
} as const;

/** لأغراض الاختبار/التقارير: هل الأصل مؤرشف؟ */
export function isArchived(a: { active: boolean; archivedAt: Date | null }): boolean {
  return !a.active && a.archivedAt != null;
}

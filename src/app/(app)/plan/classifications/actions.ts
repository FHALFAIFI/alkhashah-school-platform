"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { planYears, programs } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";
import type { ActionState } from "../actions";

/**
 * إدارة التصنيفات (تصحيحات v2.1 §A2). «التصنيف» ليس كياناً مستقلاً — هو قيمة حقل «المجال»
 * الحرّة في البرنامج. لذلك «إعادة التسمية» = تحديث جماعي لقيمة المجال، و«الحذف» = إعادة توزيع
 * برامج التصنيف إلى تصنيف بديل أو مسح تصنيفها ("") — دون حذف أي برنامج ولا فقدان أي بيانات.
 * النطاق مطابق لصفحة الإدارة: برامج السنة النشطة، غير الاصطناعية، غير المؤرشفة.
 */

/** رمز خاص في القائمة يعني «مسح التصنيف» (تعيين المجال إلى "") */
const CLEAR_TARGET = "__CLEAR__";

/** معرّفات السنوات ضمن نطاق الإدارة — النشطة إن وُجدت، وإلا كل السنوات */
async function scopePlanYearIds(): Promise<string[]> {
  const years = await db.select({ id: planYears.id, status: planYears.status }).from(planYears);
  const active = years.filter((y) => y.status === "نشطة");
  return (active.length ? active : years).map((y) => y.id);
}

/** إعادة تسمية/دمج تصنيف: نقل كل برامج oldDomain إلى newDomain */
export async function renameClassificationAction(
  oldDomain: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const newDomain = String(formData.get("newDomain") ?? "").trim();
  if (newDomain.length === 0) return { error: "أدخل اسم التصنيف الجديد" };
  if (newDomain === oldDomain) return { success: "لا تغيير — الاسم كما هو" };

  const yearIds = await scopePlanYearIds();
  if (yearIds.length === 0) return { error: "لا توجد سنة تخطيطية" };
  const excluded = await getExcludedIdSets();

  const updated = await db
    .update(programs)
    .set({ domain: newDomain, updatedAt: new Date() })
    .where(and(
      eq(programs.domain, oldDomain),
      inArray(programs.planYearId, yearIds),
      notSynthetic(programs.id, excluded.programs),
      isNull(programs.archivedAt),
    ))
    .returning({ id: programs.id });

  if (updated.length === 0) return { error: "لا برامج ضمن هذا التصنيف لإعادة تسميتها" };
  await audit({
    actorId: user.id,
    action: "plan.classification_renamed",
    entityType: "plan",
    summary: `إعادة تسمية تصنيف «${oldDomain || "بدون تصنيف"}» إلى «${newDomain}» — ${updated.length} برنامجاً`,
  });
  revalidatePath("/plan");
  revalidatePath("/plan/classifications");
  return { success: `أُعيدت تسمية التصنيف — ${updated.length} برنامجاً` };
}

/** «حذف» تصنيف: إعادة توزيع برامجه إلى target (تصنيف قائم) أو مسحها عبر __CLEAR__ */
export async function deleteClassificationAction(
  domain: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requirePermission("plan.write");
  const target = String(formData.get("target") ?? "").trim();
  if (target.length === 0) return { error: "اختر تصنيفاً بديلاً أو «مسح التصنيف»" };
  const newDomain = target === CLEAR_TARGET ? "" : target;
  if (newDomain === domain) return { success: "لا تغيير — التصنيف البديل هو نفسه" };

  const yearIds = await scopePlanYearIds();
  if (yearIds.length === 0) return { error: "لا توجد سنة تخطيطية" };
  const excluded = await getExcludedIdSets();

  const updated = await db
    .update(programs)
    .set({ domain: newDomain, updatedAt: new Date() })
    .where(and(
      eq(programs.domain, domain),
      inArray(programs.planYearId, yearIds),
      notSynthetic(programs.id, excluded.programs),
      isNull(programs.archivedAt),
    ))
    .returning({ id: programs.id });

  if (updated.length === 0) return { error: "لا برامج ضمن هذا التصنيف" };
  const targetLabel = newDomain === "" ? "بدون تصنيف" : newDomain;
  await audit({
    actorId: user.id,
    action: "plan.classification_reassigned",
    entityType: "plan",
    summary: `حذف تصنيف «${domain || "بدون تصنيف"}» بإعادة توزيع ${updated.length} برنامجاً إلى «${targetLabel}»`,
  });
  revalidatePath("/plan");
  revalidatePath("/plan/classifications");
  return { success: `أُعيد توزيع ${updated.length} برنامجاً إلى «${targetLabel}»` };
}

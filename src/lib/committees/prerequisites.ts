import "server-only";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { people, importBatches } from "@/db/schema";
import { getExcludedIdSets, notSynthetic } from "@/lib/synthetic";

/**
 * تشكيل اللجان يعتمد على بيانات منسوبي المدرسة المعتمدة (المنفَّذة) — الأعضاء من المنسوبين حصراً.
 * قبل اعتماد دفعة فارس لا يوجد منسوبون معتمدون، فيُعرض متطلَّب سابق برابط معاينة فارس ويُمنع التشكيل.
 */

/** عدد منسوبي المدرسة المتاحين للتشكيل: نشطون وغير مستبعدين (اصطناعيون/مؤرشفون). */
export async function committedEmployeeCount(): Promise<number> {
  const excluded = await getExcludedIdSets();
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.active, true), notSynthetic(people.id, excluded.people)));
  return rows.length;
}

/** معرّف دفعة فارس في المعاينة (أحدث دفعة أشخاص «معاينة» اسم ملفها يحوي «فارس») — للرابط. */
export async function faresPreviewBatchId(): Promise<string | null> {
  const [b] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.importType, "people"),
        eq(importBatches.status, "معاينة"),
        like(importBatches.sourceFileName, "%فارس%"),
      ),
    )
    .orderBy(desc(importBatches.createdAt))
    .limit(1);
  return b?.id ?? null;
}

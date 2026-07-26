import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { committeeTaskTemplates, committeeTemplates } from "@/db/schema";

/**
 * قوالب المهام المعرّفة مسبقاً لكل نوع لجنة (D-027). تُبذَر مرةً من مهام القالب الرسمي (duties)،
 * ثم تُدار مركزياً. البذر لا يكرّر ولا يعيد كتابة تعديلات المدير: إن وُجد لنوع اللجنة أي قالب
 * مهمة، يُترك كما هو.
 */
export async function seedCommitteeTaskTemplates(): Promise<{ seeded: number }> {
  const templates = await db.select().from(committeeTemplates);
  let seeded = 0;
  for (const t of templates) {
    const duties = (t.duties ?? []).filter((d) => d.trim().length > 0);
    if (duties.length === 0) continue;
    const existing = await db
      .select({ id: committeeTaskTemplates.id })
      .from(committeeTaskTemplates)
      .where(eq(committeeTaskTemplates.templateKey, t.key))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(committeeTaskTemplates).values(
      duties.map((title, i) => ({ templateKey: t.key, title, sortOrder: i })),
    );
    seeded += duties.length;
  }
  return { seeded };
}

/** قوالب المهام الفعّالة لنوع لجنة (بمفتاح القالب). */
export async function activeTaskTemplatesFor(templateKey: string) {
  return db
    .select()
    .from(committeeTaskTemplates)
    .where(and(eq(committeeTaskTemplates.templateKey, templateKey), eq(committeeTaskTemplates.active, true)))
    .orderBy(asc(committeeTaskTemplates.sortOrder));
}

/** كل قوالب المهام لنوع لجنة (للإدارة — تشمل المعطّلة). */
export async function allTaskTemplatesFor(templateKey: string) {
  return db
    .select()
    .from(committeeTaskTemplates)
    .where(eq(committeeTaskTemplates.templateKey, templateKey))
    .orderBy(asc(committeeTaskTemplates.sortOrder));
}

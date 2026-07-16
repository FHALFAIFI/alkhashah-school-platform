/**
 * زرع النماذج الرسمية الثمانية (D-006/D-014) — محتوى حرفي من ملف الوزارة بعد تحقق بصري
 * (docs/PERFORMANCE_MODEL_VALIDATION.md). idempotent: يتخطى النموذج الموجود بمفتاحه.
 *
 * تدخل معتمدة مباشرة: الاعتماد يقفل التعديل العادي (إضافة/حذف مؤشرات) ولا يبقى
 * إلا مسار «إعادة الفتح بسبب موثق». مجموع أوزان كل نموذج يفحص هنا ويرفض ≠ 100.
 */
import { eq } from "drizzle-orm";
import { db } from "./index";
import { perfModels, perfIndicators } from "./schema";
import { officialPerfModelsSeed } from "./seed-data/performance-models-official";

export async function seedOfficialPerfModels() {
  for (const m of officialPerfModelsSeed) {
    const total = m.indicators.reduce((s, i) => s + i.weight, 0);
    if (total !== 100) {
      throw new Error(`النموذج الرسمي ${m.key} مجموع أوزانه ${total}٪ — يجب 100٪ تماماً`);
    }
    const existing = await db.select().from(perfModels).where(eq(perfModels.key, m.key));
    if (existing.length > 0) continue;
    const [model] = await db
      .insert(perfModels)
      .values({
        key: m.key,
        nameAr: m.nameAr,
        audience: m.audience,
        official: true,
        status: "معتمد",
        approvedAt: new Date(),
        description: `نموذج رسمي — وزارة التعليم، «نماذج تقييم أداء شاغلي الوظائف التعليمية» (الإصدار الأول)، صفحة ${m.printedPage}. أدخل حرفياً بعد تحقق بصري (docs/PERFORMANCE_MODEL_VALIDATION.md).`,
      })
      .returning();
    let i = 0;
    for (const ind of m.indicators) {
      await db.insert(perfIndicators).values({
        modelId: model.id,
        sortOrder: i++,
        nameAr: ind.nameAr,
        weight: String(ind.weight),
        requiresEvidence: true,
        description: ind.section ?? null,
      });
    }
  }
}

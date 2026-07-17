/**
 * تجهيزات بيئة اختبار الواجهة (E2E) على القاعدة المعزولة فقط.
 * ينشئ دفعة استيراد بديلة تحمل اسم ملف فارس الرسمي بحالة «معاينة» ببيانات اصطناعية
 * بالكامل (لا بيانات شخصية حقيقية) — يتيح لسيناريو «حرمة دفعة فارس» أن يعمل معزولاً
 * دون لمس الملف الحقيقي. idempotent: لا يكرر الدفعة عند إعادة التشغيل.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { importBatches, importRows } from "../src/db/schema";

const FARES_FILE = "بيانات الموظفين في فارس.xlsx";

async function main() {
  const existing = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.sourceFileName, FARES_FILE));

  if (existing.length === 0) {
    const [batch] = await db
      .insert(importBatches)
      .values({
        importType: "people",
        sourceFileName: FARES_FILE,
        status: "معاينة",
        summary: {
          "إجمالي الصفوف": 2,
          ملاحظة: "بيانات اصطناعية بديلة لبيئة الاختبار المعزولة — لا تمثل موظفين حقيقيين",
        },
      })
      .returning();
    await db.insert(importRows).values([
      {
        batchId: batch.id,
        rowIndex: 2,
        raw: {},
        mapped: { fullName: "بديل اختبار أول", category: "معلم" },
        validation: { errors: [], warnings: [] },
        status: "جاهز",
      },
      {
        batchId: batch.id,
        rowIndex: 3,
        raw: {},
        mapped: { fullName: "بديل اختبار ثانٍ", category: "موظف" },
        validation: { errors: [], warnings: ["تصنيف مقترح — يحتاج مراجعة"] },
        status: "يحتاج مراجعة",
      },
    ]);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

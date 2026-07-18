/**
 * D-014 — خلاف موثق بين مصدرين رسميين على وزن ثلاث خلايا: ملف النماذج (الإصدار الأول) يظهر 5٪
 * بينما الدليل الإرشادي ص30/44/45 يظهر 15٪ (يجعل مجموع الجدول 110٪ المستحيل). المعتمد مؤقتاً هو
 * قيمة ملف النماذج (5٪) لأن مجموعها 100٪، وتُعلَّم «بانتظار المطابقة مع نظام فارس».
 *
 * لا يُقفَل التقييم النهائي على نموذج رسمي أصلي (النسخة 1) يحوي خلية D-014 حتى يطابق المدير القيمة
 * مع نظام فارس — والمطابقة تتم بإصدار نسخة نموذج معتمدة جديدة (إعادة فتح بسبب موثق ثم اعتماد)،
 * ولا تُغيَّر لقطات الدورات القائمة. هذا التصنيف مشتق برمجياً (لا تعديل بيانات) فيبقى مرئياً دون
 * لمس القاعدة الحقيقية.
 */

export const AWAITING_FARES_LABEL = "بانتظار المطابقة مع نظام فارس";

/** أسماء مؤشرات D-014 الثلاثة (رياض الأطفال، الوكيل، المدير) */
const D014_INDICATOR_NAMES = new Set([
  "تهيئ بيئة تعلمية آمنة ومعززة للتطور النمائي والتعلم",
  "ينفذ إجراءات علمية لتحسين نتائج التعلم",
]);

const D014_MODEL_KEYS = new Set(["kindergarten-teacher", "school-vice", "school-principal"]);

/** هل هذا المؤشر خلية D-014 معلّقة (نموذج رسمي أصلي، القيمة المؤقتة 5٪)؟ */
export function isAwaitingFaresIndicator(opts: {
  modelKey?: string | null;
  modelOfficial?: boolean | null;
  modelVersion?: number | null;
  indicatorNameAr: string;
  weight?: number | string | null;
}): boolean {
  if (!opts.modelOfficial) return false;
  if ((opts.modelVersion ?? 1) !== 1) return false; // المطابقة تُنشئ نسخة جديدة فلا تعود معلّقة
  if (opts.modelKey && !D014_MODEL_KEYS.has(opts.modelKey)) return false;
  if (!D014_INDICATOR_NAMES.has(opts.indicatorNameAr.trim())) return false;
  const w = Number(opts.weight);
  return Number.isNaN(w) ? true : w === 5; // القيمة المؤقتة المعتمدة
}

type ModelSnapshot = {
  model?: { key?: string | null; official?: boolean | null; version?: number | null } | null;
  indicators?: { nameAr?: string | null; weight?: number | string | null }[] | null;
};

/** أسماء خلايا D-014 المعلّقة داخل لقطة نموذج مجمّدة لدورة — أساس بوابة الإقفال. */
export function snapshotAwaitingFaresCells(modelSnapshot: unknown): string[] {
  const s = modelSnapshot as ModelSnapshot | null;
  if (!s?.indicators) return [];
  return s.indicators
    .filter((i) =>
      isAwaitingFaresIndicator({
        modelKey: s.model?.key,
        modelOfficial: s.model?.official,
        modelVersion: s.model?.version,
        indicatorNameAr: (i.nameAr ?? "").trim(),
        weight: i.weight,
      }),
    )
    .map((i) => (i.nameAr ?? "").trim());
}

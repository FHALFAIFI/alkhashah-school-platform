/**
 * حساب درجات الأداء — القاعدة الرسمية الإلزامية:
 *   الدرجة الموزونة = (التقدير ÷ 5) × وزن المؤشر
 * لا يسمح بأي تجاوز يدوي للنسب إطلاقاً؛ الحساب في الخادم حصراً.
 */

export type RatingEntry = { indicatorId: string; weight: number; rating: number | null };

export function weightedScore(rating: number, weight: number): number {
  return (rating / 5) * weight;
}

/** نتيجة الجلسة: مجموع الدرجات الموزونة للمؤشرات المقيمة */
export function sessionResult(entries: RatingEntry[]): { result: number; coverage: number } {
  const rated = entries.filter((e) => e.rating !== null && e.rating >= 1 && e.rating <= 5);
  const result = rated.reduce((s, e) => s + weightedScore(e.rating!, e.weight), 0);
  const coverage = entries.length === 0 ? 0 : rated.length / entries.length;
  return { result: Math.round(result * 100) / 100, coverage: Math.round(coverage * 100) / 100 };
}

/** قيمة نوع جلسة التخطيط — تخطيط فقط، مستثناة من كل حساب تقييمي (D-028) */
export const PLANNING_SESSION_TYPE = "تخطيط";

/**
 * تقدم الدورة: أحدث تقدير لكل مؤشر عبر جلسات الدورة (حسب تاريخ الجلسة ثم الإنشاء).
 *
 * D-028: جلسة التخطيط «تخطيط» تخطيطية فقط ولا تُعامل كدرجة تقييم إطلاقاً — تُستثنى تقديراتها
 * (وأصفارها) من المتوسطات والاتجاهات والنسب والملخصات والنتائج النهائية. `evaluated` يبيّن ما إذا
 * وُجدت أي تقديرات تقييمية فعلية (من غير التخطيط)؛ إن كانت `false` تعرض الواجهة «لم يبدأ التقييم بعد»
 * بدل 0٪. التقرير السنوي النهائي يستخدم جلسة «نهائي» فقط أصلاً، فيبقى صحيحاً.
 */
export function cycleProgress(
  sessions: { sessionType?: string; sessionDate: string | null; createdAt: Date; ratings: RatingEntry[] }[],
): { entries: RatingEntry[]; result: number; coverage: number; evaluated: boolean } {
  const scored = sessions.filter((s) => s.sessionType !== PLANNING_SESSION_TYPE);
  const latest = new Map<string, { rating: number; weight: number }>();
  const ordered = [...scored].sort((a, b) => {
    const da = a.sessionDate ?? "";
    const dbb = b.sessionDate ?? "";
    if (da !== dbb) return da.localeCompare(dbb);
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  for (const s of ordered) {
    for (const r of s.ratings) {
      if (r.rating !== null && r.rating >= 1 && r.rating <= 5) {
        latest.set(r.indicatorId, { rating: r.rating, weight: r.weight });
      }
    }
  }
  const entries: RatingEntry[] = [...latest.entries()].map(([indicatorId, v]) => ({
    indicatorId,
    weight: v.weight,
    rating: v.rating,
  }));
  const { result } = sessionResult(entries);
  const allIndicators = new Set<string>();
  for (const s of scored) for (const r of s.ratings) allIndicators.add(r.indicatorId);
  const coverage = allIndicators.size === 0 ? 0 : Math.round((latest.size / allIndicators.size) * 100) / 100;
  return { entries, result, coverage, evaluated: latest.size > 0 };
}

/** التقدير 1..5 فقط */
export function validRating(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

/** التقديرات الضعيفة (≤2) تقترح خطة تحسين دون فرضها */
export function weakIndicators(entries: RatingEntry[]): string[] {
  return entries.filter((e) => e.rating !== null && e.rating <= 2).map((e) => e.indicatorId);
}

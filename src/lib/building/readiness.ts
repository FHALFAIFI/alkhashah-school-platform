/**
 * حساب جاهزية الغرفة من نتائج الفحص وحالة الأصول المطلوبة والبلاغات المفتوحة.
 * التجاوز اليدوي ممكن فقط بسبب مسجل إلزامي.
 */
export function computeRoomReadiness(opts: {
  latestInspection: { results: { key: string; ok: boolean }[] } | null;
  assets: { condition: string; important: boolean }[];
  openIssues: number;
  override?: { value: number } | null;
}): { readiness: number; source: "تجاوز يدوي" | "محسوبة"; parts: Record<string, number> } {
  if (opts.override) {
    return { readiness: opts.override.value, source: "تجاوز يدوي", parts: {} };
  }
  // الفحص: نسبة البنود السليمة (وزن 50)
  let inspectionScore = 100;
  if (opts.latestInspection && opts.latestInspection.results.length > 0) {
    const ok = opts.latestInspection.results.filter((r) => r.ok).length;
    inspectionScore = Math.round((ok / opts.latestInspection.results.length) * 100);
  } else if (!opts.latestInspection) {
    inspectionScore = 50; // لا فحص بعد — جاهزية جزئية
  }
  // الأصول: نسبة الأصول بحالة سليمة (وزن 30)
  let assetScore = 100;
  if (opts.assets.length > 0) {
    const good = opts.assets.filter((a) => a.condition === "ممتازة" || a.condition === "جيدة").length;
    assetScore = Math.round((good / opts.assets.length) * 100);
  }
  // البلاغات المفتوحة: خصم 15 لكل بلاغ حتى 60 (وزن 20)
  const issueScore = Math.max(0, 100 - opts.openIssues * 25);

  const readiness = Math.round(inspectionScore * 0.5 + assetScore * 0.3 + issueScore * 0.2);
  return {
    readiness,
    source: "محسوبة",
    parts: { الفحص: inspectionScore, الأصول: assetScore, البلاغات: issueScore },
  };
}

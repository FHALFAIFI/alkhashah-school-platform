/**
 * حساب تقدم البرنامج من المعالم الموزونة — وليس من عدد المرفقات (قاعدة إلزامية).
 * progress = Σ (وزن المعلم × نسبة إنجازه ÷ 100)
 */
export function computeProgramProgress(
  milestones: { weight: number; progress: number }[],
): number {
  if (milestones.length === 0) return 0;
  const totalWeight = milestones.reduce((s, m) => s + m.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = milestones.reduce((s, m) => s + m.weight * Math.max(0, Math.min(100, m.progress)), 0);
  return Math.round(weighted / totalWeight);
}

/** جاهزية حزمة الشواهد: الحد الأدنى شاهد تنفيذ + شاهد مخرج + شاهد أثر (+ خارجي عند الانطباق) */
export function computePackageReadiness(opts: {
  requiresExternal: boolean;
  evidenceRoles: string[]; // أدوار الشواهد المقبولة المرتبطة
}): { readiness: number; missing: string[] } {
  const required = ["تنفيذ", "مخرج", "أثر", ...(opts.requiresExternal ? ["خارجي"] : [])];
  const have = new Set(opts.evidenceRoles);
  const missing = required.filter((r) => !have.has(r));
  const readiness = Math.round(((required.length - missing.length) / required.length) * 100);
  return { readiness, missing };
}

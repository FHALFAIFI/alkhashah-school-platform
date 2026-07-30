/**
 * جاهزية الغرفة (v2.3 §16) — حساب شفاف بالكامل: الواجهة تعرض لماذا الغرفة جاهزة
 * أو غير جاهزة بنداً بنداً، لا مزيجاً موزوناً مبهماً.
 *
 * القواعد المحسومة:
 *  - لا فحص بعد ← «لم يبدأ» بلا نسبة مُختلقة (لا 50٪ وهمية).
 *  - بند حرج فاشل ← «غير جاهز» مهما كانت النسبة — لا يمكن اعتبار الغرفة جاهزة.
 *  - بنود غير حرجة فاشلة فقط ← «يحتاج معالجة» مع نسبة البنود السليمة.
 *  - كل البنود سليمة ← «جاهز» (100٪).
 *  - التجاوز اليدوي يتصدّر بقيمته وسببه وفاعله — ويبقى مسجَّلاً في سجل إلحاقي.
 *
 * وحدة نقية بلا قاعدة بيانات — تُختبر وحدوياً بالكامل.
 */

export type ReadinessCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** فشل هذا البند يمنع الجاهزية */
  critical: boolean;
  severity: string;
  note?: string;
};

export type RoomReadiness = {
  /** لم يبدأ | جاهز | يحتاج معالجة | غير جاهز | تجاوز يدوي */
  statusAr: "لم يبدأ" | "جاهز" | "يحتاج معالجة" | "غير جاهز" | "تجاوز يدوي";
  /** نسبة البنود السليمة من آخر فحص — null قبل أول فحص */
  percent: number | null;
  /** null قبل أول فحص */
  ready: boolean | null;
  /** كل بنود آخر فحص مع نتيجتها — أساس «لماذا؟» في الواجهة */
  checks: ReadinessCheck[];
  /** البنود الحرجة الفاشلة — سبب «غير جاهز» */
  failedCritical: ReadinessCheck[];
  /** البنود غير الحرجة الفاشلة — سبب «يحتاج معالجة» */
  failedOther: ReadinessCheck[];
  override: { value: number; reason: string; actorName?: string | null; at?: Date | null } | null;
};

type SnapshotItem = {
  key: string;
  label: string;
  severityOnFail?: string;
};

/** استخراج بنود لقطة القالب المجمَّدة — تدعم شكلي اللقطة (أقسام غنية أو قائمة مسطّحة) */
export function snapshotItems(snapshot: unknown): SnapshotItem[] {
  if (!Array.isArray(snapshot)) return [];
  const first = snapshot[0] as Record<string, unknown> | undefined;
  if (first && Array.isArray(first.items)) {
    // أقسام غنية: [{title, items: [{key,label,severityOnFail?}]}]
    return (snapshot as { items: SnapshotItem[] }[]).flatMap((s) => s.items);
  }
  return snapshot as SnapshotItem[];
}

export function computeRoomReadiness(opts: {
  latestInspection: {
    results: { key: string; ok: boolean; note?: string }[];
    templateSnapshot: unknown;
  } | null;
  override?: { value: number; reason: string; actorName?: string | null; at?: Date | null } | null;
}): RoomReadiness {
  if (opts.override) {
    return {
      statusAr: "تجاوز يدوي",
      percent: opts.override.value,
      ready: opts.override.value >= 100,
      checks: [],
      failedCritical: [],
      failedOther: [],
      override: opts.override,
    };
  }

  const insp = opts.latestInspection;
  if (!insp || insp.results.length === 0) {
    return {
      statusAr: "لم يبدأ",
      percent: null,
      ready: null,
      checks: [],
      failedCritical: [],
      failedOther: [],
      override: null,
    };
  }

  const items = snapshotItems(insp.templateSnapshot);
  const byKey = new Map(items.map((i) => [i.key, i]));

  const checks: ReadinessCheck[] = insp.results.map((r) => {
    const item = byKey.get(r.key);
    const severity = item?.severityOnFail ?? "متوسط";
    return {
      key: r.key,
      label: item?.label ?? r.key,
      ok: r.ok,
      critical: severity === "حرج",
      severity,
      note: r.note,
    };
  });

  const failedCritical = checks.filter((c) => !c.ok && c.critical);
  const failedOther = checks.filter((c) => !c.ok && !c.critical);
  const okCount = checks.filter((c) => c.ok).length;
  const percent = Math.round((okCount / checks.length) * 100);

  const statusAr =
    failedCritical.length > 0 ? "غير جاهز" : failedOther.length > 0 ? "يحتاج معالجة" : "جاهز";

  return {
    statusAr,
    percent,
    ready: statusAr === "جاهز",
    checks,
    failedCritical,
    failedOther,
    override: null,
  };
}

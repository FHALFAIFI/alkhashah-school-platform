/**
 * التواريخ: التخزين ميلادي ISO، والعرض مزدوج (هجري أم القرى + ميلادي).
 * النص الهجري الرسمي القادم من التقويم المعتمد يعرض حرفياً ولا يعاد حسابه.
 */

const HIJRI_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HIJRI_NUMERIC_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const GREG_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const GREG_NUMERIC_FMT = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** هجري بصيغة أم القرى، مثال: 10 ربيع الأول 1448هـ */
export function toHijriLong(date: Date): string {
  return HIJRI_FMT.format(date).replace(" هـ", "هـ");
}

/** هجري رقمي، مثال: 1448/3/10 */
export function toHijriNumeric(date: Date): string {
  const parts = HIJRI_NUMERIC_FMT.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")}`;
}

export function toGregorianLong(date: Date): string {
  return GREG_FMT.format(date);
}

export function toGregorianNumeric(date: Date): string {
  const parts = GREG_NUMERIC_FMT.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")}`;
}

export type DualDate = { primary: string; secondary: string };

/**
 * عرض مزدوج حسب السياق:
 * سياق المعلم: هجري أولاً ثم ميلادي. سياق الموظف: ميلادي أولاً ثم هجري.
 * officialHijri: النص الهجري الرسمي إن وجد — يعرض حرفياً.
 */
export function dualDisplay(
  iso: string | Date,
  context: "teacher" | "employee",
  officialHijri?: string | null,
): DualDate | null {
  const date = typeof iso === "string" ? parseIsoDate(iso) : iso;
  if (!date) {
    if (officialHijri) return { primary: `${officialHijri}هـ`, secondary: "" };
    return null;
  }
  const hijri = officialHijri ? `${officialHijri}هـ` : `${toHijriNumeric(date)}هـ`;
  const greg = `${toGregorianNumeric(date)}م`;
  return context === "teacher"
    ? { primary: hijri, secondary: greg }
    : { primary: greg, secondary: hijri };
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** هل التاريخ يقع ضمن حدث إجازة في لقطة تقويم؟ يعيد أسماء الإجازات المتقاطعة (تنبيه، لا منع) */
export function holidayWarnings(
  iso: string,
  events: { nameAr: string; gregFrom: string | null; gregTo: string | null; isHoliday: boolean }[],
): string[] {
  const warnings: string[] = [];
  for (const ev of events) {
    if (!ev.isHoliday || !ev.gregFrom) continue;
    const from = ev.gregFrom;
    const to = ev.gregTo ?? ev.gregFrom;
    if (iso >= from && iso <= to) warnings.push(ev.nameAr);
  }
  return warnings;
}

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

/** تحويل نص هجري رسمي «1448/3/10» إلى ISO — يعيد null لأي نص لا يُفسَّر */
export function hijriTextToIso(text: string | null): string | null {
  if (!text) return null;
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  return hijriToIso({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* الاتجاه العكسي: هجري (أم القرى) ← ميلادي — بلا مكتبات خارجية.        */
/* التحويل بالمَعايرة على Intl نفسها فلا يوجد جدولان قد يختلفان.        */
/* ------------------------------------------------------------------ */

/** أسماء الأشهر الهجرية بترتيب أم القرى (1..12) */
export const HIJRI_MONTHS = [
  "محرم",
  "صفر",
  "ربيع الأول",
  "ربيع الآخر",
  "جمادى الأولى",
  "جمادى الآخرة",
  "رجب",
  "شعبان",
  "رمضان",
  "شوال",
  "ذو القعدة",
  "ذو الحجة",
] as const;

/** أسماء الأشهر الميلادية بالعربية (1..12) */
export const GREGORIAN_MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;

export type HijriParts = { year: number; month: number; day: number };

/** أجزاء التاريخ الهجري (أم القرى) لتاريخ ميلادي */
export function hijriPartsOf(date: Date): HijriParts {
  const parts = HIJRI_NUMERIC_FMT.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

const DAY_MS = 86_400_000;

/**
 * تحويل تاريخ هجري (أم القرى) إلى ميلادي.
 * تقدير حسابي أولي ثم مطابقة دقيقة على Intl ضمن نافذة أيام —
 * إن لم يوجد يوم مطابق فالتاريخ غير صحيح (مثل 30 في شهر ذي 29 يوماً).
 */
export function hijriToDate(h: HijriParts): Date | null {
  if (!Number.isInteger(h.year) || !Number.isInteger(h.month) || !Number.isInteger(h.day)) return null;
  if (h.month < 1 || h.month > 12 || h.day < 1 || h.day > 30) return null;
  if (h.year < 1300 || h.year > 1600) return null;
  // تقدير: بداية التقويم الهجري ≈ 622-07-19م، وطول السنة ≈ 354.367 يوماً
  const approxDays = (h.year - 1) * 354.36707 + (h.month - 1) * 29.53 + (h.day - 1);
  const epoch = Date.UTC(622, 6, 19, 12);
  const guess = new Date(epoch + Math.round(approxDays) * DAY_MS);
  for (let offset = -8; offset <= 8; offset++) {
    const candidate = new Date(guess.getTime() + offset * DAY_MS);
    const p = hijriPartsOf(candidate);
    if (p.year === h.year && p.month === h.month && p.day === h.day) {
      // تثبيت على منتصف اليوم UTC كي لا ينزلق اليوم مع فروق التوقيت
      return new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), 12));
    }
  }
  return null;
}

/** تحويل هجري إلى ISO ميلادي (YYYY-MM-DD) أو null إن كان التاريخ غير صحيح */
export function hijriToIso(h: HijriParts): string | null {
  const d = hijriToDate(h);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** عدد أيام الشهر الهجري (29 أو 30) حسب أم القرى */
export function hijriMonthLength(year: number, month: number): number {
  return hijriToDate({ year, month, day: 30 }) ? 30 : 29;
}

/** هل التاريخ الهجري صحيح في تقويم أم القرى؟ */
export function isValidHijriDate(h: HijriParts): boolean {
  return hijriToDate(h) !== null;
}

/** هل نص ISO تاريخاً ميلادياً صحيحاً فعلاً (يرفض 2026-02-30 ونحوه)؟ */
export function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
  );
}

/**
 * الصيغة الرقمية المزدوجة المدمجة لخلايا الجداول والتصدير:
 * «2026/8/23م (1448/3/10هـ)» — ميلادي أولاً (سياق إداري) والهجري بين قوسين.
 * تقبل ISO أو Date؛ وأي قيمة غير تاريخية تُعاد كما هي (لا كسر للخلية).
 */
export function dualNumericCell(value: string | Date): string {
  const date = value instanceof Date ? value : parseIsoDate(value);
  if (!date || Number.isNaN(date.getTime())) return typeof value === "string" ? value : "—";
  return `${toGregorianNumeric(date)}م (${toHijriNumeric(date)}هـ)`;
}

/**
 * السطر المزدوج الكامل للتواريخ المهمة:
 * «15 أغسطس 2026م — 2 ربيع الأول 1448هـ»
 */
export function fullDualLine(iso: string | Date): string | null {
  const date = typeof iso === "string" ? parseIsoDate(iso) : iso;
  if (!date) return null;
  const g = `${date.getUTCDate()} ${GREGORIAN_MONTHS_AR[date.getUTCMonth()]} ${date.getUTCFullYear()}م`;
  const h = hijriPartsOf(date);
  return `${g} — ${h.day} ${HIJRI_MONTHS[h.month - 1]} ${h.year}هـ`;
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

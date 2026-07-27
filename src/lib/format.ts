/**
 * Null-safe display helpers for the global optional-field rule (principal v2.1 corrections, §H).
 *
 * With every user-facing business field now optional, any label/number may be empty or null.
 * These helpers keep the Arabic UI, reports and exports free of raw `null` / `undefined` / `NaN`
 * and provide a safe Arabic fallback for display labels — without fabricating business data.
 */

/** Arabic fallback for an empty display label. */
export const NO_TITLE = "بدون عنوان";

/**
 * Return a trimmed non-empty string, or an Arabic fallback («بدون عنوان» by default).
 * Use for display labels/titles that must render something rather than a blank.
 */
export function orFallback(value: string | null | undefined, fallback: string = NO_TITLE): string {
  const s = (value ?? "").trim();
  return s.length > 0 ? s : fallback;
}

/** Return a trimmed non-empty string, or an em dash «—» for neutral "no value" cells. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const s = String(value).trim();
  return s.length > 0 ? s : "—";
}

/**
 * Format a possibly-empty amount for display. Empty/null/invalid → neutral «—» (never NaN/0).
 * A real numeric value is localized (default Arabic-SA grouping).
 */
export function formatMoney(
  value: string | number | null | undefined,
  locale: string = "ar-SA",
): string {
  const n = numOrNull(value);
  if (n === null) return "—";
  return n.toLocaleString(locale);
}

/**
 * Coerce a possibly-empty user value to a finite number or `null` (never NaN).
 * Empty string / null / undefined / non-numeric → null, so callers can branch on "no value"
 * instead of silently treating it as zero.
 */
export function numOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

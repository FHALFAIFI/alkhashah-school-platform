/**
 * يتحقق أن قيمة returnTo مسار داخلي آمن يشير إلى دفعة استيراد محددة فقط.
 * يمنع التوجيه المفتوح (open redirect): يرفض المسارات الخارجية، والبروتوكول النسبي (//host)،
 * وأي شيء لا يطابق مسار دفعة استيراد `/imports/<uuid>` بالضبط.
 * يعيد المسار الآمن أو null.
 */
export function safeImportsReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return /^\/imports\/[0-9a-f-]{36}$/.test(raw) ? raw : null;
}

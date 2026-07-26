/**
 * حارس أمان يفشل مغلقاً (fail-closed): يرفض تشغيل أي اختبار إن بدا أنه يستهدف الإنتاج.
 * يفحص القيم الفعلية (رابط القاعدة واسمها والمنفذ ومسار التخزين ورابط التطبيق) لا مجرد تسمية
 * متغيرات البيئة. أي مطابقة لمؤشّر إنتاج تُلقي خطأً قبل أي اتصال أو كتابة.
 *
 * مؤشّرات الإنتاج المرفوضة صراحةً:
 *   - مشروع Compose «madrasa-prod» وحاوية «madrasa-prod-db-1»
 *   - قاعدة الإنتاج «madrasa» (تُرفض أي قاعدة لا ينتهي اسمها بـ _test)
 *   - عنوان التطبيق الإنتاجي 192.168.0.48:3080
 *   - المنفذ الداخلي 5432 لحاوية الإنتاج (قاعدة التطوير/الاختبار على 5544)
 */

const PROD_MARKERS = ["madrasa-prod", "madrasa-prod-db-1", "192.168.0.48"];

export function assertNonProduction(context: string, databaseUrl?: string): void {
  const dbUrl = databaseUrl ?? process.env.DATABASE_URL ?? "";
  const ambientDb = process.env.DATABASE_URL ?? "";
  const storageDir = process.env.STORAGE_DIR ?? "";
  const appUrl = process.env.APP_URL ?? "";

  const scan: [string, string][] = [
    ["DATABASE_URL", dbUrl],
    ["DATABASE_URL(env)", ambientDb],
    ["STORAGE_DIR", storageDir],
    ["APP_URL", appUrl],
  ];
  for (const [label, value] of scan) {
    if (!value) continue;
    for (const marker of PROD_MARKERS) {
      if (value.includes(marker)) {
        throw new Error(`SAFETY (${context}): «${label}» يحوي مؤشّر إنتاج «${marker}» — رُفض تشغيل الاختبار على الإنتاج.`);
      }
    }
  }

  for (const [label, value] of [["DATABASE_URL", dbUrl], ["DATABASE_URL(env)", ambientDb]] as [string, string][]) {
    if (!value) continue;
    const name = value.split("/").pop()?.split("?")[0] ?? "";
    if (!name.endsWith("_test")) {
      throw new Error(`SAFETY (${context}): اسم القاعدة «${name || "غير محدد"}» في ${label} لا ينتهي بـ _test — رُفض التشغيل (قاعدة الإنتاج «madrasa»).`);
    }
    if (/@[^/]*:5432\b/.test(value)) {
      throw new Error(`SAFETY (${context}): ${label} يستخدم المنفذ 5432 (منفذ حاوية الإنتاج الداخلي) — استخدم منفذ التطوير/الاختبار 5544.`);
    }
  }
}

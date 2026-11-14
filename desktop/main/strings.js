// @ts-check
"use strict";
/** Arabic user-facing text of the desktop shell (the application UI itself is unchanged). */

const APP_TITLE = "منصة الإدارة المدرسية — مجمع الخشعة التعليمي للبنين";

/** @type {Record<string, string>} */
const STEPS = {
  lock: "جارٍ التحضير…",
  cleanup: "جارٍ التحقق من سلامة الإغلاق السابق…",
  initdb: "تهيئة قاعدة البيانات لأول مرة — قد يستغرق ذلك دقيقة…",
  postgres: "تشغيل قاعدة البيانات…",
  database: "إنشاء قاعدة بيانات المنصة…",
  preUpgradeBackup: "إنشاء نسخة احتياطية قبل تحديث الإصدار…",
  migrate: "تحديث بنية قاعدة البيانات…",
  seed: "إعداد البيانات المرجعية الأولية…",
  server: "تشغيل المنصة…",
  stopServer: "جارٍ إنهاء العمليات الجارية بأمان…",
  autoBackup: "إنشاء النسخة الاحتياطية اليومية التلقائية…",
  stopPostgres: "إيقاف قاعدة البيانات بأمان…",
  backup: "جارٍ إنشاء نسخة احتياطية والتحقق منها…",
  restoreVerify: "جارٍ التحقق من سلامة النسخة الاحتياطية…",
  restore: "جارٍ استعادة النسخة الاحتياطية — لا تُغلق الجهاز…",
  restart: "إعادة تشغيل المنصة…",
};

const draining = (/** @type {number} */ n) => `بانتظار اكتمال توليد ${n === 1 ? "تقرير واحد" : `${n} تقارير`} قبل الإغلاق…`;

/**
 * Maps internal errors to a message the principal can act on.
 * @param {any} e
 */
function errorMessage(e) {
  const code = e?.code;
  const msg = String(e?.message ?? e);
  if (code === "ALREADY_RUNNING") return "المنصة تعمل بالفعل على هذا الجهاز.";
  if (code === "ENOSPC" || /no space left/i.test(msg)) return "مساحة القرص غير كافية. أفرغ بعض المساحة ثم أعد المحاولة.";
  if (code === "BAD_KEY_OR_CORRUPT") return "مفتاح الاستعادة غير صحيح، أو أن ملف النسخة الاحتياطية تالف.";
  if (code === "CHECKSUM_MISMATCH" || code === "MEMBER_CORRUPT" || code === "MEMBER_MISSING") return "ملف النسخة الاحتياطية تالف أو غير مكتمل — لم يُغيَّر أي شيء في بياناتك الحالية.";
  if (code === "EACCES" || code === "EPERM") return "تعذّر الوصول إلى مجلد بيانات المنصة (صلاحيات). أعد تشغيل الجهاز ثم حاول مجدداً.";
  if (/did not become ready|health-timeout/.test(msg)) return "تأخر تشغيل المنصة أكثر من المتوقع.";
  return "حدث خطأ غير متوقع أثناء التشغيل.";
}

module.exports = { APP_TITLE, STEPS, draining, errorMessage };

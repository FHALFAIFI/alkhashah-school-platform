/**
 * حارس أمان قاعدة البيانات — fail-closed.
 *
 * الغرض: منع أي تشغيل آلي (Vitest / Playwright / سكربتات) من الكتابة في قاعدة
 * التطوير أو الإنتاج الحقيقية. الاختبارات هي التي سرّبت سابقاً سجلات «تجريبي آلي»
 * إلى قاعدة التطوير لأنها كانت تشغّل خادم `next dev` على نفس القاعدة الحقيقية.
 *
 * القاعدة (فاشلة نحو الإغلاق): عندما تكون البيئة بيئة اختبار (MADRASA_ENV=test)
 * يجب أن يشير DATABASE_URL إلى قاعدة اختبار معزولة (اسمها ينتهي بـ test)، وإلا
 * يُرمى خطأ فوري قبل فتح أي اتصال. الغموض = رفض، لا تمرير.
 */

/** يستخرج اسم قاعدة البيانات من رابط الاتصال؛ يرمي عند التعذر (fail-closed). */
export function databaseNameFromUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("حارس الأمان: DATABASE_URL غير محدد — لا يمكن التحقق من عزل قاعدة الاختبار.");
  }
  let name: string;
  try {
    // يدعم postgres:// و postgresql://
    const u = new URL(url);
    name = decodeURIComponent(u.pathname.replace(/^\//, "")).trim();
  } catch {
    throw new Error(`حارس الأمان: تعذّر تحليل DATABASE_URL — رفض التشغيل.`);
  }
  if (!name) {
    throw new Error("حارس الأمان: رابط قاعدة البيانات بلا اسم قاعدة — رفض التشغيل.");
  }
  return name;
}

/** true إذا كان الاسم قاعدة اختبار معزولة (ينتهي بـ `test` أو مقطع `_test`). */
export function isIsolatedTestDatabaseName(name: string): boolean {
  return /(^|[_-])test$/i.test(name) || name === "test";
}

/**
 * يؤكد أن الرابط يشير إلى قاعدة اختبار معزولة، وإلا يرمي. يُستدعى من مهيّئ الاختبارات
 * ومن طبقة الاتصال عندما MADRASA_ENV=test.
 */
export function assertTestDatabase(url: string | undefined = process.env.DATABASE_URL): string {
  const name = databaseNameFromUrl(url);
  if (!isIsolatedTestDatabaseName(name)) {
    throw new Error(
      `حارس الأمان (fail-closed): بيئة الاختبار تحاول الاتصال بقاعدة «${name}» وهي ليست قاعدة اختبار معزولة. ` +
        `الاختبارات تُشغَّل فقط على قاعدة اسمها ينتهي بـ «_test» (مثل madrasa_test). ` +
        `عيّن DATABASE_URL إلى قاعدة الاختبار أو ألغِ MADRASA_ENV=test. تم رفض التشغيل حمايةً للبيانات الحقيقية.`,
    );
  }
  return name;
}

/**
 * حارس طبقة الاتصال — يُستدعى عند إنشاء المجمع. لا يفعل شيئاً في التطوير/الإنتاج
 * (MADRASA_ENV غير «test»)، ويُطبّق العزل الصارم في بيئة الاختبار.
 */
export function assertConnectionSafety(url: string | undefined): void {
  if (process.env.MADRASA_ENV === "test") {
    assertTestDatabase(url);
  }
}

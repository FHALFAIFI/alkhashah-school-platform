/**
 * هوية الإصدار المنشور (v2.6.0).
 *
 * غرضها التشغيلي: حين يقول المدير «التغييرات لا تظهر» يجب أن يُقرأ رقم الإصدار من داخل
 * التطبيق في ثانية واحدة، بدل استنتاجه من بصمة الصورة أو سجل الهجرات. غياب هذا العلامة
 * كان أحد أسباب طول تشخيص v2.4.0.
 *
 * **مصدر واحد للرقم**: الثابت أدناه، ويتحقق اختبار وحدة من مطابقته لـ `package.json`
 * فلا ينحرف الرقمان. الالتزام والبيئة يأتيان من متغيرات البناء/التشغيل.
 *
 * لا يُكشف هنا أي سر ولا مسار ملفات ولا بيانات اتصال — الرقم والالتزام القصير والبيئة فقط.
 */

/** رقم الإصدار — يطابق `package.json` (يفرضه `tests/unit/release.test.ts`) */
export const RELEASE_VERSION = "2.6.0";

/** الالتزام القصير — يُحقن وقت البناء؛ «unknown» في التطوير */
export const RELEASE_COMMIT = process.env.RELEASE_COMMIT ?? "unknown";

export type ReleaseIdentity = {
  version: string;
  commit: string;
  environment: string;
};

/** بيئة التشغيل المعلنة — production / development / test */
export function releaseEnvironment(): string {
  return process.env.MADRASA_ENV ?? process.env.NODE_ENV ?? "unknown";
}

/** هوية الإصدار الكاملة — تُعرض في التشخيص وتُعاد من فحص الصحة */
export function releaseIdentity(): ReleaseIdentity {
  return {
    version: RELEASE_VERSION,
    commit: RELEASE_COMMIT,
    environment: releaseEnvironment(),
  };
}

/** النص العربي المعروض للمستخدم في تذييل الصفحة */
export function releaseLabel(): string {
  return `الإصدار ${RELEASE_VERSION}`;
}

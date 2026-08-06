/**
 * التحقق من مبلغ العملية المالية — **مصدر واحد** يستعمله كل مسار يكتب مبلغاً.
 *
 * ── لماذا وحدة مستقلة ───────────────────────────────────────────────────────
 * كان كل إجراء مالي يعرّف مخطّطه بنفسه، فاختلفت القواعد بينها بصمت: الإيراد والمصروف
 * يقبلان الفراغ ويخزّنانه `NULL`، والمخصص يقبل الصفر. النتيجة سجل مالي فيه حركات بلا
 * مبالغ لا تدخل أي مجموع ولا تظهر كنقص صريح. التعريف هنا مرة واحدة، ويستورده الخادم
 * والاختبارات معاً، فلا يمكن أن ينحرف مسار عن آخر.
 *
 * ── لماذا لا يكفي `required` في HTML ────────────────────────────────────────
 * `required` تلميح واجهة يمنع الخطأ العابر ولا شيء غيره: طلب مُلفَّق إلى Server Action —
 * أو `FormData` مبنيّ يدوياً — لا يمرّ بالمتصفّح إطلاقاً. لذلك يقع الرفض هنا، على الخادم،
 * والواجهة تضيف `required` للراحة لا للحماية.
 *
 * ── دقة الهللة ──────────────────────────────────────────────────────────────
 * وحدة المال في المنصة هي الهللة الصحيحة (`toMinor`/`fromMinor` في `calc.ts`). مبلغ بدقة
 * أعلى (3.456 ريال) لا يمكن تمثيله، وكان يُقرَّب صامتاً عند أول عملية فيختلف المجموع عن
 * المُدخل. يُرفض هنا صراحةً بدل أن يُقرَّب بلا علم المستخدم.
 */

import { z } from "zod";
import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE } from "./calc";

/** الرسالة الموحّدة لغياب المبلغ أو كونه غير موجب — تظهر كما هي في كل نموذج مالي */
export const REQUIRED_AMOUNT_MESSAGE = "مبلغ العملية مطلوب ويجب أن يكون أكبر من صفر";

/** تجاوز دقة الهللة */
export const AMOUNT_PRECISION_MESSAGE = "المبلغ يقبل هللتين على الأكثر (منزلتان عشريتان)";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * تحويل المُدخل الخام إلى عدد — أو إلى قيمة تفشل في التحقق.
 *
 * الفراغ والمسافات و`null` و`undefined` تعود `undefined` فيلتقطها المخطّط برسالة «مطلوب».
 * النص غير العددي يعود كما هو فيفشل بفحص النوع بالرسالة نفسها. لا يُحوَّل شيء إلى صفر:
 * `Number("")` يساوي صفراً، وهو بالضبط الطريق الذي جعل الحقل الفارغ يبدو مبلغاً صالحاً.
 */
function toAmountInput(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  // الأرقام العربية-الهندية تُقبل كما تُكتب في الواجهة العربية
  const western = trimmed.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  // فاصلة عشرية عربية
  const normalized = western.replace(/٫/g, ".");
  /*
   * الصيغة الأسية (`1e30`) مقبولة هنا عمداً رغم أنها لا تُكتب في نموذج.
   * الطلب المُلفَّق يرسلها، وحصرها بفحص الصيغة كان يجعلها تُرفض برسالة «مطلوب» بدل رسالة
   * تجاوز السقف: الرفض واحد لكن السبب المُبلَّغ خاطئ. قبولها هنا يُمرّرها إلى فحص السقف
   * فيُبلَّغ عن الحد الحقيقي الذي كُسر.
   */
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(normalized)) return value;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : value;
}

/** هل المبلغ ممثَّل تماماً بالهللات الصحيحة؟ */
export function isHalalaPrecise(amount: number): boolean {
  const minor = amount * 100;
  return Math.abs(minor - Math.round(minor)) < 1e-9;
}

/**
 * مبلغ عملية مالية **إلزامي**: عدد موجب تماماً، بدقة الهللة، ودون السقف الأعلى.
 *
 * يرفض: الفراغ، المسافات، `null`، `undefined`، النص غير العددي، السالب، الصفر،
 * الدقة الأدق من الهللة، وما يتجاوز `MAX_MONEY_AMOUNT`.
 */
export const requiredPositiveAmount = z.preprocess(
  toAmountInput,
  z
    .number({ error: REQUIRED_AMOUNT_MESSAGE })
    .refine((n) => Number.isFinite(n), REQUIRED_AMOUNT_MESSAGE)
    .refine((n) => n > 0, REQUIRED_AMOUNT_MESSAGE)
    .refine((n) => n <= MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE)
    .refine(isHalalaPrecise, AMOUNT_PRECISION_MESSAGE),
);

/**
 * مبلغ **اختياري** بالقواعد نفسها حين يُذكر: الغياب مسموح ويعني «لم يُحدَّد بعد»، لكن
 * القيمة المذكورة تخضع لكل ما سبق. يستعمله بند الصرف الذي قد يُنشأ قبل اعتماد مخصصه —
 * وهي حالة تُبلَّغ عنها صراحةً في تقرير «بنود بلا مخصص» لا حالة خطأ صامتة.
 */
export const optionalPositiveAmountStrict = z.preprocess(
  toAmountInput,
  z
    .number({ error: REQUIRED_AMOUNT_MESSAGE })
    .refine((n) => Number.isFinite(n), REQUIRED_AMOUNT_MESSAGE)
    .refine((n) => n > 0, REQUIRED_AMOUNT_MESSAGE)
    .refine((n) => n <= MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE)
    .refine(isHalalaPrecise, AMOUNT_PRECISION_MESSAGE)
    .optional(),
);

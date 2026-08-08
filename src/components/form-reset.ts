"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * تفريغ حقول النموذج بعد نجاح إجراء الخادم — بلا `key` يعيد تركيب النموذج (v2.4.1 §F).
 *
 * ── السبب الجذري الذي تعالجه هذه الوحدة ─────────────────────────────────────
 * كانت النماذج تُكتب هكذا: `<form key={state?.success} action={formAction}>`، فيبدو أن
 * تغيّر المفتاح مجرد وسيلة لتفريغ الحقول. لكن استجابة إجراء الخادم في Next 16 **تدفّق**:
 * تحمل القيمة المُعادة ثم حمولة إعادة التصيير الناتجة عن `revalidatePath`. حين تصل القيمة
 * المُعادة يتغيّر `state.success` فيتغيّر المفتاح، فتُفكَّك عقدة `<form>` المالكة للطلب،
 * فيُلغي المتصفح الطلب (`net::ERR_ABORTED`) قبل استهلاك بقية التدفّق. النتيجة على بناء
 * الإنتاج: **الكتابة تنجح في القاعدة، ولا تظهر رسالة النجاح، ولا تتحدّث الصفحة**.
 *
 * هذا بالضبط عرَض «الواجهة لا تتحدث بعد الحفظ» المسجَّل منذ التصحيح v2.2.1، وما وُصف في
 * v2.3 بأنه «خصوصية بيئة تُجهض تدفّق إجراءات الخادم» — وليس خصوصية بيئة: يتكرّر داخل صورة
 * الإنتاج نفسها على نسخة من بيانات الإنتاج. على خادم التطوير كان يمر لأن التدفّق يكتمل
 * أسرع من إعادة التركيب، فبقي الخلل غير مرئي للاختبارات.
 *
 * البديل هنا: النموذج يبقى مركَّباً (لا `key` متغيّر)، وتُفرَّغ حقوله بنداء `reset()` بعد
 * اكتمال التدفّق. تُتعقَّب **هوية كائن الحالة** لا نص الرسالة، فحفظان متتاليان برسالة
 * واحدة يفرغان الحقول في المرتين.
 */
export function useResetOnSuccess<T extends { success?: string } | null>(state: T) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const seen = useRef<unknown>(null);
  useEffect(() => {
    if (state?.success && state !== seen.current) {
      seen.current = state;
      formRef.current?.reset();
    }
  }, [state]);
  return formRef;
}

/**
 * تحديث الصفحة الحالية بعد نجاح إجراء الخادم (D-049 ثم D-053).
 *
 * الإجراءات لم تعد تُبطل أي مسار (انظر `lib/revalidate.ts`)، فالتحديث مسؤولية العميل:
 * طلب واحد يبدأ **بعد** استقرار نتيجة الإجراء، فلا يزاحم تدفّقها.
 *
 * «النجاح» يُقرأ من `success` النصية أو من علم `ok` — بعض الإجراءات القديمة تعيد الثانية
 * (ملاحظات التشغيل مثلاً). ما يُتعقَّب هو **هوية كائن الحالة** لا نص الرسالة، فنجاحان
 * متتاليان بالرسالة نفسها يحدّثان الصفحة في المرتين.
 */
type RefreshableState = { success?: string; ok?: boolean } | null | undefined;

export function useRefreshOnSuccess(state: RefreshableState) {
  const router = useRouter();
  const seen = useRef<unknown>(null);
  useEffect(() => {
    const succeeded = Boolean(state?.success) || state?.ok === true;
    if (succeeded && state !== seen.current) {
      seen.current = state;
      router.refresh();
    }
  }, [state, router]);
}

/**
 * تحديث الصفحة بعد **اكتمال** انتقال يحمل إجراء خادم (D-049 القاعدة 3 · D-053).
 *
 * الأزرار التي تنادي إجراءً داخل `useTransition` لا تملك حالة مُعادة يتعقّبها
 * `useRefreshOnSuccess`، وقد كانت تعتمد على `revalidatePath` داخل الإجراء — وهو ما أُزيل.
 * التحديث هنا يبدأ حين ينخفض `pending` من true إلى false، أي **بعد** أن استهلك العميل
 * استجابة الإجراء كاملة؛ استدعاؤه داخل الانتقال يُبقي `pending` مرفوعاً فتظل الأزرار
 * معطّلة (هذا بالضبط ما شُوهد على قوائم حالات مهام اللجان).
 */
export function useRefreshAfterTransition(pending: boolean, opts?: { skip?: boolean }) {
  const router = useRouter();
  const wasPending = useRef(false);
  const skip = opts?.skip ?? false;
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      // `skip`: انتهى الانتقال إلى رسالة نهائية يملكها العميل (انتهاء جلسة مثلاً). التحديث
      // حينها يُعيد جلب المسار فيمسح الرسالة — أو يُحوّل إلى الدخول — قبل أن يقرأها المستخدم.
      if (!skip) router.refresh();
    }
  }, [pending, skip, router]);
}

/**
 * انتقال يحمل إجراء خادم + تحديث تلقائي بعده — الشكل المفضَّل في الشيفرة الجديدة.
 * يعيد نفس ثنائية `useTransition` فيبقى موضع النداء كما هو.
 */
export function useActionTransition(): [boolean, React.TransitionStartFunction] {
  const [pending, startTransition] = useTransition();
  useRefreshAfterTransition(pending);
  return [pending, startTransition];
}

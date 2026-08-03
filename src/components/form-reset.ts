"use client";

import { useEffect, useRef } from "react";
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
 * تحديث الصفحة الحالية بعد نجاح إجراء الخادم (D-049).
 *
 * الإجراءات لم تعد تُبطل مسار الصفحة المفتوحة (انظر `lib/revalidate.ts`)، فالتحديث
 * مسؤولية العميل: طلب واحد يبدأ **بعد** استقرار نتيجة الإجراء، فلا يزاحم تدفّقها.
 */
export function useRefreshOnSuccess<T extends { success?: string } | null>(state: T) {
  const router = useRouter();
  const seen = useRef<unknown>(null);
  useEffect(() => {
    if (state?.success && state !== seen.current) {
      seen.current = state;
      router.refresh();
    }
  }, [state, router]);
}

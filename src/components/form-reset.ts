"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
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
 * تحديث مُتحقَّق منه (D-069).
 *
 * ثبت بالقياس على بناء الإنتاج (`next start`) أن التحديث الذي يلي إجراء الخادم كان يضيع
 * بانتظام: يصل رد الخادم كاملاً ولا يطبّقه الموجّه — ينجح الإجراء في القاعدة ولا تتغير
 * الشاشة (عرَض «الواجهة لا تتحدث بعد الحفظ» الملاحق للمنصة منذ v2.2.1). السبب الجذري عيب
 * في Next ‏16.2 يُسقط تحديث ما بعد الإجراء حين تحمل الشجرة حدود `loading.tsx`
 * (vercel/next.js#86151؛ عولج في 16.3 بـ#95391) — وقد أُزيل `(app)/loading.tsx` لذلك،
 * فصار التحديث يصل ويُطبَّق في كل قياس معاد.
 *
 * يبقى هذا التحقق صمام أمان محدوداً لا اعتماداً: تخطيط التطبيق يصيّر ختماً
 * (`data-render-stamp`) يتغير مع كل تصيير من الخادم؛ بعد كل `router.refresh()` يُفحص
 * الختم، فإن لم يتغير خلال المهلة أُعيدت المحاولة — حتى ثلاث محاولات ثم يُتوقف (لا تراكم
 * طلبات بلا حد). الحالة المرئية الحرِجة لا تعتمد عليه أصلاً (تُعرض من نتيجة الإجراء
 * مباشرة)؛ هو يصون مصالحة بقية الصفحة: العدادات والبوابات والقوائم.
 */
const REFRESH_VERIFY_DELAY_MS = 2000;
const REFRESH_MAX_ATTEMPTS = 3;

function readRenderStamp(): string | null {
  return document.querySelector("[data-render-stamp]")?.getAttribute("data-render-stamp") ?? null;
}

/** يبدأ تحديثاً مُتحقَّقاً منه ويعيد دالة إلغاء (تنظيف عند مغادرة الصفحة) */
function startVerifiedRefresh(router: { refresh: () => void }): () => void {
  const before = readRenderStamp();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  const attempt = () => {
    if (cancelled) return;
    attempts += 1;
    router.refresh();
    // صفحة بلا ختم (خارج تخطيط التطبيق): لا وسيلة تحقق — نداء واحد كما كان
    if (before === null) return;
    timer = setTimeout(() => {
      if (cancelled) return;
      const now = readRenderStamp();
      if (now !== null && now !== before) return; // وصل التحديث وطُبّق
      if (attempts < REFRESH_MAX_ATTEMPTS) attempt();
    }, REFRESH_VERIFY_DELAY_MS);
  };
  attempt();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

/** كخطاطيف الاستعمال أدناه — للنداء اليدوي من مراقبي المهام (مؤشر التوليد §I) */
export function useVerifiedRefresh(): () => void {
  const router = useRouter();
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancelRef.current?.();
    },
    [],
  );
  return useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = startVerifiedRefresh(router);
  }, [router]);
}

/**
 * تحديث الصفحة الحالية بعد نجاح إجراء الخادم (D-049 ثم D-053، تحقق D-069).
 *
 * الإجراءات لم تعد تُبطل أي مسار (انظر `lib/revalidate.ts`)، فالتحديث مسؤولية العميل:
 * طلب واحد يبدأ **بعد** استقرار نتيجة الإجراء، فلا يزاحم تدفّقها — ويُتحقق من وصوله
 * ويُعاد محدوداً إن ضاع (D-069).
 *
 * «النجاح» يُقرأ من `success` النصية أو من علم `ok` — بعض الإجراءات القديمة تعيد الثانية
 * (ملاحظات التشغيل مثلاً). ما يُتعقَّب هو **هوية كائن الحالة** لا نص الرسالة، فنجاحان
 * متتاليان بالرسالة نفسها يحدّثان الصفحة في المرتين.
 */
type RefreshableState = { success?: string; ok?: boolean } | null | undefined;

export function useRefreshOnSuccess(state: RefreshableState) {
  const router = useRouter();
  const seen = useRef<unknown>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cancelRef.current?.();
    },
    [],
  );
  useEffect(() => {
    const succeeded = Boolean(state?.success) || state?.ok === true;
    if (succeeded && state !== seen.current) {
      seen.current = state;
      cancelRef.current?.();
      cancelRef.current = startVerifiedRefresh(router);
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
  const cancelRef = useRef<(() => void) | null>(null);
  const skip = opts?.skip ?? false;
  useEffect(
    () => () => {
      cancelRef.current?.();
    },
    [],
  );
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      // `skip`: انتهى الانتقال إلى رسالة نهائية يملكها العميل (انتهاء جلسة مثلاً). التحديث
      // حينها يُعيد جلب المسار فيمسح الرسالة — أو يُحوّل إلى الدخول — قبل أن يقرأها المستخدم.
      if (!skip) {
        cancelRef.current?.();
        cancelRef.current = startVerifiedRefresh(router);
      }
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

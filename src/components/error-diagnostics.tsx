"use client";

import { useEffect } from "react";

/**
 * تشخيص استقرار DOM (D-029) — يصنّف أخطاء المطابقة (insertBefore/removeChild/…) إلى سببها المرجّح
 * ويسجّلها تقنياً في وحدة التحكم فقط (لا تُعرض للمستخدم إطلاقاً). يميّز بين:
 *   1) تحوّر DOM من الترجمة الآلية للمتصفح (عناصر <font> مُحقَنة / أصناف translated-*)،
 *   2) حقن مديري كلمات المرور/الإضافات بجوار الحقول،
 *   3) عدم تطابق الترطيب (hydration mismatch)،
 *   4) دورة حياة الحوارات/portals،
 *   5) الإرسال المزدوج.
 * السبب الجذري يبقى «مرجّحاً» حتى يثبت بإعادة اختبار المدير في متصفحه الفعلي.
 */
export function ErrorDiagnostics() {
  useEffect(() => {
    function signals() {
      const html = document.documentElement;
      const translateActive =
        /translated-(ltr|rtl)/.test(html.className) ||
        html.getAttribute("translate") === "yes" ||
        document.querySelector("font") != null; // Google/Edge translate يلفّ النص في <font>
      const passwordManagerInjected =
        document.querySelector(
          "[data-1p-root],[data-lastpass-icon-root],[data-lastpass-root],grammarly-desktop-integration,[id^='1password-'],[id^='lastpass-']",
        ) != null;
      const dialogOpen = document.querySelector("[role='dialog'],[aria-modal='true']") != null;
      const pendingSubmit = document.querySelector("button[aria-busy='true'],button[disabled][type='submit']") != null;
      return { translateActive, passwordManagerInjected, dialogOpen, pendingSubmit, path: location.pathname };
    }

    function classify(message: string) {
      const s = signals();
      const isInsertBefore = /insertBefore|not a child of this node|removeChild|appendChild/i.test(message);
      const isHydration = /hydrat|did not match|server rendered|server html/i.test(message);
      let category = "unknown";
      if (isHydration) category = "hydration-mismatch";
      else if (isInsertBefore && s.translateActive) category = "browser-translation-dom-mutation";
      else if (isInsertBefore && s.passwordManagerInjected) category = "password-manager/extension-injection";
      else if (isInsertBefore && s.dialogOpen) category = "dialog/portal-lifecycle";
      else if (isInsertBefore) category = "dom-reconciliation (translation/extension probable)";
      return { category, ...s, isInsertBefore, isHydration };
    }

    function onError(e: ErrorEvent) {
      const msg = String(e?.message ?? "");
      if (!/insertBefore|not a child of this node|removeChild|appendChild|hydrat|did not match/i.test(msg)) return;
      // تسجيل تقني آمن فقط — لا يُعرض للمستخدم، ولا يتضمن محتوى الصفحة أو بيانات شخصية
      console.error("[dom-stability-diagnostic]", JSON.stringify({ ...classify(msg), message: msg.slice(0, 300) }));
    }

    window.addEventListener("error", onError);

    // كشف استباقي: إن كانت الترجمة الآلية مفعّلة الآن، سجّلها (هذا هو السبب المرجّح الأول)
    const s = signals();
    if (s.translateActive) {
      console.warn("[dom-stability-diagnostic]", JSON.stringify({ category: "browser-translation-active", ...s }));
    }
    return () => window.removeEventListener("error", onError);
  }, []);

  return null;
}

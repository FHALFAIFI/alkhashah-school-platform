"use server";

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { saveUploadedFile, validateUpload } from "@/lib/storage";
import { appVersion } from "@/lib/app-version";
import { createFeedback, FeedbackError } from "@/lib/feedback/service";
import { browserFamilyFromUA } from "@/lib/feedback/constants";
import { userFacingError } from "@/lib/user-error";

export type FeedbackSubmitState = { ok?: true; ref?: string; error?: string };

/**
 * إرسال ملاحظة تشغيل من أي صفحة. لا يلتقط أي محتوى صفحة أو كوكيز أو رموز — فقط الحقول
 * التي كتبها المدير + مسار الصفحة + مقاس نافذة العرض + عائلة المتصفح (من ترويسة الطلب)
 * + نسخة التطبيق (من الخادم). المرفق اختياري ويُخزَّن كملف حساس خاص.
 */
export async function submitFeedbackAction(formData: FormData): Promise<FeedbackSubmitState> {
  const user = await getCurrentUser();
  if (!user) return { error: "انتهت الجلسة. سجّل الدخول ثم أعد الإرسال." };
  if (!user.permissions.has("feedback.create")) {
    return { error: "لا تملك صلاحية إرسال الملاحظات." };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const browser = browserFamilyFromUA(h.get("user-agent"));

  const s = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : "";
  };

  // مرفق اختياري — يُتحقق من نوعه وحجمه في الخادم ويُخزَّن كملف حساس
  let attachmentFileId: string | null = null;
  const file = formData.get("attachment");
  if (file && typeof file !== "string" && file.size > 0) {
    const err = validateUpload(file.name, file.type, file.size);
    if (err) return { error: err };
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const saved = await saveUploadedFile({
        originalName: file.name,
        mime: file.type,
        data: buf,
        scope: "feedback",
        sensitive: true,
        uploadedBy: user.id,
      });
      attachmentFileId = saved.id;
    } catch (e) {
      return { error: userFacingError(e, "تعذّر حفظ المرفق") };
    }
  }

  try {
    const { ref } = await createFeedback({
      actorId: user.id,
      pagePath: s("pagePath"),
      module: s("module"),
      category: s("category"),
      severity: s("severity"),
      title: s("title"),
      attempted: s("attempted"),
      happened: s("happened"),
      expected: s("expected"),
      blocked: s("blocked") === "on" || s("blocked") === "true",
      attachmentFileId,
      viewport: s("viewport"),
      browser,
      appVersion: appVersion(),
      ip,
    });
    return { ok: true, ref };
  } catch (e) {
    if (e instanceof FeedbackError) return { error: e.message };
    return { error: "تعذّر تسجيل الملاحظة. أعد المحاولة." };
  }
}

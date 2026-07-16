"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { getAiConfig, saveAiConfig } from "@/lib/ai/settings";
import { audit } from "@/lib/audit";

export type AiSettingsState = { error?: string; success?: string } | null;

const schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["ollama", "anythingllm", "claude"]),
  ollamaBaseUrl: z.string().trim().url("عنوان أولاما غير صالح"),
  ollamaModel: z.string().trim().min(1, "اسم النموذج إلزامي").max(120),
  anythingllmBaseUrl: z.string().trim().url("عنوان AnythingLLM غير صالح"),
  anythingllmWorkspace: z.string().trim().min(1).max(120),
  claudeModel: z.string().trim().min(1).max(120),
  timeoutMs: z.coerce.number().int().min(5_000, "المهلة لا تقل عن 5 ثوانٍ").max(600_000, "المهلة لا تتجاوز 10 دقائق"),
  maxTokens: z.coerce.number().int().min(128).max(16_384),
  allowExternal: z.boolean(),
  retentionDays: z.coerce.number().int().min(0).max(3650),
});

export async function saveAiSettingsAction(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  const user = await requirePermission("ai.manage");
  const parsed = schema.safeParse({
    enabled: formData.get("enabled") === "on",
    provider: formData.get("provider"),
    ollamaBaseUrl: formData.get("ollamaBaseUrl"),
    ollamaModel: formData.get("ollamaModel"),
    anythingllmBaseUrl: formData.get("anythingllmBaseUrl"),
    anythingllmWorkspace: formData.get("anythingllmWorkspace"),
    claudeModel: formData.get("claudeModel"),
    timeoutMs: formData.get("timeoutMs"),
    maxTokens: formData.get("maxTokens"),
    allowExternal: formData.get("allowExternal") === "on",
    retentionDays: formData.get("retentionDays"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "مدخلات غير صالحة" };

  if (parsed.data.provider === "claude" && !parsed.data.allowExternal) {
    return { error: "اختيار Claude API (مزود خارجي) يتطلب تفعيل الموافقة الصريحة على إرسال المحتوى خارجياً" };
  }

  const before = await getAiConfig();
  await saveAiConfig(parsed.data, user.id);
  await audit({
    actorId: user.id,
    action: "ai.settings_updated",
    summary: `تحديث إعدادات الذكاء الاصطناعي: ${parsed.data.enabled ? "مفعل" : "معطل"} — المزود ${parsed.data.provider}`,
    detail: {
      before: { enabled: before.enabled, provider: before.provider, allowExternal: before.allowExternal },
      after: { enabled: parsed.data.enabled, provider: parsed.data.provider, allowExternal: parsed.data.allowExternal },
    },
  });
  revalidatePath("/admin/settings/ai");
  revalidatePath("/assistant");
  return { success: "حُفظت الإعدادات" };
}

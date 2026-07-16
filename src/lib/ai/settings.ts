import "server-only";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * إعدادات الذكاء الاصطناعي — قابلة للإدارة من واجهة المدير (لا تتطلب ملف البيئة لتفعيلها).
 * الأسرار (مفاتيح API) تبقى في البيئة خارج Git ولا تُخزن في قاعدة البيانات أبداً.
 * عناوين القاعدة تختلف حسب بيئة التشغيل:
 * - تطوير على macOS: http://localhost:11434 (أولاما) و http://localhost:3001 (AnythingLLM)
 * - داخل Docker: http://host.docker.internal:11434 و http://host.docker.internal:3001
 * - خادم أوبنتو: حسب مكان تشغيل المزود (عادة localhost على الخادم نفسه)
 */

export type AiProviderKey = "ollama" | "anythingllm" | "claude";

export type AiConfig = {
  enabled: boolean;
  provider: AiProviderKey;
  ollamaBaseUrl: string;
  ollamaModel: string;
  anythingllmBaseUrl: string;
  anythingllmWorkspace: string;
  claudeModel: string;
  timeoutMs: number;
  maxTokens: number;
  /** موافقة صريحة مسجلة على إرسال محتوى مدرسي لمزود خارجي (Claude API) */
  allowExternal: boolean;
  retentionDays: number;
};

const SETTINGS_KEY = "ai.config";

export function aiDefaults(): AiConfig {
  return {
    enabled: process.env.AI_ENABLED === "true",
    provider: (process.env.AI_PROVIDER as AiProviderKey) || "ollama",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:4b",
    anythingllmBaseUrl: process.env.ANYTHINGLLM_BASE_URL ?? "http://localhost:3001",
    anythingllmWorkspace: process.env.ANYTHINGLLM_WORKSPACE ?? "school",
    claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-5",
    timeoutMs: 120_000,
    maxTokens: 2048,
    allowExternal: false,
    retentionDays: 90,
  };
}

export async function getAiConfig(): Promise<AiConfig> {
  const stored = await getSetting<Partial<AiConfig> | null>(SETTINGS_KEY, null);
  return { ...aiDefaults(), ...(stored ?? {}) };
}

export async function saveAiConfig(config: AiConfig, updatedBy: string): Promise<void> {
  await setSetting(SETTINGS_KEY, config, updatedBy);
}

/** الأسرار من البيئة فقط — تُعرض حالتها (موجود/مفقود) دون كشف قيمتها */
export function aiSecrets() {
  return {
    anythingllmApiKey: process.env.ANYTHINGLLM_API_KEY ?? "",
    claudeApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  };
}

export function providerIsLocal(provider: AiProviderKey): boolean {
  return provider !== "claude";
}

export function providerNameAr(provider: AiProviderKey): string {
  return provider === "ollama" ? "أولاما (محلي)" : provider === "anythingllm" ? "AnythingLLM (محلي)" : "Claude API (خارجي)";
}

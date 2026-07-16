import "server-only";
import { getAiConfig, aiSecrets, providerIsLocal, providerNameAr, type AiConfig, type AiProviderKey } from "./settings";

/**
 * محول مزودي الذكاء الاصطناعي — أولاما وAnythingLLM محليان افتراضياً، وClaude API خارجي اختياري.
 * قواعد إلزامية:
 * - لا يعمل شيء ما لم يفعله المدير صراحة (من الواجهة أو البيئة).
 * - لا يُرسل أي محتوى لمزود خارجي دون موافقة صريحة مسجلة (allowExternal).
 * - المساعد لا يعتمد ولا يقفل ولا يقيم ولا يحذف ولا يغير سجلاً رسمياً — عبر أدوات مصنفة فقط.
 */

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export interface AiProvider {
  readonly key: AiProviderKey;
  readonly nameAr: string;
  readonly local: boolean;
  readonly model: string;
  chat(messages: AiMessage[], opts?: { json?: boolean }): Promise<string>;
  /** بث الرد نصاً متدفقاً حيث يدعم المزود ذلك */
  chatStream(messages: AiMessage[], onToken: (t: string) => void, signal?: AbortSignal): Promise<string>;
}

function timeoutSignal(ms: number, extra?: AbortSignal): AbortSignal {
  return extra ? AbortSignal.any([AbortSignal.timeout(ms), extra]) : AbortSignal.timeout(ms);
}

class OllamaProvider implements AiProvider {
  readonly key = "ollama" as const;
  readonly nameAr = providerNameAr("ollama");
  readonly local = true;
  constructor(private cfg: AiConfig) {}
  get model() {
    return this.cfg.ollamaModel;
  }
  async chat(messages: AiMessage[], opts?: { json?: boolean }): Promise<string> {
    const res = await fetch(`${this.cfg.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        // إيقاف وضع التفكير المطول في نماذج qwen3 — يقلص زمن الرد كثيراً
        think: false,
        ...(opts?.json ? { format: "json" } : {}),
        options: { num_predict: this.cfg.maxTokens },
      }),
      signal: timeoutSignal(this.cfg.timeoutMs),
    });
    if (!res.ok) throw new Error(`تعذر الاتصال بمزود الذكاء الاصطناعي المحلي (${res.status})`);
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  }
  async chatStream(messages: AiMessage[], onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${this.cfg.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: true, think: false, options: { num_predict: this.cfg.maxTokens } }),
      signal: timeoutSignal(this.cfg.timeoutMs, signal),
    });
    if (!res.ok || !res.body) throw new Error(`تعذر الاتصال بمزود الذكاء الاصطناعي المحلي (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const t = chunk.message?.content ?? "";
          if (t) {
            full += t;
            onToken(t);
          }
        } catch {
          // سطر غير مكتمل — يُتجاهل
        }
      }
    }
    return full;
  }
}

class AnythingLlmProvider implements AiProvider {
  readonly key = "anythingllm" as const;
  readonly nameAr = providerNameAr("anythingllm");
  readonly local = true;
  constructor(private cfg: AiConfig, private apiKey: string) {}
  get model() {
    return `مساحة ${this.cfg.anythingllmWorkspace}`;
  }
  async chat(messages: AiMessage[]): Promise<string> {
    const prompt = messages.map((m) => m.content).join("\n\n");
    const res = await fetch(`${this.cfg.anythingllmBaseUrl}/api/v1/workspace/${this.cfg.anythingllmWorkspace}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ message: prompt, mode: "chat" }),
      signal: timeoutSignal(this.cfg.timeoutMs),
    });
    if (!res.ok) throw new Error(`تعذر الاتصال بمزود الذكاء الاصطناعي المحلي (${res.status})`);
    const json = (await res.json()) as { textResponse?: string };
    return json.textResponse ?? "";
  }
  async chatStream(messages: AiMessage[], onToken: (t: string) => void): Promise<string> {
    const text = await this.chat(messages);
    onToken(text);
    return text;
  }
}

class ClaudeProvider implements AiProvider {
  readonly key = "claude" as const;
  readonly nameAr = providerNameAr("claude");
  readonly local = false;
  constructor(private cfg: AiConfig, private apiKey: string) {}
  get model() {
    return this.cfg.claudeModel;
  }
  private body(messages: AiMessage[], stream: boolean) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const rest = messages.filter((m) => m.role !== "system");
    return JSON.stringify({
      model: this.model,
      max_tokens: this.cfg.maxTokens,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
      stream,
    });
  }
  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  async chat(messages: AiMessage[]): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, false),
      signal: timeoutSignal(this.cfg.timeoutMs),
    });
    if (!res.ok) throw new Error(`تعذر الاتصال بالمزود الخارجي (${res.status})`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }
  async chatStream(messages: AiMessage[], onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, true),
      signal: timeoutSignal(this.cfg.timeoutMs, signal),
    });
    if (!res.ok || !res.body) throw new Error(`تعذر الاتصال بالمزود الخارجي (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const evt = JSON.parse(line.slice(5)) as { type: string; delta?: { type: string; text?: string } };
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            full += evt.delta.text;
            onToken(evt.delta.text);
          }
        } catch {
          // حدث غير مكتمل — يُتجاهل
        }
      }
    }
    return full;
  }
}

export class AiDisabledError extends Error {
  constructor(message = "الذكاء الاصطناعي معطل — يفعله المدير من الإعدادات") {
    super(message);
  }
}

export function buildProvider(config: AiConfig): AiProvider {
  const secrets = aiSecrets();
  if (config.provider === "ollama") return new OllamaProvider(config);
  if (config.provider === "anythingllm") {
    if (!secrets.anythingllmApiKey) throw new Error("مفتاح AnythingLLM غير موجود في البيئة (ANYTHINGLLM_API_KEY)");
    return new AnythingLlmProvider(config, secrets.anythingllmApiKey);
  }
  if (config.provider === "claude") {
    if (!config.allowExternal) throw new Error("المزود الخارجي يتطلب موافقة صريحة مسجلة في إعدادات الذكاء الاصطناعي");
    if (!secrets.claudeApiKey) throw new Error("مفتاح Claude API غير موجود في البيئة (ANTHROPIC_API_KEY)");
    return new ClaudeProvider(config, secrets.claudeApiKey);
  }
  throw new Error("مزود غير معروف");
}

export async function aiEnabled(): Promise<boolean> {
  const config = await getAiConfig();
  return config.enabled;
}

/** المزود الفعال وفق الإعدادات المحفوظة — يرمي خطأ عربياً واضحاً إن كان معطلاً أو ناقص الإعداد */
export async function getActiveProvider(): Promise<{ provider: AiProvider; config: AiConfig }> {
  const config = await getAiConfig();
  if (!config.enabled) throw new AiDisabledError();
  return { provider: buildProvider(config), config };
}

export type ConnectionTest = {
  ok: boolean;
  nameAr: string;
  local: boolean;
  model: string;
  latencyMs: number;
  detail: string;
  models?: string[];
};

/** فحص الاتصال بالمزود — تشخيص واضح بالعربية دون كشف أسرار */
export async function testConnection(config: AiConfig): Promise<ConnectionTest> {
  const started = Date.now();
  const base = { nameAr: providerNameAr(config.provider), local: providerIsLocal(config.provider) };
  try {
    if (config.provider === "ollama") {
      const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`الخادم رد بالرمز ${res.status}`);
      const json = (await res.json()) as { models?: { name: string }[] };
      const models = (json.models ?? []).map((m) => m.name);
      const found = models.includes(config.ollamaModel);
      return {
        ok: found,
        ...base,
        model: config.ollamaModel,
        latencyMs: Date.now() - started,
        detail: found
          ? `الاتصال ناجح — النموذج ${config.ollamaModel} متوفر`
          : `الخادم يعمل لكن النموذج ${config.ollamaModel} غير منزل — النماذج المتوفرة: ${models.join("، ") || "لا شيء"}`,
        models,
      };
    }
    if (config.provider === "anythingllm") {
      const key = aiSecrets().anythingllmApiKey;
      if (!key) {
        return { ok: false, ...base, model: config.anythingllmWorkspace, latencyMs: 0, detail: "مفتاح ANYTHINGLLM_API_KEY غير موجود في ملف البيئة على الخادم" };
      }
      const res = await fetch(`${config.anythingllmBaseUrl}/api/v1/auth`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(res.status === 403 ? "المفتاح مرفوض (403) — تحقق من ANYTHINGLLM_API_KEY" : `الخادم رد بالرمز ${res.status}`);
      return { ok: true, ...base, model: config.anythingllmWorkspace, latencyMs: Date.now() - started, detail: `الاتصال ناجح — مساحة العمل: ${config.anythingllmWorkspace}` };
    }
    // claude
    if (!config.allowExternal) {
      return { ok: false, ...base, model: config.claudeModel, latencyMs: 0, detail: "المزود الخارجي يتطلب تفعيل الموافقة الصريحة أولاً" };
    }
    if (!aiSecrets().claudeApiKey) {
      return { ok: false, ...base, model: config.claudeModel, latencyMs: 0, detail: "مفتاح ANTHROPIC_API_KEY غير موجود في ملف البيئة على الخادم" };
    }
    const provider = buildProvider(config);
    const reply = await provider.chat([{ role: "user", content: "قل: جاهز" }]);
    return { ok: reply.length > 0, ...base, model: config.claudeModel, latencyMs: Date.now() - started, detail: "الاتصال بالمزود الخارجي ناجح" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = /fetch failed|ECONNREFUSED|timeout|TimeoutError|aborted/i.test(msg)
      ? " — تحقق أن الخدمة تعمل وأن العنوان صحيح لبيئة التشغيل (داخل Docker استخدم host.docker.internal بدل localhost)"
      : "";
    return { ok: false, ...base, model: config.provider === "ollama" ? config.ollamaModel : config.provider === "anythingllm" ? config.anythingllmWorkspace : config.claudeModel, latencyMs: Date.now() - started, detail: `فشل الاتصال: ${msg}${hint}` };
  }
}

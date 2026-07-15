import "server-only";

/**
 * محول مزودي الذكاء الاصطناعي المحليين — معطل افتراضياً (AI_ENABLED=false).
 * يدعم Ollama وAnythingLLM محلياً؛ Claude API بديل خارجي اختياري لاحقاً.
 * قواعد إلزامية:
 * - لا يعمل شيء ما لم يفعل صراحة من البيئة.
 * - لا يرسل أي محتوى لمزود خارجي (غير محلي) دون موافقة صريحة لكل عملية.
 * - الذكاء الاصطناعي لا يعتمد ولا يقفل ولا يقيم ولا يحذف ولا يغير سجلاً رسمياً — مقترحات نصية فقط.
 */

export type AiMessage = { role: "system" | "user"; content: string };

export interface AiProvider {
  readonly nameAr: string;
  readonly local: boolean;
  chat(messages: AiMessage[]): Promise<string>;
}

class OllamaProvider implements AiProvider {
  readonly nameAr = "أولاما (محلي)";
  readonly local = true;
  constructor(private baseUrl: string, private model: string) {}
  async chat(messages: AiMessage[]): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`تعذر الاتصال بمزود الذكاء الاصطناعي المحلي (${res.status})`);
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  }
}

class AnythingLlmProvider implements AiProvider {
  readonly nameAr = "AnythingLLM (محلي)";
  readonly local = true;
  constructor(private baseUrl: string, private apiKey: string, private workspace: string) {}
  async chat(messages: AiMessage[]): Promise<string> {
    const prompt = messages.map((m) => m.content).join("\n\n");
    const res = await fetch(`${this.baseUrl}/api/v1/workspace/${this.workspace}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ message: prompt, mode: "chat" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`تعذر الاتصال بمزود الذكاء الاصطناعي المحلي (${res.status})`);
    const json = (await res.json()) as { textResponse?: string };
    return json.textResponse ?? "";
  }
}

export function aiEnabled(): boolean {
  return process.env.AI_ENABLED === "true";
}

export function getAiProvider(): AiProvider | null {
  if (!aiEnabled()) return null;
  const provider = process.env.AI_PROVIDER ?? "ollama";
  if (provider === "ollama") {
    return new OllamaProvider(
      process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      process.env.OLLAMA_MODEL ?? "qwen3:8b",
    );
  }
  if (provider === "anythingllm") {
    const baseUrl = process.env.ANYTHINGLLM_BASE_URL;
    const apiKey = process.env.ANYTHINGLLM_API_KEY;
    const workspace = process.env.ANYTHINGLLM_WORKSPACE ?? "school";
    if (!baseUrl || !apiKey) return null;
    return new AnythingLlmProvider(baseUrl, apiKey, workspace);
  }
  return null;
}

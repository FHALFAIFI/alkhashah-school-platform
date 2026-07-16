"use client";

import { useActionState, useState } from "react";
import { saveAiSettingsAction, type AiSettingsState } from "./actions";
import { Field, SubmitButton } from "@/components/ui";
import type { AiConfig } from "@/lib/ai/settings";

type TestResult = {
  ok: boolean;
  nameAr: string;
  local: boolean;
  model: string;
  latencyMs: number;
  detail: string;
  models?: string[];
};

export function AiSettingsForm({
  initial,
  csrfToken,
  secretsPresence,
}: {
  initial: AiConfig;
  csrfToken: string;
  secretsPresence: { anythingllm: boolean; claude: boolean };
}) {
  const [state, formAction] = useActionState<AiSettingsState, FormData>(saveAiSettingsAction, null);
  const [provider, setProvider] = useState(initial.provider);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/ai/test", { method: "POST", headers: { "x-csrf-token": csrfToken } });
      setTest((await res.json()) as TestResult);
    } catch {
      setTest({ ok: false, nameAr: "", local: true, model: "", latencyMs: 0, detail: "تعذر الاتصال بالخادم — احفظ الإعدادات ثم أعد المحاولة" });
    } finally {
      setTesting(false);
    }
  };

  const localBadge = (isLocal: boolean) => (
    <span className={`ms-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${isLocal ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
      {isLocal ? "محلي" : "خارجي"}
    </span>
  );

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{state.success}</div>}

      <label className="flex items-center gap-3 rounded-lg border border-sand-200 p-3">
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} className="h-5 w-5 accent-brand-600" />
        <span>
          <span className="block font-medium text-gray-800">تفعيل مساعد المدير الذكي</span>
          <span className="block text-xs text-gray-500">المنصة تعمل كاملة بدونه — التعطيل لا يؤثر على أي وظيفة أخرى</span>
        </span>
      </label>

      <div>
        <label htmlFor="provider" className="mb-1 block text-sm font-medium text-gray-700">المزود</label>
        <select
          id="provider"
          name="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as AiConfig["provider"])}
          className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
        >
          <option value="ollama">أولاما — Ollama (محلي، يدعم أدوات المنصة)</option>
          <option value="anythingllm">AnythingLLM (محلي، معرفة مستندية فقط — دون أدوات المنصة)</option>
          <option value="claude">Claude API (خارجي اختياري — يتطلب موافقة صريحة)</option>
        </select>
      </div>

      {provider === "ollama" && (
        <div className="space-y-3 rounded-lg bg-sand-50 p-3">
          <p className="text-sm font-medium text-gray-700">إعدادات أولاما {localBadge(true)}</p>
          <Field label="عنوان القاعدة" name="ollamaBaseUrl" defaultValue={initial.ollamaBaseUrl} dir="ltr" hint="على هذا الجهاز: http://localhost:11434 — داخل Docker: http://host.docker.internal:11434" />
          <Field label="النموذج" name="ollamaModel" defaultValue={initial.ollamaModel} dir="ltr" hint="مثال: qwen3:4b — استخدم فحص الاتصال لعرض النماذج المنزلة" />
        </div>
      )}
      {provider !== "ollama" && (
        <>
          <input type="hidden" name="ollamaBaseUrl" value={initial.ollamaBaseUrl} />
          <input type="hidden" name="ollamaModel" value={initial.ollamaModel} />
        </>
      )}

      {provider === "anythingllm" && (
        <div className="space-y-3 rounded-lg bg-sand-50 p-3">
          <p className="text-sm font-medium text-gray-700">إعدادات AnythingLLM {localBadge(true)}</p>
          <Field label="عنوان القاعدة" name="anythingllmBaseUrl" defaultValue={initial.anythingllmBaseUrl} dir="ltr" />
          <Field label="مساحة العمل" name="anythingllmWorkspace" defaultValue={initial.anythingllmWorkspace} dir="ltr" />
          <p className="text-xs text-gray-500">
            المفتاح من ملف البيئة (ANYTHINGLLM_API_KEY): {secretsPresence.anythingllm ? "✔ موجود" : "✗ غير موجود"} — AnythingLLM للمعرفة
            المستندية والاسترجاع، ولا ينفذ إجراءات المنصة.
          </p>
        </div>
      )}
      {provider !== "anythingllm" && (
        <>
          <input type="hidden" name="anythingllmBaseUrl" value={initial.anythingllmBaseUrl} />
          <input type="hidden" name="anythingllmWorkspace" value={initial.anythingllmWorkspace} />
        </>
      )}

      {provider === "claude" && (
        <div className="space-y-3 rounded-lg bg-amber-50 p-3">
          <p className="text-sm font-medium text-gray-800">إعدادات Claude API {localBadge(false)}</p>
          <Field label="النموذج" name="claudeModel" defaultValue={initial.claudeModel} dir="ltr" />
          <p className="text-xs text-gray-600">المفتاح من ملف البيئة (ANTHROPIC_API_KEY): {secretsPresence.claude ? "✔ موجود" : "✗ غير موجود"}</p>
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-white p-3">
            <input type="checkbox" name="allowExternal" defaultChecked={initial.allowExternal} className="mt-0.5 h-5 w-5 accent-amber-600" />
            <span className="text-sm text-gray-700">
              <strong>موافقة صريحة:</strong> أوافق على إرسال محتوى مدرسي إلى مزود خارجي (Anthropic) عند استخدام هذا المزود. دون هذه
              الموافقة لن يُرسل أي محتوى خارج المدرسة.
            </span>
          </label>
        </div>
      )}
      {provider !== "claude" && (
        <>
          <input type="hidden" name="claudeModel" value={initial.claudeModel} />
          {initial.allowExternal && <input type="hidden" name="allowExternal" value="on" />}
        </>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="المهلة (مللي ثانية)" name="timeoutMs" type="number" defaultValue={initial.timeoutMs} dir="ltr" />
        <Field label="حد الرد (رموز)" name="maxTokens" type="number" defaultValue={initial.maxTokens} dir="ltr" />
        <Field label="احتفاظ المحادثات (يوم)" name="retentionDays" type="number" defaultValue={initial.retentionDays} dir="ltr" hint="0 = بلا حذف تلقائي" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>حفظ الإعدادات</SubmitButton>
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="min-h-11 rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-sand-100 disabled:opacity-50 lg:min-h-0"
        >
          {testing ? "جارٍ الفحص…" : "فحص الاتصال (بالإعدادات المحفوظة)"}
        </button>
      </div>

      {test && (
        <div role={test.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${test.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          <p className="font-medium">
            {test.ok ? "✔ الاتصال ناجح" : "✗ فشل الاتصال"} — {test.nameAr} {test.model && `(${test.model})`}
            {test.latencyMs > 0 && <span className="tabular-nums"> — {test.latencyMs} م.ث</span>}
          </p>
          <p className="mt-1 text-xs">{test.detail}</p>
          {test.models && test.models.length > 0 && (
            <p className="mt-1 text-xs" dir="ltr">النماذج المتوفرة: {test.models.join("، ")}</p>
          )}
        </div>
      )}
    </form>
  );
}

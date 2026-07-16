import { requirePermission } from "@/lib/auth/session";
import { getAiConfig, aiSecrets } from "@/lib/ai/settings";
import { PageHeader, Card, LinkButton } from "@/components/ui";
import { AiSettingsForm } from "./ai-settings-form";

export const metadata = { title: "إعدادات الذكاء الاصطناعي" };
export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const user = await requirePermission("ai.manage");
  const config = await getAiConfig();
  const secrets = aiSecrets();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="إعدادات الذكاء الاصطناعي"
        subtitle="أولاما وAnythingLLM يعملان محلياً داخل المدرسة؛ Claude API مزود خارجي اختياري يتطلب موافقة صريحة"
        actions={<LinkButton href="/assistant" variant="secondary">فتح المساعد</LinkButton>}
      />
      <Card>
        <AiSettingsForm
          initial={config}
          csrfToken={user.csrfToken}
          secretsPresence={{ anythingllm: !!secrets.anythingllmApiKey, claude: !!secrets.claudeApiKey }}
        />
      </Card>
      <Card className="mt-4">
        <h2 className="mb-2 font-bold text-brand-900">الأسرار وملف البيئة</h2>
        <p className="text-sm text-gray-600">
          مفاتيح API تبقى في ملف البيئة على الخادم خارج Git ولا تخزن في قاعدة البيانات ولا تظهر في الواجهة:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          <li>• <code dir="ltr">ANYTHINGLLM_API_KEY</code> — {secrets.anythingllmApiKey ? "✔ موجود" : "غير موجود"}</li>
          <li>• <code dir="ltr">ANTHROPIC_API_KEY</code> — {secrets.claudeApiKey ? "✔ موجود" : "غير موجود"}</li>
        </ul>
        <p className="mt-3 text-xs text-gray-400">
          عناوين القاعدة حسب بيئة التشغيل: على macOS مباشرة <code dir="ltr">http://localhost:11434</code>؛ داخل Docker استخدم{" "}
          <code dir="ltr">http://host.docker.internal:11434</code>؛ وعلى خادم أوبنتو حسب مكان تشغيل المزود.
        </p>
      </Card>
    </div>
  );
}

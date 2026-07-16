import { requirePermission } from "@/lib/auth/session";
import { getSetting, setSetting } from "@/lib/settings";
import { getAiConfig, providerNameAr } from "@/lib/ai/settings";
import { PageHeader, Card, SubmitButton, Field, LinkButton } from "@/components/ui";
import { audit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const metadata = { title: "الإعدادات" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePermission("admin.settings");
  const [sigDefault, stampDefault, followupTarget, assetPrefix, aiConfig] = await Promise.all([
    getSetting("branding.signature_default", false),
    getSetting("branding.stamp_default", false),
    getSetting("performance.followup_target", 5),
    getSetting("assets.code_prefix", "KHS-AST-"),
    getAiConfig(),
  ]);

  async function save(formData: FormData) {
    "use server";
    const u = await requirePermission("admin.settings");
    await setSetting("branding.signature_default", formData.get("sigDefault") === "on", u.id);
    await setSetting("branding.stamp_default", formData.get("stampDefault") === "on", u.id);
    await setSetting("performance.followup_target", Math.max(1, Number(formData.get("followupTarget") ?? 5)), u.id);
    await setSetting("assets.code_prefix", String(formData.get("assetPrefix") ?? "KHS-AST-"), u.id);
    await audit({ actorId: u.id, action: "admin.settings_changed", summary: "تحديث إعدادات النظام" });
    revalidatePath("/admin/settings");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="إعدادات النظام" />
      <Card>
        <form action={save} className="space-y-4">
          <div>
            <h2 className="mb-2 font-bold text-gray-800">التوقيع والختم — خياران مستقلان</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="sigDefault" defaultChecked={sigDefault} />
              إدراج توقيع المدير افتراضياً في الوثائق (يمكن تجاوزه لكل وثيقة)
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" name="stampDefault" defaultChecked={stampDefault} />
              إدراج ختم المدرسة افتراضياً في الوثائق (يمكن تجاوزه لكل وثيقة)
            </label>
            <p className="mt-1 text-xs text-gray-400">يخزن التوقيع والختم في التخزين الخاص خارج المستودع البرمجي، واستخدامهما مقيد ومدقق.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="المستهدف السنوي لجلسات المتابعة" name="followupTarget" type="number" defaultValue={followupTarget} />
            <Field label="بادئة رموز الأصول" name="assetPrefix" defaultValue={assetPrefix} dir="ltr" />
          </div>
          <SubmitButton>حفظ الإعدادات</SubmitButton>
        </form>
      </Card>
      <Card>
        <h2 className="mb-1 font-bold text-gray-800">الذكاء الاصطناعي</h2>
        <p className="text-sm text-gray-500">
          الحالة: <strong>{aiConfig.enabled ? `مفعل — ${providerNameAr(aiConfig.provider)}` : "معطل (الافتراضي)"}</strong> — التطبيق يعمل
          كاملاً بدونه، والتفعيل والفحص من صفحة الإعدادات المخصصة.
        </p>
        {user.permissions.has("ai.manage") && (
          <div className="mt-3">
            <LinkButton href="/admin/settings/ai" variant="secondary">فتح إعدادات الذكاء الاصطناعي</LinkButton>
          </div>
        )}
      </Card>
    </div>
  );
}

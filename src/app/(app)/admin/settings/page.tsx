import { requirePermission } from "@/lib/auth/session";
import { getSetting, setSetting } from "@/lib/settings";
import { getDocumentIdentity, saveDocumentIdentity } from "@/lib/document-identity";
import { saveUploadedFile, validateUpload } from "@/lib/storage";
import { PageHeader, Card, SubmitButton, Field, LinkButton } from "@/components/ui";
import { audit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export const metadata = { title: "الإعدادات" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePermission("admin.settings");
  const [sigDefault, stampDefault, followupTarget, assetPrefix, identity] = await Promise.all([
    getSetting("branding.signature_default", false),
    getSetting("branding.stamp_default", false),
    getSetting("performance.followup_target", 5),
    getSetting("assets.code_prefix", "KHS-AST-"),
    getDocumentIdentity(),
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

  async function saveIdentity(formData: FormData) {
    "use server";
    const u = await requirePermission("admin.settings");
    // شعارات محلية عبر خط الرفع الآمن الموحّد نفسه (تحقق النوع والتوقيع والحجم)
    const logoPatch: Record<string, string> = {};
    for (const [field, key] of [
      ["ministryLogo", "ministryLogoFileId"],
      ["schoolLogo", "schoolLogoFileId"],
    ] as const) {
      const file = formData.get(field);
      if (file instanceof File && file.size > 0) {
        const err = validateUpload(file.name, file.type || "application/octet-stream", file.size);
        if (err) return;
        const stored = await saveUploadedFile({
          originalName: file.name,
          mime: file.type || "application/octet-stream",
          data: Buffer.from(await file.arrayBuffer()),
          scope: "branding",
          sensitive: true,
          uploadedBy: u.id,
        });
        logoPatch[key] = stored.id;
      }
    }
    await saveDocumentIdentity(
      {
        ministryName: String(formData.get("ministryName") ?? ""),
        educationDepartment: String(formData.get("educationDepartment") ?? ""),
        educationOffice: String(formData.get("educationOffice") ?? ""),
        schoolName: String(formData.get("schoolName") ?? ""),
        principalName: String(formData.get("principalName") ?? ""),
        principalTitle: String(formData.get("principalTitle") ?? ""),
        academicYear: String(formData.get("academicYear") ?? ""),
        headerNote: String(formData.get("headerNote") ?? ""),
        footerNote: String(formData.get("footerNote") ?? ""),
        ...logoPatch,
      },
      u.id,
    );
    await audit({ actorId: u.id, action: "admin.identity_changed", summary: "تحديث هوية الوثائق الرسمية" });
    revalidatePath("/admin/settings");
  }

  const appVersion = process.env.APP_VERSION ?? process.env.npm_package_version ?? "0.1.0";

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="إعدادات النظام" />
      {/* هوية الوثائق الرسمية (v2.3 §8): اسم المدير ومسماه والشعارات — مركزية لا تُكرر في المولدات */}
      <Card>
        <form action={saveIdentity} className="space-y-3">
          <h2 className="font-bold text-gray-800">هوية الوثائق الرسمية</h2>
          <p className="text-xs text-gray-500">
            تظهر هذه البيانات في ترويسة كل وثيقة وتقرير مولَّد وفي خانة التوقيع. الوثائق الصادرة
            سابقاً لا تتأثر — لقطاتها مجمّدة.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="سطر الوزارة" name="ministryName" defaultValue={identity.ministryName} />
            <Field label="إدارة التعليم" name="educationDepartment" defaultValue={identity.educationDepartment} />
            <Field label="مكتب التعليم" name="educationOffice" defaultValue={identity.educationOffice} />
            <Field label="اسم المدرسة/المجمع" name="schoolName" defaultValue={identity.schoolName} />
            <Field label="اسم مدير المدرسة" name="principalName" defaultValue={identity.principalName} hint="مثال: حسين بن جابر أحمد الفيفي" />
            <Field label="المسمى الوظيفي" name="principalTitle" defaultValue={identity.principalTitle} />
            <Field label="العام الدراسي" name="academicYear" defaultValue={identity.academicYear} />
            <Field label="ملاحظة الترويسة (اختياري)" name="headerNote" defaultValue={identity.headerNote} />
            <Field label="نص التذييل" name="footerNote" defaultValue={identity.footerNote} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">شعار وزارة التعليم الرسمي</label>
              <input name="ministryLogo" type="file" accept="image/png,image/jpeg,image/webp" className="w-full text-sm" />
              <p className="mt-1 text-xs text-gray-400">
                {identity.ministryLogoFileId ? "شعار محفوظ — الرفع يستبدله" : "ارفع ملف الشعار المعتمد — يُخزَّن محلياً ولا يُجلب من الشبكة"}
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">شعار المدرسة (اختياري)</label>
              <input name="schoolLogo" type="file" accept="image/png,image/jpeg,image/webp" className="w-full text-sm" />
              <p className="mt-1 text-xs text-gray-400">
                {identity.schoolLogoFileId ? "شعار محفوظ — الرفع يستبدله" : "اختياري"}
              </p>
            </div>
          </div>
          <SubmitButton>حفظ هوية الوثائق</SubmitButton>
        </form>
      </Card>
      <Card>
        <h2 className="mb-1 font-bold text-gray-800">معلومات النظام</h2>
        <p className="text-sm text-gray-600">
          إصدار التطبيق: <span className="tabular-nums" dir="ltr">{appVersion}</span>
        </p>
        <p className="mt-1 text-xs text-gray-400">يظهر هذا الإصدار أيضاً في بيانات كل ملاحظة تشغيلية.</p>
      </Card>
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
    </div>
  );
}

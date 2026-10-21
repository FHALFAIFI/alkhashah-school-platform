"use server";

import { requirePermission } from "@/lib/auth/session";
import {
  createStyleTemplate,
  updateStyleTemplate,
  archiveStyleTemplate,
  restoreStyleTemplate,
  setDefaultTemplate,
  type StyleResult,
} from "@/lib/reports/instances/style-templates";
import { baseTemplateByKey } from "@/lib/reports/instances/base-templates";

export type ActionState = StyleResult | null;

/**
 * إجراءات قوالب الإخراج (v2.6 §E — D-058).
 *
 * الحقول المقبولة معدودة صراحةً هنا ثم يعاد التحقق منها بالمخطط الصارم في الخدمة —
 * لا HTML ولا CSS حرّان في أي مسار. D-053: لا إبطال مسارات؛ العميل يحدّث نفسه.
 */

/** يقرأ إعداد القالب من النموذج — كل حقل معلن، وما ليس معلَناً لا يمرّ */
function configFrom(formData: FormData): Record<string, unknown> {
  const value = (name: string) => String(formData.get(name) ?? "").trim();
  return {
    primaryColor: value("primaryColor"),
    accentColor: value("accentColor"),
    showIdentity: formData.get("showIdentity") === "1",
    showLogos: formData.get("showLogos") === "1",
    cover: value("cover"),
    toc: value("toc"),
    approvalBox: formData.get("approvalBox") === "1",
    headerText: value("headerText"),
    footerText: value("footerText"),
    density: value("density"),
  };
}

export async function createStyleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  const baseKey = String(formData.get("baseKey") ?? "");
  const base = baseTemplateByKey(baseKey);
  const name = String(formData.get("name") ?? "").trim() || `${base?.labelAr ?? "قالب"} — نسخة مخصصة`;
  return createStyleTemplate({ name, baseKey, config: base?.config }, user);
}

export async function updateStyleAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return updateStyleTemplate(templateId, { name: String(formData.get("name") ?? ""), config: configFrom(formData) }, user);
}

export async function archiveStyleAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  if (String(formData.get("confirm") ?? "") !== "1") return { error: "أكّد أرشفة القالب" };
  return archiveStyleTemplate(templateId, user);
}

export async function restoreStyleAction(templateId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return restoreStyleTemplate(templateId, user);
}

export async function setDefaultTemplateAction(typeKey: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return setDefaultTemplate(typeKey, String(formData.get("templateKey") ?? ""), user);
}

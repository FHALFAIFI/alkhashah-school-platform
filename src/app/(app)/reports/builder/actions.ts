"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { parseReportFilters } from "@/lib/reports/filters";
import { reportByKey, isSortableColumn } from "@/lib/reports/catalog";
import {
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  deleteTemplate,
  type TemplateResult,
} from "@/lib/reports/templates";

export type ActionState = TemplateResult | null;

/**
 * إجراءات قوالب التقارير (v2.5.0 §4.5).
 *
 * الحارس هنا طبقتان: `reports.builder` للوصول إلى المنشئ أصلاً، ثم صلاحية **التقرير
 * المصدر** داخل خدمة القوالب لكل عملية. لا إجراء يثق بما وصله من النموذج: المرشّحات
 * تُقرأ بالمحلّل المُقيَّد بالقوائم البيضاء، والأعمدة تُصفَّى بأعمدة التقرير المعلَنة.
 *
 * D-053: لا إبطال مسارات — التحويل بعد الحفظ، أو تحديث العميل بعد استقرار النتيجة.
 */

/** يبني المرشّحات من نص الاستعلام المرافق للنموذج — المصدر نفسه الذي تعرضه الشاشة */
function filtersFromForm(formData: FormData, reportKey: string) {
  const raw = String(formData.get("query") ?? "");
  const def = reportByKey(reportKey);
  return parseReportFilters(new URLSearchParams(raw), {
    allowedSort: (k) => isSortableColumn(reportKey, k),
    allowedColumns: def?.columns.map((c) => c.key),
  });
}

function inputFrom(formData: FormData) {
  const reportKey = String(formData.get("reportKey") ?? "");
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    reportKey,
    filters: filtersFromForm(formData, reportKey),
    columns: formData.getAll("col").map(String),
    visibility: String(formData.get("visibility") ?? "خاص"),
    outputFormat: String(formData.get("outputFormat") ?? "") || undefined,
  };
}

export async function saveTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  const result = await createTemplate(inputFrom(formData), user);
  if (result.error) return result;
  redirect("/reports/templates");
}

export async function updateTemplateAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  const result = await updateTemplate(templateId, inputFrom(formData), user);
  if (result.error) return result;
  redirect("/reports/templates");
}

export async function duplicateTemplateAction(templateId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return duplicateTemplate(templateId, user);
}

export async function deleteTemplateAction(templateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  // §12.9 لا ينطبق هنا: حذف القالب لا يمحو بيانات ولا وثيقة صادرة، فيكفيه تأكيد صريح
  // واحد بلا اسم مكتوب ولا سبب إلزامي — الضوابط الثقيلة للحذف الذي لا رجعة فيه.
  if (String(formData.get("confirm") ?? "") !== "1") return { error: "أكّد حذف القالب" };
  return deleteTemplate(templateId, user);
}

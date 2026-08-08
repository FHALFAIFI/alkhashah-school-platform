"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { parseReportFilters } from "@/lib/reports/filters";
import { reportByKey, isSortableColumn } from "@/lib/reports/catalog";
import {
  createInstance,
  updateInstance,
  deleteDraft,
  copyInstance,
  newVersion,
  finalizeInstance,
  archiveInstance,
  unarchiveInstance,
  attachSignedCopy,
  getInstance,
  type InstanceResult,
} from "@/lib/reports/instances/service";
import { requestGeneration, runJob } from "@/lib/reports/instances/jobs";
import { saveUploadedFile, UploadValidationError } from "@/lib/storage";
import { userFacingError } from "@/lib/user-error";

export type ActionState = InstanceResult | null;

/**
 * إجراءات التقارير المحفوظة (v2.6 §A/§B/§I).
 *
 * الحارس طبقتان كسائر المنصة: صلاحية عامة هنا، ثم خدمة التقارير تفحص حالة التقرير
 * وصلاحية كل قسم وحساسيته (D-013) عند كل عملية. D-053: لا إبطال مسارات — العميل يحدّث
 * نفسه بعد استقرار النتيجة، والتوليد الخلفي يجري عبر `after()` فلا يقطع بثّ الاستجابة.
 */

function filtersFrom(formData: FormData) {
  const raw = String(formData.get("query") ?? "");
  const reportKey = String(formData.get("reportKey") ?? "");
  const def = reportByKey(reportKey);
  return parseReportFilters(new URLSearchParams(raw), {
    allowedSort: (k) => isSortableColumn(reportKey, k),
    allowedColumns: def?.columns.map((c) => c.key),
  });
}

function optionsFrom(formData: FormData): Record<string, unknown> {
  const reportKey = String(formData.get("reportKey") ?? "");
  const options: Record<string, unknown> = {};
  if (reportKey) options.reportKey = reportKey;
  const templateKey = String(formData.get("templateKey") ?? "");
  if (templateKey) options.templateKey = templateKey;
  if (formData.get("showEmpty") === "1") options.showEmpty = true;
  const order = formData.getAll("sectionOrder").map(String).filter(Boolean);
  if (order.length) options.sectionOrder = order;
  const hidden = formData.getAll("hiddenSection").map(String).filter(Boolean);
  if (hidden.length) options.hiddenSections = hidden;
  const overrides: Record<string, string> = {};
  for (const key of ["schoolName", "principalName", "principalTitle", "academicYear", "headerNote", "footerNote"]) {
    const value = String(formData.get(`identity_${key}`) ?? "").trim();
    if (value) overrides[key] = value;
  }
  if (Object.keys(overrides).length) options.identityOverrides = overrides;
  return options;
}

function inputFrom(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    typeKey: String(formData.get("typeKey") ?? ""),
    filters: filtersFrom(formData),
    options: optionsFrom(formData),
    periodFrom: String(formData.get("periodFrom") ?? "") || null,
    periodTo: String(formData.get("periodTo") ?? "") || null,
  };
}

export async function createInstanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  const result = await createInstance(inputFrom(formData), user);
  if (result.error || !result.instanceId) return result;
  redirect(`/reports/archive/${result.instanceId}`);
}

export async function updateInstanceAction(instanceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return updateInstance(instanceId, inputFrom(formData), user);
}

export async function deleteDraftAction(instanceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  if (String(formData.get("confirm") ?? "") !== "1") return { error: "أكّد حذف المسودة" };
  const result = await deleteDraft(instanceId, user);
  if (result.error) return result;
  redirect("/reports/archive");
}

export async function copyInstanceAction(instanceId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  const result = await copyInstance(instanceId, user);
  if (result.error || !result.instanceId) return result;
  redirect(`/reports/archive/${result.instanceId}`);
}

export async function newVersionAction(instanceId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  const result = await newVersion(instanceId, user);
  if (result.error || !result.instanceId) return result;
  redirect(`/reports/archive/${result.instanceId}`);
}

/**
 * الاعتماد النهائي ثم توليد المخرجات الثلاث في الخلفية تلقائياً — التقرير المعتمد
 * تُحفظ ملفاته دون خطوة يدوية ثانية، و`after()` يضمن ألا يمسّ التوليد بثّ الاستجابة.
 */
export async function finalizeInstanceAction(instanceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder", "documents.issue");
  if (String(formData.get("confirm") ?? "") !== "1") return { error: "أكّد الاعتماد النهائي — بعده لا يُعدَّل التقرير" };
  const result = await finalizeInstance(instanceId, user);
  if (result.error) return result;
  const generation = await requestGeneration(instanceId, ["pdf", "docx", "xlsx"], user);
  if (generation.jobId) {
    const jobId = generation.jobId;
    after(() => runJob(jobId));
  }
  return result;
}

export async function archiveInstanceAction(instanceId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return archiveInstance(instanceId, user);
}

export async function unarchiveInstanceAction(instanceId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.builder");
  return unarchiveInstance(instanceId, user);
}

/** توليد المخرجات يدوياً (أو إعادة المحاولة بعد فشل) — المهمة في الخلفية عبر `after()` */
export async function generateOutputsAction(instanceId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "reports.generate");
  const result = await requestGeneration(instanceId, ["pdf", "docx", "xlsx"], user);
  if (result.error) return result;
  const jobId = result.jobId!;
  after(() => runJob(jobId));
  return { success: result.success, instanceId };
}

/**
 * رفع النسخة الموقّعة (§B) ثم إعادة تجميع الحزمة لتشملها — **بدورة مهمة كاملة لا نداء
 * يُبتلع فشله** (بلوكر §6): الربط يزيل الحزمة القديمة في المعاملة نفسها فلا حزمة ناقصة
 * قابلة للتنزيل، ثم تُدرج مهمة إعادة التجميع في سجل المهام — فشلها يُسجَّل بسببه العربي
 * ويظهر مع زر «إعادة المحاولة» كسائر مهام التوليد.
 */
export async function uploadSignedCopyAction(instanceId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("reports.read", "documents.issue");
  const upload = formData.get("signedCopy");
  if (!(upload instanceof File) || upload.size === 0) return { error: "اختر ملف النسخة الموقّعة" };

  try {
    const data = Buffer.from(await upload.arrayBuffer());
    const row = await getInstance(instanceId, user);
    if (!row) return { error: "التقرير غير موجود" };
    const file = await saveUploadedFile({
      originalName: upload.name,
      mime: upload.type,
      data,
      scope: "reports",
      sensitive: row.sensitive,
      uploadedBy: user.id,
    });
    const result = await attachSignedCopy(instanceId, file.id, user);
    if (result.error) return result;

    const generation = await requestGeneration(instanceId, ["zip"], user);
    if (generation.jobId) {
      const jobId = generation.jobId;
      after(() => runJob(jobId));
      return result;
    }
    // مهمة توليد نشطة قائمة: ستجمّع الحزمة بنفسها في نهايتها من الصف الراهن (§6) —
    // أما أي رفض آخر فيُقال صراحةً، لا يُبتلع: النسخة محفوظة والحزمة تحتاج «توليد المخرجات»
    if (generation.error?.includes("جارٍ فعلاً")) return result;
    return { error: `حُفظت النسخة الموقّعة، لكن جدولة تجميع الحزمة رُفضت: ${generation.error ?? "سبب غير معروف"} — استعمل «توليد المخرجات»` };
  } catch (e) {
    if (e instanceof UploadValidationError) return { error: e.message };
    return { error: userFacingError(e, "تعذر حفظ النسخة الموقّعة") };
  }
}

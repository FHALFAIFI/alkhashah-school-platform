"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth/session";
import {
  archiveSynthetic,
  unarchiveBatch,
  type ManualSelection,
} from "@/lib/cleanup-archive";
import type { SyntheticEntityType } from "@/lib/synthetic";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * تنفيذ الأرشفة — فعل حاسم يدوي من المدير. يُرفض ما لم يطابق نص التأكيد العبارة المطلوبة.
 * لا يُنفَّذ آلياً من الوكيل؛ يتطلب كتابة العبارة والضغط الصريح.
 */
export async function archiveSyntheticAction(formData: FormData): Promise<void> {
  const user = await requirePermission("admin.settings");
  const confirmationText = String(formData.get("confirmationText") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const manualSelections: ManualSelection[] = formData
    .getAll("manual")
    .map(String)
    .filter(Boolean)
    .map((s) => {
      const idx = s.indexOf(":");
      return { entityType: s.slice(0, idx) as SyntheticEntityType, id: s.slice(idx + 1) };
    });

  await archiveSynthetic({
    actorId: user.id,
    confirmationText,
    reason,
    manualSelections,
    ip: await clientIp(),
  });
  revalidatePath("/admin/cleanup");
}

/** استرجاع (تراجع) دفعة أرشفة كاملة — يعيد كل سجلاتها للظهور بلا فقد بيان */
export async function unarchiveBatchAction(formData: FormData): Promise<void> {
  const user = await requirePermission("admin.settings");
  const batchId = String(formData.get("batchId") ?? "");
  await unarchiveBatch({ batchId, actorId: user.id, ip: await clientIp() });
  revalidatePath("/admin/cleanup");
}

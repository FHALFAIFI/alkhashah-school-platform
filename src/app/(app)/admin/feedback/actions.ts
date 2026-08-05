"use server";

import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth/session";
import {
  updateFeedbackStatus,
  archiveFeedback,
  unarchiveFeedback,
  FeedbackError,
} from "@/lib/feedback/service";

export type FeedbackAdminState = { ok?: true; error?: string };

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** تحديث حالة الملاحظة وتوثيق الاستجابة — لأدوار الإدارة المخوَّلة فقط */
export async function updateStatusAction(_prev: FeedbackAdminState, formData: FormData): Promise<FeedbackAdminState> {
  const user = await requirePermission("feedback.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "");
  try {
    await updateFeedbackStatus({ id, status, note, actorId: user.id, ip: await clientIp() });
    return { ok: true };
  } catch (e) {
    if (e instanceof FeedbackError) return { error: e.message };
    return { error: "تعذّر تحديث الحالة" };
  }
}

/** أرشفة ملاحظة بسبب موثق — لا حذف نهائي مطلقاً */
export async function archiveAction(_prev: FeedbackAdminState, formData: FormData): Promise<FeedbackAdminState> {
  const user = await requirePermission("feedback.manage");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  try {
    await archiveFeedback({ id, reason, actorId: user.id, ip: await clientIp() });
    return { ok: true };
  } catch (e) {
    if (e instanceof FeedbackError) return { error: e.message };
    return { error: "تعذّر أرشفة الملاحظة" };
  }
}

/** استرجاع ملاحظة مؤرشفة */
export async function unarchiveAction(_prev: FeedbackAdminState, formData: FormData): Promise<FeedbackAdminState> {
  const user = await requirePermission("feedback.manage");
  const id = String(formData.get("id") ?? "");
  try {
    await unarchiveFeedback({ id, actorId: user.id, ip: await clientIp() });
    return { ok: true };
  } catch (e) {
    if (e instanceof FeedbackError) return { error: e.message };
    return { error: "تعذّر استرجاع الملاحظة" };
  }
}

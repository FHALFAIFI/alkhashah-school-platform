"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiDrafts } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

/** حذف مسودة مساعد — يملكها المستخدم فقط */
export async function deleteDraftAction(draftId: string): Promise<void> {
  const user = await requirePermission("ai.use");
  const deleted = await db
    .delete(aiDrafts)
    .where(and(eq(aiDrafts.id, draftId), eq(aiDrafts.userId, user.id)))
    .returning();
  if (deleted.length > 0) {
    await audit({ actorId: user.id, action: "ai.draft_deleted", entityType: "ai_draft", entityId: draftId, summary: `حذف مسودة «${deleted[0].title}»` });
  }
  revalidatePath("/assistant/drafts");
}

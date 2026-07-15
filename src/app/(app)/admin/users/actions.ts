"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";

export type ActionState = { error?: string; success?: string } | null;

const schema = z.object({
  username: z.string().min(1),
  newPassword: z.string().min(12, "كلمة المرور 12 حرفاً على الأقل"),
});

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requirePermission("admin.users");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [user] = await db.select().from(users).where(eq(users.username, parsed.data.username));
  if (!user) return { error: "المستخدم غير موجود" };
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
  // إبطال جلسات المستخدم بعد تغيير كلمة المرور
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await audit({ actorId: actor.id, action: "admin.password_changed", entityType: "user", entityId: user.id, summary: `تغيير كلمة مرور ${user.username}` });
  return { success: "غُيّرت كلمة المرور وأبطلت الجلسات السابقة" };
}
